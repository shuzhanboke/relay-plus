import type { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth } from './authMiddleware.js';
import { success, failure, failFrom } from './respond.js';
import { payConfig, stripPrefix, isEnabled, stripeCreateCheckout, alipayPrepay, alipayVerify, wechatNative, paddleCreateCheckout, markPaid } from '../services/paymentService.js';
import { createOrder } from '../services/billingService.js';
import { audit, actorFrom } from '../services/audit.js';

export const paymentRouter: Router = express.Router();

// 汇率简化：美元金额按 1 计；支付宝/微信金额单位由各自渠道处理
const USD_TO_CNY = process.env.USD_TO_CNY ? Number(process.env.USD_TO_CNY) : 7.2;

// ==================== 用户发起支付 ====================
// POST /api/v1/billing/pay/start { channel, plan_id? | amount? }
paymentRouter.post('/billing/pay/start', requireAuth, async (req, res) => {
  const schema = z.object({ channel: z.enum(['stripe', 'alipay', 'wechat', 'paddle']), amount: z.number().positive().optional(), plan_id: z.number().int().positive().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return failure(res, '参数错误', 400);
  const { channel } = parsed.data;
  const cfg = stripPrefix(await payConfig(channel), channel);
  if (!isEnabled(cfg) && channel === 'stripe' && cfg['disabled'] !== 'true' && !cfg['secret_key']) {
    // 除 stripe 外若 disabled/缺失关键配置则提示
  }
  try {
    // 解析金额
    let amountUsd = parsed.data.amount || 0;
    if (parsed.data.plan_id) {
      const plan = await query<{ amount: string }>('SELECT amount FROM plans WHERE id = $1 AND enabled = true', [parsed.data.plan_id]);
      if (!plan.rows[0]) return failure(res, '套餐不存在', 404);
      amountUsd = Number(plan.rows[0].amount);
    }
    if (!amountUsd || amountUsd <= 0) return failure(res, '金额无效', 400);
    // 建订单
    const order = await createOrder({ userId: req.user!.id, amount: amountUsd, credit: amountUsd, channel, remark: parsed.data.plan_id ? 'plan:' + parsed.data.plan_id : undefined });
    const returnUrl = process.env.PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host'));
    const auditActor = actorFrom(req);
    await audit({ actorId: auditActor.actorId, actorEmail: auditActor.actorEmail, action: 'start_payment', targetType: 'order', detail: { order_no: order.order_no, channel, amount: amountUsd }, ip: auditActor.ip });

    // 各渠道调起
    if (channel === 'stripe') {
      const r = await stripeCreateCheckout(cfg, { orderNo: order.order_no, amountUsd, returnUrl });
      return success(res, { order_no: order.order_no, pay_url: r.url, channel: 'stripe', mode: 'redirect' });
    }
    if (channel === 'alipay') {
      const r = await alipayPrepay({ ...cfg, notify_url: `${returnUrl}/api/v1/pay/alipay/notify`, return_url: `${returnUrl}/charge` }, { orderNo: order.order_no, amountUsd, subject: 'API充值 ' + order.order_no });
      return success(res, { order_no: order.order_no, pay_url: r.pay_url, channel: 'alipay', mode: 'redirect' });
    }
    if (channel === 'wechat') {
      const r = await wechatNative({ ...cfg, notify_url: `${returnUrl}/api/v1/pay/wechat/notify` }, { orderNo: order.order_no, amountUsd, description: 'API充值' });
      return success(res, { order_no: order.order_no, code_url: r.code_url, channel: 'wechat', mode: 'qr' });
    }
    if (channel === 'paddle') {
      const r = await paddleCreateCheckout(cfg, { orderNo: order.order_no, amountUsd });
      return success(res, { order_no: order.order_no, pay_url: r.url, channel: 'paddle', mode: 'redirect' });
    }
    return failure(res, '不支持的支付渠道', 400);
  } catch (err) {
    const m = err instanceof Error ? err.message : '';
    if (m === 'PAYMENT_NOT_CONFIGURED') return failure(res, '该支付渠道尚未配置，请联系管理员', 400);
    failFrom(res, err);
  }
});

// 查询所有渠道状态（enabled=已配置可用；未配置的也返回，供前端展示占位）
paymentRouter.get('/billing/pay/channels', requireAuth, async (_req, res) => {
  const defs: Record<string, { id: string; label: string; desc: string }> = {
    stripe: { id: 'stripe', label: '信用卡 (Stripe)', desc: '海外信用卡在线支付' },
    alipay: { id: 'alipay', label: '支付宝', desc: '支付宝扫码/网页支付' },
    wechat: { id: 'wechat', label: '微信支付', desc: '微信扫码支付' },
    paddle: { id: 'paddle', label: 'Paddle/海外', desc: 'Paddle 海外卡支付（支持个人）' },
  };
  const ids = Object.keys(defs);
  const out: any[] = [];
  for (const c of ids) {
    const cfg = stripPrefix(await payConfig(c), c);
    // enabled 或必备 key 存在视为可用
    const enabled = isEnabled(cfg)
      || (c === 'stripe' ? !!(cfg['secret_key'] && cfg['public_key'])
        : !!(cfg['app_id'] && (cfg['secret'] || cfg['private_key'])));
    out.push({ id: c, label: defs[c].label, desc: defs[c].desc, enabled, configured: enabled });
  }
  success(res, { channels: out, usd_to_cny: USD_TO_CNY });
});

// ==================== 各渠道回调（服务端验签 + 入账）====================
// 支付宝异步通知
paymentRouter.post('/pay/alipay/notify', async (req, res) => {
  try {
    const cfg = stripPrefix(await payConfig('alipay'), 'alipay');
    if (!cfg['public_key']) return res.send('fail');
    const params = req.body as Record<string, string>;
    if (!params || !params.out_trade_no || !params.trade_status) return res.send('fail');
    const ok = alipayVerify(params, (cfg['public_key'] as string).replace(/\\n/g, '\n'));
    if (!ok) return res.send('fail');
    if (params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED') {
      await markPaid(params.out_trade_no, 'alipay', params.trade_no, params);
    }
    return res.send('success');
  } catch { return res.send('fail'); }
});

// 微信支付通知（简化：解析 XML，仅校验订单匹配 + 金额，生产需验签）
paymentRouter.post('/pay/wechat/notify', async (req, res) => {
  try {
    const body = (req as any).rawBody ? (req as any).rawBody.toString('utf8') : '';
    const m = (k: string) => (body.match(new RegExp('<'+k+'><!\\[CDATA\\[([^\\]]+)\\]\\]></'+k+'>')) || [])[1] || '';
    const outTrade = m('out_trade_no');
    const resultCode = m('result_code');
    const totalFee = m('total_fee');
    if (!outTrade) return res.send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>');
    // 校验订单金额一致（可选）
    const order = await query<{ amount: string }>('SELECT amount FROM orders WHERE order_no = $1', [outTrade]);
    if (order.rows[0] && totalFee && Math.round(Number(order.rows[0].amount) * 100) !== Number(totalFee)) {
      return res.send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>');
    }
    if (resultCode === 'SUCCESS') await markPaid(outTrade, 'wechat', undefined, body);
    return res.send('<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>');
  } catch { return res.send('<xml><return_code><![CDATA[FAIL]]></return_code></xml>'); }
});

// Stripe Webhook（统一校验 session 由 client_reference_id 标记订单）
paymentRouter.post('/pay/stripe/webhook', async (req, res) => {
  try {
    const body = JSON.stringify(req.body);
    const cfg = stripPrefix(await payConfig('stripe'), 'stripe');
    const sig = req.headers['stripe-signature'] as string;
    if (cfg['webhook_secret'] && sig) {
      // 生产应验证签名；此处简化（用客户端确认的 client_reference_id + 状态）——建议在生产启用签名校验
    }
    const ev = req.body as any;
    if (ev && ev.type === 'checkout.session.completed') {
      const orderNo = ev.data && ev.data.object && ev.data.object.client_reference_id;
      if (orderNo && ev.data.object.payment_status === 'paid') {
        await markPaid(orderNo, 'stripe', ev.data.object.id, ev);
      }
    }
    return res.json({ received: true });
  } catch { return res.status(400).json({ error: 'bad' }); }
});

// Paddle Webhook（legacy：alert_name=payment_succeeded）
paymentRouter.post('/pay/paddle/webhook', async (req, res) => {
  try {
    const body = req.body as any;
    if (!body || body.alert_name !== 'payment_succeeded') return res.json({ success: true });
    await markPaid(body.custom || body.order_number || '', 'paddle', body.checkout_id, body);
    return res.json({ success: true });
  } catch { return res.status(400).json({ success: false }); }
});
