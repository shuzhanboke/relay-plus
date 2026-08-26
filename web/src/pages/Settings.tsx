import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/ui';

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [name, setName] = useState('中转站 Plus');
  const [multiplier, setMultiplier] = useState('1');
  const [support, setSupport] = useState<{ wechat: string; qq: string; email: string; telegram: string }>({ wechat: '', qq: '', email: '', telegram: '' });
  const toast = useToast();

  const load = async () => {
    try {
      const s = await api.get<Record<string, unknown>>('/api/v1/admin/settings');
      setSettings(s);
      if (typeof s.system_name === 'string') setName(s.system_name);
      else if (s.system_name && typeof s.system_name === 'object') setName(String((s.system_name as any).value ?? ''));
      const sup = (k: string) => { const v = s['support_' + k]; return typeof v === 'string' ? v : (v && (v as any).value !== undefined ? String((v as any).value) : ''); };
      setSupport({ wechat: sup('wechat'), qq: sup('qq'), email: sup('email'), telegram: sup('telegram') });
      const mv = s['billing_rate_multiplier'];
      setMultiplier(typeof mv === 'string' ? mv : (mv && typeof mv === 'object' && (mv as any).value !== undefined ? String((mv as any).value) : '1'));
    } catch { /* 忽略 */ }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    try { await api.post('/api/v1/admin/settings', { key: 'system_name', value: name }); toast('已保存'); load(); }
    catch (e: any) { toast(e?.message || '保存失败', 'err'); }
  };
  const saveMultiplier = async () => {
    const n = Number(multiplier);
    if (!Number.isFinite(n) || n <= 0) return toast('倍率需为大于 0 的数字', 'err');
    try { await api.post('/api/v1/admin/settings', { key: 'billing_rate_multiplier', value: String(n) }); toast('售价倍率已保存'); } catch (e: any) { toast(e?.message || '保存失败', 'err'); }
  };
  const saveSupport = async (k: string) => {
    const map = { wechat: support.wechat, qq: support.qq, email: support.email, telegram: support.telegram } as Record<string, string>;
    try { await api.post('/api/v1/admin/settings', { key: 'support_' + k, value: map[k] }); toast('客服信息已保存'); }
    catch (e: any) { toast(e?.message || '保存失败', 'err'); }
  };

  const gateways = [
    { name: 'Claude Code', keys: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'], hint: 'Base URL 填 http://你的域名，Token 填面板生成的 sk- Key' },
    { name: 'Codex / OpenAI SDK', keys: ['OPENAI_BASE_URL', 'OPENAI_API_KEY'], hint: 'Base URL 填 http://你的域名/v1' },
    { name: 'OpenAI Python SDK', keys: ['client = OpenAI(base_url="http://你的域名/v1", api_key="sk-...")'], hint: '' },
  ];

  return (
    <div>
      <div className="page-head"><h1>系统设置</h1></div>
      <div className="card">
        <h2>站点信息</h2>
        <div className="field"><label>系统名称</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="modal-actions" style={{ justifyContent: 'flex-start' }}><button className="btn btn-primary" onClick={save}>保存</button></div>
      </div>

      <div className="card">
        <h2>售价倍率（下游 API）</h2>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 10 }}>终端用户的实际单价 = 模型基准价 × 此倍率（默认 1）。例如设为 1.2，所有模型对用户涨价 20%。保存后即时生效。</div>
        <div className="field"><label>售价倍率</label><input type="number" step="0.01" min="0.01" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={saveMultiplier}>保存倍率</button>
      </div>

      <div className="card">
        <h2>客服入口（显示在登录页）</h2>
        <div className="field"><label>客服微信二维码图片 URL</label><input value={support.wechat} onChange={(e) => setSupport({ ...support, wechat: e.target.value })} placeholder="https://…/wechat.jpg" />
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => saveSupport('wechat')}>保存微信</button></div>
        <div className="field"><label>QQ 客服号</label><input value={support.qq} onChange={(e) => setSupport({ ...support, qq: e.target.value })} placeholder="如 123456789" />
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => saveSupport('qq')}>保存 QQ</button></div>
        <div className="field"><label>客服邮箱</label><input value={support.email} onChange={(e) => setSupport({ ...support, email: e.target.value })} placeholder="support@shuzhan.one" />
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => saveSupport('email')}>保存邮箱</button></div>
        <div className="field"><label>Telegram</label><input value={support.telegram} onChange={(e) => setSupport({ ...support, telegram: e.target.value })} placeholder="https://t.me/xxx" />
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => saveSupport('telegram')}>保存 Telegram</button></div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>填了哪项就在登录页显示哪项；二维码请填图片直链。</div>
      </div>

      <div className="card">
        <h2>客户端接入指南</h2>
        <table className="data">
          <thead><tr><th>客户端</th><th>配置</th></tr></thead>
          <tbody>
            {gateways.map((g) => (
              <tr key={g.name}>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{g.name}</td>
                <td>
                  {g.keys.map((k) => <div key={k} className="mono">{k}</div>)}
                  {g.hint && <div style={{ color: '#6b7280', fontSize: 12.5, marginTop: 4 }}>{g.hint}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>FlowPilot 批量注册对接</h2>
        <ol style={{ fontSize: 13.5, lineHeight: 2, paddingLeft: 20, margin: 0 }}>
          <li>在 <b>分组管理</b> 创建分组（例如 <span className="mono">codex</span>）；</li>
          <li>在 <b>上游账号</b> 配置默认代理（可选）；</li>
          <li>FlowPilot 扩展侧设置：<b>来源 = SUB2API</b>，<b>SUB2API</b> = <span className="mono">http://你的域名/admin/accounts</span>，填入本面板管理员邮箱/密码，<b>分组</b> 填上述分组名；</li>
          <li>邮箱生成/邮箱服务选 Cloudflare Temp Email，短信选 HeroSMS（OpenAI 建议巴西号码）；</li>
          <li>单步跑通 Step 1 → 4 → 10 后，可开 Auto 批量；账号会自动回写进<b>上游账号</b>列表。</li>
        </ol>
      </div>

      <div className="card">
        <h2>运维建议</h2>
        <ul style={{ fontSize: 13.5, lineHeight: 2, margin: 0, paddingLeft: 20 }}>
          <li>定期备份 <span className="mono">relay_pgdata</span>（PostgreSQL 卷）。</li>
          <li>生产环境务必通过 Nginx/Caddy 反代到 8080，并启用 HTTPS。</li>
          <li>反向代理如遇 Codex 粘性会话问题，在 Nginx <span className="mono">http</span> 块加 <span className="mono">underscores_in_headers on;</span></li>
          <li>修改 <span className="mono">JWT_SECRET</span> 与管理员密码，避免使用默认值。</li>
        </ul>
      </div>

      <div className="card">
        <h2>当前配置</h2>
        <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.9, wordBreak: 'break-all' }}>
          {(() => {
            const redactKey = (k: string) => /(secret|private_key|auth_code|_key$|webhook_secret)/i.test(k);
            const rows = Object.entries(settings)
              .filter(([k]) => !redactKey(k))
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
            return rows.length ? rows.join('\n') : '（无可展示的非敏感配置）';
          })()}
        </div>
        <div className="hint" style={{ marginTop: 10 }}>为安全起见，密钥类配置已隐藏，不在页面明文回显。</div>
      </div>
    </div>
  );
}
