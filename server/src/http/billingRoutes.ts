import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireAdmin, requirePerm } from './authMiddleware.js';
import { success, failure, failFrom } from './respond.js';
import {
  createOrder, confirmOrderPaid, grantFreeTrial, createInviteCode, redeemInviteCode,
  createGiftCards, redeemGiftCard, purchaseSubscription, getSubscriptionStatus,
} from '../services/billingService.js';
import { audit, actorFrom } from '../services/audit.js';
import { getBillingMultiplier } from '../services/pricing.js';

export const billingRouter: Router = express.Router();

// ==================== 用户侧 ====================
// 可用支付方式（读 settings 收款配置，管理员在后台配置生成器启用）
billingRouter.get('/billing/me/payment-methods', requireAuth, async (_req, res) => {
  try {
    const rows = await query("SELECT key, value FROM settings WHERE key LIKE 'payment_%'");
    const s: Record<string, string> = {};
    for (const r of rows.rows) {
      const v = r.value;
      s[r.key] = typeof v === 'string' ? v : (v && (v as any).value !== undefined ? String((v as any).value) : JSON.stringify(v));
    }
    const methods: any[] = [];
    if (s.payment_cards_enabled !== 'false' && s.payment_cards_enabled !== '0') methods.push({ id: 'card', label: '卡密兑换', hint: '输入卡密立即到账' });
    if (s.payment_test_qr_image) {
      methods.push({ id: 'testqr', label: s.payment_test_qr_label || '扫码转账（测试）', hint: s.payment_test_qr_info || '扫描下方收款码转账，转账后联系客服/管理员确认到账', qr_image: s.payment_test_qr_image });
    }
    if (s.payment_usdt_address) methods.push({ id: 'usdt', label: 'USDT (TRC20)', hint: '扫码转账自动到账', address: s.payment_usdt_address });
    if (s.payment_manual_enabled === 'true' || s.payment_manual_enabled === '1') methods.push({ id: 'manual', label: '人工转账', hint: s.payment_manual_info || '联系客服转账，管理员确认后到账' });
    if (s.payment_stripe_enabled === 'true' && s.payment_stripe_public_key) methods.push({ id: 'stripe', label: '信用卡 (Stripe)', hint: '海外客户可用' });
    success(res, { methods, config: { cards_enabled: methods.some(m => m.id === 'card'), usdt_address: s.payment_usdt_address || '' } });
  } catch (err) { failFrom(res, err); }
});

// 套餐/订阅列表
billingRouter.get('/billing/plans', requireAuth, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, description, amount::float8 AS amount, credit::float8 AS credit, rebate::float8 AS rebate, sort,
              type, period_days, monthly_credit::float8 AS monthly_credit
         FROM plans WHERE enabled = true ORDER BY type ASC, sort ASC, amount ASC`
    );
    // 附免费体验信息
    const free = Number(process.env.FREE_GRANT_AMOUNT || 0);
    const mine = await query('SELECT amount::float8 AS amount FROM free_grants WHERE user_id = $1', [(_req as any).user.id]);
    success(res, { plans: rows.rows, free_grant: { enabled: free > 0, amount: free, claimed: !!(mine.rowCount && mine.rows[0]) } });
  } catch (err) { failFrom(res, err); }
});

// 面向用户的实时单价：模型基准价 × 下游倍率 = 实付单价
billingRouter.get('/billing/me/pricing', requireAuth, async (req, res) => {
  try {
    const [mult, prices, keyRates] = await Promise.all([
      getBillingMultiplier(),
      query<{ model: string; input_price: number; output_price: number; cache_read_price: number; cache_write_price: number }>(
        `SELECT model, input_price::float8 AS input_price, output_price::float8 AS output_price,
                cache_read_price::float8 AS cache_read_price, cache_write_price::float8 AS cache_write_price
           FROM model_prices ORDER BY model LIMIT 300`
      ),
      // 查询当前用户所有 Key 绑定的分组倍率（展示实际计费倍率）
      query<{ key_id: number; key_name: string; group_id: number | null; group_name: string | null; rate_multiplier: number | null }>(
        `SELECT k.id AS key_id, k.name AS key_name, k.group_id,
                g.name AS group_name, g.rate_multiplier::float8 AS rate_multiplier
           FROM api_keys k
           LEFT JOIN groups g ON g.id = k.group_id
          WHERE k.user_id = $1 AND k.status = 'active'
          ORDER BY k.created_at DESC`,
        [req.user!.id]
      ),
    ]);
    // 用户实际计费倍率 = 分组倍率 ?? 全局倍率
    const effectiveRate = keyRates.rows.length > 0
      ? (keyRates.rows[0].rate_multiplier ?? mult)
      : mult;
    success(res, {
      multiplier: mult,            // 全局倍率
      effectiveRate,              // 用户实际计费倍率（分组倍率优先，回退全局）
      currency: 'USD',
      prices: prices.rows,
      keyRates: keyRates.rows.map((r) => ({
        key_id: r.key_id,
        key_name: r.key_name,
        group_id: r.group_id,
        group_name: r.group_name,
        rate_multiplier: r.rate_multiplier ?? mult,  // null 回退全局倍率
      })),
    });
  } catch (err) { failFrom(res, err); }
});

// 购买订阅（月套餐）：从余额一次性支付
billingRouter.post('/billing/me/subscribe', requireAuth, async (req, res) => {
  const schema = z.object({ plan_id: z.number().int().positive() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '选择要购买的套餐', 400);
  try {
    const sub = await purchaseSubscription(req.user!.id, parsed.data.plan_id);
    success(res, sub);
  } catch (err) {
    const m = err instanceof Error ? err.message : 'unknown';
    const map: Record<string, [number, string]> = {
      PLAN_NOT_FOUND: [404, '套餐不存在'], NOT_SUBSCRIPTION: [400, '该套餐不是订阅套餐'],
      INSUFFICIENT_BALANCE: [402, '余额不足，请先充值（卡密兑换或联系客服）'],
    };
    if (map[m]) return failure(res, map[m][1], map[m][0]);
    failFrom(res, err);
  }
});

// 我的订阅状态
billingRouter.get('/billing/me/subscription', requireAuth, async (req, res) => {
  try {
    const sub = await getSubscriptionStatus(req.user!.id);
    success(res, sub);
  } catch (err) { failFrom(res, err); }
});

// 我的订单
billingRouter.get('/billing/me/orders', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, order_no, plan_id, amount::float8 AS amount, credit::float8 AS credit, rebate::float8 AS rebate, channel, status, remark, created_at, paid_at
         FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user!.id]
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// 创建充值订单（套餐或自定义）
billingRouter.post('/billing/me/orders', requireAuth, async (req, res) => {
  const schema = z.object({
    plan_id: z.number().int().nullish(),
    amount: z.number().positive().max(100000).optional(),
    channel: z.string().max(30).default('manual'),
    invite_code: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    let amount = parsed.data.amount ?? 0;
    let credit = parsed.data.amount ?? 0;
    let rebate = 0;
    let planId: number | null = parsed.data.plan_id ?? null;
    if (planId) {
      const plan = await query<{ id: number; amount: string; credit: string; rebate: string }>('SELECT id, amount, credit, rebate FROM plans WHERE id = $1 AND enabled = true', [planId]);
      if (!plan.rowCount) return failure(res, 'Plan not found or disabled', 404);
      amount = Number(plan.rows[0].amount);
      credit = Number(plan.rows[0].credit);
      rebate = Number(plan.rows[0].rebate || 0);
    } else if (!amount || amount <= 0) {
      return failure(res, 'amount or plan_id required', 400);
    }
    const order = await createOrder({ userId: req.user!.id, amount, credit, planId, channel: parsed.data.channel, remark: parsed.data.invite_code || undefined, rebate, currency: 'CNY' });
    // 支付渠道接口：manual 直接待支付；alipay/wechat 需接入第三方，此处返回订单信息等待渠道回调
    res.json({ code: 0, data: order, message: 'ok' });
  } catch (err) { failFrom(res, err); }
});

// 领取免费体验额度
billingRouter.post('/billing/me/free', requireAuth, async (req, res) => {
  try {
    const amount = await grantFreeTrial(req.user!.id);
    success(res, { credited: amount });
  } catch (err) {
    const m = err instanceof Error ? err.message : 'unknown';
    if (m === 'FREE_TRIAL_DISABLED') return failure(res, 'Free trial not enabled', 400);
    if (m === 'FREE_TRIAL_ALREADY_USED') return failure(res, 'Already claimed free trial', 400);
    failFrom(res, err);
  }
});

// 兑换邀请码
billingRouter.post('/billing/me/invite', requireAuth, async (req, res) => {
  const schema = z.object({ code: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invite code required', 400);
  try {
    const reward = await redeemInviteCode(parsed.data.code, req.user!.id);
    success(res, { rewarded: reward });
  } catch (err) {
    const m = err instanceof Error ? err.message : 'unknown';
    const map: Record<string, [number, string]> = {
      INVITE_CODE_INVALID: [400, '邀请码无效'], INVITE_CODE_EXHAUSTED: [400, '邀请码已用完'],
      INVITE_CODE_ALREADY_USED: [400, '邀请码已被使用'],
    };
    if (map[m]) return failure(res, map[m][1], map[m][0]);
    failFrom(res, err);
  }
});

// 我的邀请返利：邀请码、邀请人数、累计返利（供邀请返利页）
billingRouter.get('/billing/me/invite-summary', requireAuth, async (req, res) => {
  try {
    const uid = req.user!.id;
    const codes = await query(
      `SELECT id, code, max_uses, used_count, reward_credit::float8 AS reward_credit, enabled, created_at
         FROM invite_codes WHERE owner_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [uid]
    );
    const stats = await query(
      `SELECT COUNT(DISTINCT iu.user_id)::int AS invited,
              COALESCE(SUM(ic.reward_credit), 0)::float8 AS total_reward
         FROM invite_codes ic
         LEFT JOIN invite_uses iu ON iu.invite_id = ic.id
        WHERE ic.owner_user_id = $1`,
      [uid]
    );
    const s = stats.rows[0] || { invited: 0, total_reward: 0 };
    const myCode = codes.rows.find((c: any) => c.enabled && c.max_uses > c.used_count)?.code || null;
    success(res, {
      invite_code: myCode,
      invite_link: myCode ? `${process.env.PUBLIC_BASE_URL || ''}/register?invite=${myCode}` : null,
      rebate_rate: 5,
      invited: Number(s.invited) || 0,
      total_reward: Number(s.total_reward) || 0,
      withdrawable: Number(s.total_reward) || 0,
      codes: codes.rows,
    });
  } catch (err) { failFrom(res, err); }
});

// ==================== 管理员侧 ====================
// 套餐管理
billingRouter.get('/admin/plans', requireAuth, requirePerm('plan.manage'), async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, name, description, amount::float8 AS amount, credit::float8 AS credit, enabled, sort,
              type, period_days, monthly_credit::float8 AS monthly_credit, created_at
         FROM plans ORDER BY type ASC, sort ASC, id ASC`
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

billingRouter.post('/admin/plans', requireAuth, requirePerm('plan.manage'), async (req, res) => {
  const schema = z.object({
    name: z.string().min(1), description: z.string().nullish(),
    amount: z.number().positive(), credit: z.number().nonnegative().default(0),
    type: z.enum(['prepaid', 'subscription']).default('prepaid'),
    period_days: z.number().int().positive().nullish(), monthly_credit: z.number().positive().nullish(),
    sort: z.number().int().default(0), rebate: z.number().nonnegative().default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const d = parsed.data;
  if (d.type === 'subscription' && (!d.period_days || !d.monthly_credit)) {
    return failure(res, '订阅套餐需填周期天数与每月额度', 400);
  }
  try {
    const rows = await query(
      `INSERT INTO plans (name, description, amount, credit, type, period_days, monthly_credit, sort, rebate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name`,
      [d.name, d.description || null, d.amount, d.credit, d.type, d.period_days ?? null, d.monthly_credit ?? null, d.sort, d.rebate]
    );
    success(res, rows.rows[0]);
  } catch (err) { failFrom(res, err); }
});

billingRouter.patch('/admin/plans/:id', requireAuth, requirePerm('plan.manage'), async (req, res) => {
  const schema = z.object({
    name: z.string().optional(), description: z.string().nullish(), amount: z.number().positive().optional(),
    credit: z.number().nonnegative().optional(), enabled: z.boolean().optional(), sort: z.number().int().optional(),
    type: z.enum(['prepaid', 'subscription']).optional(), period_days: z.number().int().positive().nullish(),
    monthly_credit: z.number().positive().nullish(), rebate: z.number().nonnegative().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  const d = parsed.data;
  const sets: string[] = []; const params: unknown[] = []; let i = 1;
  if (d.name !== undefined) { sets.push(`name = $${i++}`); params.push(d.name); }
  if (d.description !== undefined) { sets.push(`description = $${i++}`); params.push(d.description || null); }
  if (d.amount !== undefined) { sets.push(`amount = $${i++}`); params.push(d.amount); }
  if (d.credit !== undefined) { sets.push(`credit = $${i++}`); params.push(d.credit); }
  if (d.rebate !== undefined) { sets.push(`rebate = $${i++}`); params.push(d.rebate); }
  if (d.enabled !== undefined) { sets.push(`enabled = $${i++}`); params.push(d.enabled); }
  if (d.sort !== undefined) { sets.push(`sort = $${i++}`); params.push(d.sort); }
  if (d.type !== undefined) { sets.push(`type = $${i++}`); params.push(d.type); }
  if (d.period_days !== undefined) { sets.push(`period_days = $${i++}`); params.push(d.period_days ?? null); }
  if (d.monthly_credit !== undefined) { sets.push(`monthly_credit = $${i++}`); params.push(d.monthly_credit ?? null); }
  if (!sets.length) return failure(res, 'Nothing to update', 400);
  params.push(Number(req.params.id));
  try {
    const resRow = await query(`UPDATE plans SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, params);
    if (!resRow.rowCount) return failure(res, 'Plan not found', 404);
    success(res, { id: Number(req.params.id) });
  } catch (err) { failFrom(res, err); }
});

billingRouter.delete('/admin/plans/:id', requireAuth, requirePerm('plan.manage'), async (req, res) => {
  try {
    await query('UPDATE plans SET enabled = false WHERE id = $1', [Number(req.params.id)]);
    success(res, { disabled: true });
  } catch (err) { failFrom(res, err); }
});

// 全部订单 + 手动到账
billingRouter.get('/admin/orders', requireAuth, requirePerm('order.view'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  try {
    const where = status ? ' WHERE o.status = $1' : '';
    const params: unknown[] = status ? [status] : [limit];
    const last = status ? limit : undefined;
    const rows = await query(
      `SELECT o.id, o.order_no, o.user_id, u.email AS user_email, o.plan_id, o.amount::float8 AS amount, o.credit::float8 AS credit,
              o.channel, o.provider_order_id, o.status, o.remark, o.created_at, o.paid_at
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
        ${where} ORDER BY o.created_at DESC LIMIT $${status ? 2 : 1}`,
      status ? [...params, limit] : params
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// 手动确认到账（人工收款兜底）
billingRouter.post('/admin/orders/:orderNo/paid', requireAuth, requirePerm('order.confirm'), async (req, res) => {
  try {
    const order = await confirmOrderPaid(req.params.orderNo, req.body?.provider_order_id);
    const a = actorFrom(req);
    await audit({ actorId: a.actorId, actorEmail: a.actorEmail, action: 'confirm_order_paid', targetType: 'order', detail: { order_no: req.params.orderNo, paid: order.paid }, ip: a.ip });
    success(res, order);
  } catch (err) {
    const m = err instanceof Error ? err.message : 'unknown';
    if (m === 'ORDER_NOT_FOUND') return failure(res, 'Order not found', 404);
    if (m === 'ORDER_NOT_PAYABLE') return failure(res, 'Order cannot be paid', 400);
    failFrom(res, err);
  }
});

// 邀请码管理
billingRouter.get('/admin/invites', requireAuth, requirePerm('invite.manage'), async (_req, res) => {
  try {
    const rows = await query(
      `SELECT c.id, c.code, c.owner_user_id, o.email AS owner_email, c.max_uses, c.used_count, c.enabled,
              c.reward_credit::float8 AS reward_credit, c.created_at
         FROM invite_codes c LEFT JOIN users o ON o.id = c.owner_user_id ORDER BY c.created_at DESC LIMIT 200`
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

billingRouter.post('/admin/invites', requireAuth, requirePerm('invite.manage'), async (req, res) => {
  const schema = z.object({ code: z.string().optional(), owner_user_id: z.number().int().nullish(), max_uses: z.number().int().nonnegative().default(1), reward_credit: z.number().nonnegative().default(0) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const inv = await createInviteCode({ code: parsed.data.code, ownerUserId: parsed.data.owner_user_id, maxUses: parsed.data.max_uses, rewardCredit: parsed.data.reward_credit });
    success(res, inv);
  } catch (err) {
    const m = err instanceof Error ? err.message : 'unknown';
    if (m === 'INVITE_CODE_EXISTS') return failure(res, 'Invite code already exists', 409);
    failFrom(res, err);
  }
});

// ==================== 卡密 / 兑换码 ====================
// 用户兑换卡密
billingRouter.post('/billing/me/redeem', requireAuth, async (req, res) => {
  const schema = z.object({ code: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '卡密格式错误', 400);
  try {
    const r = await redeemGiftCard(parsed.data.code, req.user!.id);
    success(res, r);
  } catch (err) {
    const m = err instanceof Error ? err.message : 'unknown';
    const map: Record<string, [number, string]> = {
      GIFT_CODE_REQUIRED: [400, '请输入卡密'], GIFT_CODE_INVALID: [400, '卡密无效'],
      GIFT_CODE_USED: [400, '该卡密已被使用或已禁用'],
    };
    if (map[m]) return failure(res, map[m][1], map[m][0]);
    failFrom(res, err);
  }
});

// 查看我的兑换记录
billingRouter.get('/billing/me/redeems', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT g.code, u.credit, u.created_at FROM gift_card_uses u JOIN gift_cards g ON g.id=u.card_id
        WHERE u.user_id = $1 ORDER BY u.created_at DESC LIMIT 100`, [req.user!.id]
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// 管理员生成卡密
billingRouter.post('/admin/gift-cards', requireAuth, requirePerm('card.manage'), async (req, res) => {
  const schema = z.object({ count: z.number().int().min(1).max(1000), credit: z.number().positive(), batch: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    const codes = await createGiftCards({ count: parsed.data.count, credit: parsed.data.credit, batch: parsed.data.batch || null, createdBy: req.user!.id });
    const a = actorFrom(req);
    await audit({ actorId: a.actorId, actorEmail: a.actorEmail, action: 'create_gift_cards', targetType: 'gift_card', detail: { count: codes.length, credit: parsed.data.credit, batch: parsed.data.batch || null }, ip: a.ip });
    success(res, { count: codes.length, codes, credit: parsed.data.credit, batch: parsed.data.batch || null });
  } catch (err) { failFrom(res, err); }
});

// 管理员卡密列表
billingRouter.get('/admin/gift-cards', requireAuth, requirePerm('card.manage'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  try {
    const where = status ? ' WHERE g.status = $1' : '';
    const rows = await query(
      `SELECT g.id, g.code, g.credit::float8 AS credit, g.status, g.batch, g.used_by, u.email AS used_email, g.used_at, g.created_at
         FROM gift_cards g LEFT JOIN users u ON u.id = g.used_by
        ${where} ORDER BY g.created_at DESC LIMIT $${status ? 2 : 1}`,
      status ? [status, limit] : [limit]
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});

// 管理员禁用/启用卡密
billingRouter.patch('/admin/gift-cards/:id', requireAuth, requirePerm('card.manage'), async (req, res) => {
  const schema = z.object({ status: z.enum(['unused', 'disabled']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, 'Invalid payload', 400);
  try {
    await query(`UPDATE gift_cards SET status=$1 WHERE id=$2`, [parsed.data.status, Number(req.params.id)]);
    success(res, { ok: true });
  } catch (err) { failFrom(res, err); }
});

// 资金流水：合并订单到账、卡密兑换、免费赠送、订阅购买、调用消费（统一给用户展示）
billingRouter.get('/billing/me/transactions', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  try {
    const rows = await query(
      `SELECT t.type, t.ref, t.amount, t.created_at FROM (
         SELECT '充值' AS type, order_no AS ref, credit::float8 AS amount, created_at
           FROM orders WHERE user_id = $1 AND status = 'paid'
         UNION ALL
         SELECT '卡密' AS type, c.code AS ref, u.credit::float8 AS amount, u.created_at
           FROM gift_card_uses u JOIN gift_cards c ON c.id = u.card_id WHERE u.user_id = $1
         UNION ALL
         SELECT '赠送' AS type, 'free'::text AS ref, amount::float8 AS amount, granted_at AS created_at
           FROM free_grants WHERE user_id = $1
         UNION ALL
         SELECT '消费' AS type, endpoint AS ref, -cost::float8 AS amount, created_at
           FROM request_logs WHERE user_id = $1
       ) t ORDER BY t.created_at DESC LIMIT $2`,
      [req.user!.id, limit]
    );
    success(res, rows.rows);
  } catch (err) { failFrom(res, err); }
});
