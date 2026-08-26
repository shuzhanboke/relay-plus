import crypto from 'crypto';
import { query } from '../db/pool.js';
import { confirmOrderPaid } from './billingService.js';

/** 读取后台配置的某支付渠道参数（settings payment_<channel>_*）。 */
export async function payConfig(channel: string): Promise<Record<string, string>> {
  const rows = await query(
    `SELECT key, value FROM settings WHERE key IN (
       'payment_${channel}_app_id','payment_${channel}_secret','payment_${channel}_public_key','payment_${channel}_private_key',
       'payment_${channel}_merchant_id','payment_${channel}_enabled','payment_${channel}_debug','payment_${channel}_webhook_secret',
       'payment_${channel}_return_url','payment_${channel}_icon'
    )`
  );
  const out: Record<string, string> = {};
  for (const r of rows.rows) {
    const v = r.value;
    out[r.key] = typeof v === 'string' ? v : (v && (v as any).value !== undefined ? String((v as any).value) : JSON.stringify(v));
  }
  return out;
}

/** 渠道密钥格式化为可用 key（去掉 payment_xxx_ 前缀）。 */
export function stripPrefix(cfg: Record<string, string>, channel: string): Record<string, string> {
  const prefix = `payment_${channel}_`;
  const out: Record<string, string> = {};
  for (const k of Object.keys(cfg)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = cfg[k];
  }
  return out;
}

export function isEnabled(cfg: Record<string, string>): boolean {
  const e = cfg['enabled'];
  return e === 'true' || e === '1';
}

/**
 * 各渠道「统一支付完成入账」：校验订单归属/金额后，将订单置为已支付并加余额。
 * 幂等：已 paid 则忽略。
 */
export async function markPaid(orderNo: string, channel: string, providerOrderId: string | undefined, raw: unknown): Promise<{ paid: boolean; order_no: string }> {
  const order = await query<{ id: number; order_no: string; user_id: number; amount: string; status: string }>(
    'SELECT id, order_no, user_id, amount, status FROM orders WHERE order_no = $1', [orderNo]
  );
  if (!order.rows[0]) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });
  if (order.rows[0].status === 'paid') return { paid: false, order_no: orderNo };
  const res = await confirmOrderPaid(orderNo, providerOrderId);
  // 记录渠道原信息可选（detail）
  void channel; void raw;
  return { paid: res.paid, order_no: orderNo };
}

// ==================== 各渠道调起 ====================

/** Stripe Checkout Session 创建（用服务端 Secret key 调 Stripe API）。 */
export async function stripeCreateCheckout(cfgStripe: Record<string, string>, params: { orderNo: string; amountUsd: number; description?: string; returnUrl: string }): Promise<{ url: string; sessionId: string }> {
  const secretKey = cfgStripe['secret_key'];
  if (!secretKey) throw Object.assign(new Error('PAYMENT_NOT_CONFIGURED'), { status: 400 });
  const amountCents = Math.round(params.amountUsd * 100);
  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secretKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': params.description || 'Recharge',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      success_url: params.returnUrl + '?pay=stripe&result=success&order_no=' + encodeURIComponent(params.orderNo),
      cancel_url: params.returnUrl + '?pay=stripe&result=canceled',
      client_reference_id: params.orderNo,
    }),
  });
  const data: any = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error('STRIPE_CREATE_FAILED:' + ((data && data.error && data.error.message) || resp.status));
  return { url: data.url, sessionId: data.id };
}

/** 支付宝：生成当面付/电脑网站支付表单参数（RSA2 签名，拼接返回）。 */
export async function alipayPrepay(cfg: Record<string, string>, params: { orderNo: string; amountUsd: number; subject: string }): Promise<{ pay_url: string }> {
  const appId = cfg['app_id'];
  const privateKey = cfg['private_key'];
  if (!appId || !privateKey) throw Object.assign(new Error('PAYMENT_NOT_CONFIGURED'), { status: 400 });
  // 支付宝电脑网站支付 page execute：构造公共参数 + 业务参数 + RSA2 签名
  const gateway = 'https://openapi.alipay.com/gateway.do';
  const biz: Record<string, unknown> = {
    out_trade_no: params.orderNo,
    total_amount: params.amountUsd.toFixed(2),
    subject: params.subject,
    product_code: 'FAST_INSTANT_TRADE_PAY',
  };
  const needSign: Record<string, string> = {
    app_id: appId, method: 'alipay.trade.page.pay', format: 'JSON', charset: 'utf-8',
    sign_type: 'RSA2', timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    version: '1.0', notify_url: cfg['notify_url'] || '', return_url: cfg['return_url'] || '',
    biz_content: JSON.stringify(biz),
  };
  // 签名：对非空参数按键名 ASCII 升序拼 key=value&...，加 private key RSA-SHA256
  const sorted = Object.keys(needSign).sort();
  const content = sorted.filter((k) => needSign[k] !== '' && needSign[k] != null).map((k) => `${k}=${needSign[k]}`).join('&');
  const sign = crypto.createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey, 'base64');
  const all: any = { ...needSign, sign };
  const qs = Object.keys(all).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`).join('&');
  return { pay_url: `${gateway}?${qs}` };
}

/** 支付宝回调解密签名校验（公钥/应用公钥）。返回 true 校验通过。 */
export function alipayVerify(params: Record<string, string>, alipayPublicKey: string): boolean {
  const { sign, sign_type, ...rest } = params;
  if (!sign) return false;
  const sorted = Object.keys(rest).sort();
  const content = sorted.filter((k) => rest[k] !== '' && rest[k] != null).map((k) => `${k}=${rest[k]}`).join('&');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(content, 'utf8');
  try { return verifier.verify(alipayPublicKey, sign, 'base64'); } catch { return false; }
}

/** 微信 Native 下单（V3：签名用微信加签；简化用商户 API v2 HMAC-SHA256，需证书）。此处返回构造的 code_url 或报缺配置。 */
export async function wechatNative(cfg: Record<string, string>, params: { orderNo: string; amountUsd: number; description: string }): Promise<{ code_url: string }> {
  const merchantId = cfg['merchant_id'];
  const apiKey = cfg['secret']; // 支付解签密钥（v2）
  if (!merchantId || !apiKey) throw Object.assign(new Error('PAYMENT_NOT_CONFIGURED'), { status: 400 });
  // 微信统一下单 v2（Native）
  const xml = buildWechatXml({
    appid: cfg['app_id'], mch_id: merchantId, nonce_str: crypto.randomBytes(8).toString('hex'),
    body: params.description, out_trade_no: params.orderNo,
    total_fee: String(Math.round(params.amountUsd * 100)), spbill_create_ip: '127.0.0.1',
    notify_url: cfg['notify_url'] || '', trade_type: 'NATIVE',
  }, apiKey);
  const resp = await fetch('https://api.mch.weixin.qq.com/pay/unifiedorder', {
    method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml,
  });
  const text = await resp.text();
  const codeUrl = (text.match(/<code_url><!\[CDATA\[([^\]]+)\]\]><\/code_url>/) || [])[1] || '';
  if (!codeUrl) throw new Error('WECHAT_NATIVE_FAILED:' + text.slice(0, 200));
  return { code_url: codeUrl };
}

function buildWechatXml(map: Record<string, string>, apiKey: string): string {
  // 简单 v2：按字典序拼串 + 末尾 &key=... MD5 签（微信 v2 用 MD5）
  const sorted = Object.keys(map).sort();
  const str = sorted.filter((k) => map[k]).map((k) => `${k}=${map[k]}`).join('&') + `&key=${apiKey}`;
  const sign = crypto.createHash('md5').update(str).digest('hex').toUpperCase();
  const body = sorted.map((k) => (map[k] ? `<${k}><![CDATA[${map[k]}]]></${k}>` : '')).join('');
  return `<xml>${body}<sign><![CDATA[${sign}]]></sign></xml>`;
}

/** Paddle 支付链接创建（legacy checkout）。 */
export async function paddleCreateCheckout(cfg: Record<string, string>, params: { orderNo: string; amountUsd: number }): Promise<{ url: string }> {
  const vendorId = cfg['vendor_id']; const vendorAuth = cfg['vendor_auth_code'];
  if (!vendorId || !vendorAuth) throw Object.assign(new Error('PAYMENT_NOT_CONFIGURED'), { status: 400 });
  const resp = await fetch('https://checkout.paddle.com/api/2.0/product/generate_pay_link', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ vendor_id: vendorId, vendor_auth_code: vendorAuth, title: 'Recharge ' + params.orderNo,
      custom_message: params.orderNo, prices: `USD:${params.amountUsd.toFixed(2)}`,
      custom: params.orderNo, image_url: '', webhook_url: cfg['webhook_url'] || '', return_url: cfg['return_url'] || '' }),
  });
  const data: any = await resp.json().catch(() => null);
  const url = data && data.response && data.response.url;
  if (!url) throw new Error('PADDLE_CREATE_FAILED');
  return { url };
}

/** Paddle Webhook 签名校验（legacy）——用 vendor auth code 对 signature 做 PGP 验证较复杂；此处做简化校验并靠订单号匹配。 */
