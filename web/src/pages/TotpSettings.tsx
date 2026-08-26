import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../components/ui';

export default function TotpSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const toast = useToast();

  const load = async () => {
    try {
      const r = await api.get<any>('/api/v1/auth/totp/setup');
      setEnabled(r.enabled);
      setSecret(r.secret || '');
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); }, []);

  const enable = async () => {
    if (!/^\d{6}$/.test(code)) return toast('请输入 6 位验证码', 'err');
    setStatus('loading');
    try { await api.post('/api/v1/auth/totp/enable', { code }); toast('已启用两步验证'); setEnabled(true); } catch (ex: any) { toast(ex?.message || '启用失败', 'err'); }
    setStatus('idle');
  };
  const disable = async () => {
    if (!/^\d{6}$/.test(code)) return toast('请输入 6 位验证码', 'err');
    setStatus('loading');
    try { await api.post('/api/v1/auth/totp/disable', { code }); toast('已关闭两步验证'); setEnabled(false); setSecret(''); } catch (ex: any) { toast(ex?.message || '关闭失败', 'err'); }
    setStatus('idle');
  };

  if (enabled === null) return <div className="empty">加载中…</div>;

  return (
    <div>
      <div className="page-head"><h1>两步验证 (TOTP)</h1></div>
      <div className="card">
        {enabled ? (
          <>
            <div className="ok-box">✅ 已启用两步验证。每次登录需输入身份验证器中的动态验证码。</div>
            <div className="field"><label>输入当前验证码以关闭</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" /></div>
            <button className="btn btn-danger" disabled={status === 'loading'} onClick={disable}>{status === 'loading' ? '处理中…' : '关闭两步验证'}</button>
          </>
        ) : (
          <>
            <div className="ok-box">启用后登录需要「密码 + 动态验证码」两步，提高账号安全。</div>
            <p style={{ fontSize: 13, color: '#374151' }}>
              1. 在 <b>Google Authenticator</b> 或 <b>Authy</b> 等应用中手动添加账号，输入下方密钥（密钥仅展示一次）。
            </p>
            {secret && <div className="mono" style={{ background: '#f3f4f6', padding: 10, borderRadius: 8, textAlign: 'center', letterSpacing: 2 }}>{secret}</div>}
            <p style={{ fontSize: 13, color: '#374151', marginTop: 12 }}>2. 输入应用中显示的 6 位验证码以启用。</p>
            <div className="field"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位验证码" /></div>
            <button className="btn btn-primary" disabled={status === 'loading'} onClick={enable}>{status === 'loading' ? '处理中…' : '启用两步验证'}</button>
          </>
        )}
      </div>
    </div>
  );
}
