import { query, tx } from '../db/pool.js';
import crypto from 'crypto';

/** 生成对外商户单号。 */
export function genOrderNo(): string {
  const t = new Date();
  const ts = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(4).toString('hex');
  return `RP${ts}${rand.toUpperCase()}`;
}

export interface OrderRow {
  id: number;
  order_no: string;
  user_id: number;
  amount: number;
  credit: number;
  rebate: number;
  currency: string;
  status: string;
  channel: string;
}

/** 创建充值订单（套餐或自定义）。status=pending。multiSend 为多充多送返利额度。 */
export async function createOrder(input: { userId: number; amount: number; credit: number; planId?: number | null; channel?: string; remark?: string; rebate?: number; currency?: string }): Promise<OrderRow> {
  const orderNo = genOrderNo();
  const res = await query<OrderRow>(
    `INSERT INTO orders (order_no, user_id, plan_id, amount, credit, rebate, currency, channel, remark, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
     RETURNING id, order_no, user_id, amount::float8 AS amount, credit::float8 AS credit, rebate::float8 AS rebate, currency, channel, status`,
    [orderNo, input.userId, input.planId ?? null, input.amount, input.credit, input.rebate ?? 0, input.currency ?? 'CNY', input.channel || 'manual', input.remark || null]
  );
  return res.rows[0];
}

/** 商户订单回调/确认到账：幂等（已 paid 则忽略）。成功后给用户加余额。 */
export async function confirmOrderPaid(orderNo: string, providerOrderId?: string): Promise<{ paid: boolean; order?: OrderRow }> {
  return tx(async (client) => {
    const res = await client.query<OrderRow>(
      `SELECT id, order_no, user_id, amount::float8 AS amount, credit::float8 AS credit, rebate::float8 AS rebate, currency, channel, status FROM orders WHERE order_no = $1 FOR UPDATE`,
      [orderNo]
    );
    const order = res.rows[0];
    if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });
    if (order.status === 'paid') return { paid: false, order }; // 幂等
    if (order.status !== 'pending') throw Object.assign(new Error('ORDER_NOT_PAYABLE'), { status: 400 });

    // 加余额（到账 = credit + 返利）+ 置为已支付
    const credited = Number(order.credit) + Number(order.rebate || 0);
    await client.query(
      `UPDATE users SET balance = balance + $2 WHERE id = $1`,
      [order.user_id, credited]
    );
    await client.query(
      `UPDATE orders SET status='paid', paid_at=now(), provider_order_id=$2 WHERE id=$1`,
      [order.id, providerOrderId || null]
    );
    return { paid: true, order: { ...order, status: 'paid' } };
  });
}

/** 手动/管理员到账（兜底）。 */
export async function manualPaid(orderNo: string, remark?: string): Promise<OrderRow> {
  const r = await confirmOrderPaid(orderNo);
  if (remark) await query(`UPDATE orders SET remark = $2 WHERE order_no = $1`, [orderNo, remark]);
  return r.order as OrderRow;
}

/** 免费体验额度：仅一次，需开启 FREE_GRANT_AMOUNT>0。 */
export async function grantFreeTrial(userId: number): Promise<number> {
  const amount = Number(process.env.FREE_GRANT_AMOUNT || 0);
  if (amount <= 0) throw Object.assign(new Error('FREE_TRIAL_DISABLED'), { status: 400 });
  return tx(async (client) => {
    const exists = await client.query('SELECT user_id FROM free_grants WHERE user_id = $1', [userId]);
    if (exists.rowCount) throw Object.assign(new Error('FREE_TRIAL_ALREADY_USED'), { status: 400 });
    await client.query(`UPDATE users SET balance = balance + $2 WHERE id = $1`, [userId, amount]);
    await client.query(`INSERT INTO free_grants (user_id, amount) VALUES ($1, $2)`, [userId, amount]);
    return amount;
  });
}

// ==================== 月度订阅 ====================

export interface SubscriptionView {
  id: number;
  plan_id: number;
  plan_name: string;
  status: string;
  monthly_credit: number;
  used_credit: number;
  remaining: number;
  renewed_at: Date;
  expires_at: Date;
}

/** 查用户当前有效订阅（处理到期：过期则把剩余额度结转余额并置为 expired）。 */
export async function getSubscriptionStatus(userId: number): Promise<SubscriptionView | null> {
  const r = await query<SubscriptionView & { plan_name: string }>(
    `SELECT s.id, s.plan_id, p.name AS plan_name, s.status, s.monthly_credit::float8 AS monthly_credit,
            s.used_credit::float8 AS used_credit, s.renewed_at, s.expires_at
       FROM user_subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.user_id = $1 AND s.status = 'active' ORDER BY s.expires_at DESC LIMIT 1`,
    [userId]
  );
  const sub = r.rows[0];
  if (!sub) return null;
  sub.remaining = Number((sub.monthly_credit - sub.used_credit).toFixed(6));
  return sub;
}

/**
 * 购买订阅（月套餐）：从余额一次性支付 plan.amount。
 * 若已有 active 订阅，则叠加一个月（monthly_credit 累加，有效期从最早到期日 + period）降级风险——此处采用"续期"：到期日顺延。
 */
export async function purchaseSubscription(userId: number, planId: number): Promise<SubscriptionView> {
  return tx(async (client) => {
    const plan = await client.query<{ id: number; name: string; type: string; period_days: number | null; monthly_credit: string; amount: string }>(
      'SELECT id, name, type, period_days, monthly_credit, amount FROM plans WHERE id = $1 FOR UPDATE', [planId]
    );
    const p = plan.rows[0];
    if (!p) throw Object.assign(new Error('PLAN_NOT_FOUND'), { status: 404 });
    if (p.type !== 'subscription' || !p.period_days || !p.monthly_credit) {
      throw Object.assign(new Error('NOT_SUBSCRIPTION'), { status: 400 });
    }
    const periodDays = p.period_days;
    const monthlyCredit = Number(p.monthly_credit);
    const amount = Number(p.amount);
    // 扣余额
    const upd = await client.query('UPDATE users SET balance = balance - $2 WHERE id = $1 AND balance >= $2', [userId, amount]);
    if (!upd.rowCount) throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { status: 402 });

    // 已有 active 订阅：续期顺延到期日 + 叠加额度；否则新建
    const existing = await client.query<{ id: number; renew: Date; exp: Date; used: string }>(
      `SELECT id, renewed_at AS renew, expires_at AS exp, used_credit::float8 AS used FROM user_subscriptions
        WHERE user_id = $1 AND status='active' ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`, [userId]
    );
    let subId: number;
    if (existing.rows[0]) {
      const cur = existing.rows[0];
      const base = new Date(cur.exp).getTime() > Date.now() ? new Date(cur.exp) : new Date();
      const newExp = new Date(base.getTime() + periodDays * 86400000);
      const res2 = await client.query(
        `UPDATE user_subscriptions SET monthly_credit = monthly_credit + $2, expires_at = $3 WHERE id = $1 RETURNING id`, [cur.id, monthlyCredit, newExp]
      );
      subId = res2.rows[0].id;
    } else {
      const now = new Date();
      const exp = new Date(now.getTime() + periodDays * 86400000);
      const res3 = await client.query(
        `INSERT INTO user_subscriptions (user_id, plan_id, status, monthly_credit, renewed_at, expires_at)
         VALUES ($1,$2,'active',$3,$4,$5) RETURNING id`, [userId, p.id, monthlyCredit, now, exp]
      );
      subId = res3.rows[0].id;
    }
    const out = await client.query<SubscriptionView>(
      `SELECT s.id, s.plan_id, p.name AS plan_name, s.status, s.monthly_credit::float8 AS monthly_credit,
              s.used_credit::float8 AS used_credit, s.renewed_at, s.expires_at
         FROM user_subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = $1`, [subId]
    );
    const v = out.rows[0];
    v.remaining = Number((v.monthly_credit - v.used_credit).toFixed(6));
    return v;
  });
}

export interface InviteCodeRow { id: number; code: string; max_uses: number; used_count: number; reward_credit: number; }

/** 创建邀请码（管理员/分销侧）。 */
export async function createInviteCode(input: { code?: string; ownerUserId?: number | null; maxUses?: number; rewardCredit?: number }): Promise<InviteCodeRow> {
  const code = (input.code || crypto.randomBytes(3).toString('hex').toUpperCase());
  const res = await query<InviteCodeRow>(
    `INSERT INTO invite_codes (code, owner_user_id, max_uses, reward_credit) VALUES ($1,$2,$3,$4)
     ON CONFLICT (code) DO NOTHING RETURNING id, code, max_uses, used_count, reward_credit`,
    [code, input.ownerUserId ?? null, input.maxUses ?? 1, input.rewardCredit ?? 0]
  );
  if (!res.rowCount) throw Object.assign(new Error('INVITE_CODE_EXISTS'), { status: 409 });
  return res.rows[0];
}

/** 注册/使用邀请码：给被邀请人加 reward 额度。返回 userId 的加赠。 */
export async function redeemInviteCode(code: string, userId: number): Promise<number> {
  return tx(async (client) => {
    const res = await client.query<InviteCodeRow>(
      `SELECT id, code, max_uses, used_count, reward_credit::float8 AS reward_credit FROM invite_codes WHERE code = $1 AND enabled = true FOR UPDATE`,
      [code]
    );
    const inv = res.rows[0];
    if (!inv) throw Object.assign(new Error('INVITE_CODE_INVALID'), { status: 400 });
    if (inv.max_uses > 0 && inv.used_count >= inv.max_uses) throw Object.assign(new Error('INVITE_CODE_EXHAUSTED'), { status: 400 });
    // 一人只能用一次
    const used = await client.query('SELECT 1 FROM invite_uses WHERE invite_id = $1 AND user_id = $2', [inv.id, userId]);
    if (used.rowCount) throw Object.assign(new Error('INVITE_CODE_ALREADY_USED'), { status: 400 });
    await client.query(`UPDATE invite_codes SET used_count = used_count + 1 WHERE id = $1`, [inv.id]);
    await client.query(`INSERT INTO invite_uses (invite_id, user_id) VALUES ($1, $2)`, [inv.id, userId]);
    if (inv.reward_credit > 0) {
      await client.query(`UPDATE users SET balance = balance + $2 WHERE id = $1`, [userId, inv.reward_credit]);
    }
    return inv.reward_credit;
  });
}

// ==================== 卡密 / 兑换码 ====================

/** 生成一组卡密（管理员发卡）。返回生成的卡码数组。 */
export async function createGiftCards(input: { count: number; credit: number; batch?: string | null; createdBy: number }): Promise<string[]> {
  const codes: string[] = [];
  for (let i = 0; i < input.count; i++) {
    const code = genGiftCode();
    await query(
      `INSERT INTO gift_cards (code, credit, status, batch, created_by) VALUES ($1, $2, 'unused', $3, $4) ON CONFLICT (code) DO NOTHING`,
      [code, input.credit, input.batch || null, input.createdBy]
    );
    codes.push(code);
  }
  return codes;
}

function genGiftCode(): string {
  // 15 位大写字母+数字，形如 GXXX-XXXX-XXXX-XXXX
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆 0/O/1/I
  const seg = (n: number) => {
    let s = '';
    const bytes = crypto.randomBytes(n);
    for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
    return s;
  };
  return `G${seg(3)}-${seg(4)}-${seg(4)}-${seg(4)}`;
}

/** 兑换卡密：校验、置 used、给 user 加 credit，写使用记录。 */
export async function redeemGiftCard(code: string, userId: number): Promise<{ credited: number; batch: string | null }> {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw Object.assign(new Error('GIFT_CODE_REQUIRED'), { status: 400 });
  return tx(async (client) => {
    const res = await client.query<{ id: number; credit: string; status: string; batch: string | null }>(
      `SELECT id, credit, status, batch FROM gift_cards WHERE code = $1 FOR UPDATE`, [normalized]
    );
    const card = res.rows[0];
    if (!card) throw Object.assign(new Error('GIFT_CODE_INVALID'), { status: 400 });
    if (card.status !== 'unused') throw Object.assign(new Error('GIFT_CODE_USED'), { status: 400 });
    // 加余额 + 标记已用 + 记录
    await client.query(`UPDATE users SET balance = balance + $2 WHERE id = $1`, [userId, Number(card.credit)]);
    await client.query(
      `UPDATE gift_cards SET status='used', used_by=$1, used_at=now() WHERE id=$2`, [userId, card.id]
    );
    await client.query(
      `INSERT INTO gift_card_uses (card_id, user_id, credit) VALUES ($1,$2,$3)`, [card.id, userId, Number(card.credit)]
    );
    return { credited: Number(card.credit), batch: card.batch };
  });
}
