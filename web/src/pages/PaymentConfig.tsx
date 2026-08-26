import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/ui';

const KEYS: [string, string, string, string][] = [
  ['payment_cards_enabled', '卡密兑换', '开启后用户可用卡密充值（默认开启）', 'bool'],
  ['payment_manual_enabled', '人工转账', '开启后用户可提交人工转账订单，你确认后到账', 'bool'],
  ['payment_manual_info', '人工转账说明', '告诉用户转哪里/备注什么/联系谁', 'text'],
  ['payment_test_qr_label', '测试收款码名称', '如「支付宝扫码（测试）」；留空则显示“扫码转账（测试）”', 'text'],
  ['payment_test_qr_info', '测试收款码说明', '显示在收款码下方的转账说明', 'text'],
  ['payment_usdt_address', 'USDT(TRC20) 收款地址', '填你的 TRC20 地址，用户扫码转账自动到账', 'text'],
  ['payment_stripe_enabled', '信用卡 Stripe', '海外客户卡支付', 'bool'],
  ['payment_stripe_secret_key', 'Stripe Secret Key (sk_...)', 'Stripe 服务端密钥', 'text'],
  ['payment_stripe_public_key', 'Stripe Publishable Key (pk_...)', 'Stripe 可发布公钥', 'text'],
  ['payment_stripe_webhook_secret', 'Stripe Webhook Secret (whsec_...)', 'Stripe 回调验签密钥（可选）', 'text'],
  ['payment_alipay_enabled', '支付宝', '需支付宝商户号+密钥', 'bool'],
  ['payment_alipay_app_id', '支付宝 AppID', '开放平台应用 APPID', 'text'],
  ['payment_alipay_private_key', '支付宝应用私钥', 'RSA2 应用私钥', 'text'],
  ['payment_alipay_public_key', '支付宝公钥', '用于验签回调', 'text'],
  ['payment_wechat_enabled', '微信支付', '需微信商户号+API密钥', 'bool'],
  ['payment_wechat_app_id', '微信 AppID', '公众号/服务号 AppID', 'text'],
  ['payment_wechat_merchant_id', '微信商户号 (mch_id)', '商户号', 'text'],
  ['payment_wechat_secret', '微信 API 密钥', '支付解签密钥', 'text'],
  ['payment_paddle_enabled', 'Paddle（海外个人可）', '个人可注册的海外 Merchant of Record', 'bool'],
  ['payment_paddle_vendor_id', 'Paddle Vendor ID', '供应商 ID', 'text'],
  ['payment_paddle_vendor_auth_code', 'Paddle Vendor Auth Code', '供应商授权码', 'text'],
  ['payment_paddle_webhook_url', 'Paddle Webhook URL', '（一般自动带，可留空）', 'text'],
];

export default function PaymentConfig() {
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [testQrImage, setTestQrImage] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const toast = useToast();

  const load = async () => {
    try {
      const s = await api.get<Record<string, unknown>>('/api/v1/admin/settings');
      const out: Record<string, string> = {};
      for (const [k] of KEYS) {
        const v = s[k];
        out[k] = typeof v === 'string' ? v : (v && (v as any).value !== undefined ? String((v as any).value) : '');
      }
      setCfg(out);
      setTestQrImage(out.payment_test_qr_image ?? '');
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      for (const [k] of KEYS) { await api.post('/api/v1/admin/settings', { key: k, value: cfg[k] || '' }); }
      // 测试收款码图片单独存
      if (testQrImage) await api.post('/api/v1/admin/settings', { key: 'payment_test_qr_image', value: testQrImage });
      toast('收款配置已保存并生效');
      load();
    } catch (ex: any) { toast(ex?.message || '保存失败', 'err'); }
    setBusy(false);
  };

  const uploadQr = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUri = reader.result as string;
        const r = await api.post<any>('/api/v1/admin/upload', { data_uri: dataUri, folder: 'payment' });
        setTestQrImage(r.url);
        setCfg((c) => ({ ...c, payment_test_qr_image: r.url }));
        toast('收款码已上传');
      };
      reader.readAsDataURL(file);
    } catch (ex: any) { toast(ex?.message || '上传失败', 'err'); }
    setUploading(false);
  };

  return (
    <div>
      <div className="page-head"><h1>收款配置生成器</h1></div>
      <div className="card">
        <div className="ok-box">在这里填好关键信息点保存，对应的支付方式会自动在用户充值页出现（无需改代码）。</div>
        <div className="card" style={{ border: '1px solid #fed7aa', background: '#fff7ed' }}>
          <h2 style={{ marginTop: 0 }}>测试专属收款码（个人码扫码转账 · 仅测试用）</h2>
          <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
            无需商户号，上传你的支付宝/微信个人收款码图片。用户在充值中心选「扫码转账（测试）」即可看到此码并生成订单，你到「订单管理」里人工确认到账。<b>个人码无自动回调，必须人工确认。</b>
          </div>
          <div className="field">
            <label>收款码图片</label>
            <input type="file" accept="image/*" onChange={(e) => uploadQr(e.target.files?.[0])} />
            <div className="hint" style={{ marginTop: 6 }}>
              {uploading ? '上传中…' : '选择 jpg/png/webp/gif（≤3MB）后自动上传'}
            </div>
            {testQrImage && (
              <img src={testQrImage} alt="收款码预览" style={{ marginTop: 8, width: 150, height: 150, border: '1px solid #d1d5db', borderRadius: 8 }} />
            )}
          </div>
        </div>
        {KEYS.map(([k, label, hint, type]) => (
          <div key={k} className="field">
            <label>{label}</label>
            {type === 'bool' ? (
              <select value={cfg[k] || ''} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}>
                <option value="">关闭</option>
                <option value="true">开启</option>
              </select>
            ) : (
              <input value={cfg[k] || ''} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} placeholder={hint} />
            )}
            <div className="hint">{hint}</div>
          </div>
        ))}
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存配置并生效'}</button>
        </div>
      </div>
      <div className="card">
        <h2>说明</h2>
        <ul style={{ fontSize: 13.5, lineHeight: 2, paddingLeft: 20, margin: 0 }}>
          <li><b>卡密兑换</b>：默认开启，无需配置即可用（管理员在卡密管理发卡）。</li>
          <li><b>人工转账</b>：开启后用户提交转账订单，你在「订单管理」确认到账即加余额。</li>
          <li><b>USDT (TRC20)</b>：填收款地址即可启用；用户转账后需手动在订单确认（自动扫描可选）。</li>
          <li><b>信用卡 Stripe</b>：需你在 stripe.com 注册商户号，填 Public Key / Secret Key 后可用。</li>
        </ul>
      </div>
    </div>
  );
}
