import { useState, useEffect, type FormEvent } from 'react';
import { api, setToken, ApiError } from '../api';

export default function Login() {
  // 登录成功后的跳转：用整页导航确保 token 落盘后再进入控制台，规避客户端路由一帧鉴权竞态
  const goHome = (isAdmin: boolean) => { window.location.href = isAdmin ? '/app' : '/app/keys'; };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'login' | 'totp'>('login');
  const [mode, setMode] = useState<'login' | 'register'>(() => {
    try { return new URLSearchParams(window.location.search).get('signup') === '1' ? 'register' : 'login'; } catch { return 'login'; }
  });
  const [regName, setRegName] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [pendingTok, setPendingTok] = useState('');
  const [support, setSupport] = useState<Record<string, string>>({});
  const [forgot, setForgot] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetPwd, setResetPwd] = useState('');

  useEffect(() => {
    (async () => {
      try { setSupport(await api.get<Record<string, string>>('/api/v1/public/support')); } catch { /* 忽略 */ }
      // OAuth 回跳：URL 带 oauth_token 则直接登录
      const params = new URLSearchParams(window.location.search);
      const ot = params.get('oauth_token');
      if (ot) {
        setToken(ot);
        window.history.replaceState({}, '', window.location.pathname);
        try { const m = await api.get<any>('/api/v1/auth/me'); goHome(m?.role === 'admin'); } catch { window.location.href = '/app/keys'; }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doForgot = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try { await api.post('/api/v1/auth/forgot-password', { email }); setForgotDone(true); }
    catch (ex: any) { setErr(ex?.message || '发送失败'); }
  };
  const doReset = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/api/v1/auth/reset-password', { email, code: resetCode, new_password: resetPwd });
      setForgotDone(false); setForgot(false); setResetCode(''); setResetPwd(''); setPassword(resetPwd);
      setErr('');
      setMode('login');
    } catch (ex: any) { setErr(ex?.message || '重置失败'); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const data = await api.post<any>('/api/v1/auth/login', { email, password });
      if (data?.totp_required) {
        setPendingTok(data.pending_totp_token);
        setStep('totp');
        setErr('');
        setLoading(false);
        return;
      }
      const token = data?.access_token || data?.accessToken;
      if (!token) throw new ApiError(0, '登录响应缺少 access_token');
      setToken(token);
      const me = await api.get<any>('/api/v1/auth/me');
      goHome(me?.role === 'admin');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const verifyTotp = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const data = await api.post<any>('/api/v1/auth/totp/verify', { code: totpCode, pending_token: pendingTok });
      setToken(data.access_token);
      const me = await api.get<any>('/api/v1/auth/me');
      goHome(me?.role === 'admin');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '验证码错误');
      setLoading(false);
    }
  };

  const doRegister = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const data = await api.post<any>('/api/v1/auth/register', { email, password, username: regName || undefined });
      const token = data?.access_token || data?.accessToken;
      if (!token) throw new ApiError(0, '注册响应缺少 access_token');
      setToken(token);
      const me = await api.get<any>('/api/v1/auth/me');
      goHome(me?.role === 'admin');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '注册失败');
    } finally { setLoading(false); }
  };

  const contactItems: { label: string; value: string }[] = [];
  if (support.support_qq) contactItems.push({ label: 'QQ 客服', value: support.support_qq });
  if (support.support_email) contactItems.push({ label: '客服邮箱', value: support.support_email });
  if (support.support_telegram) contactItems.push({ label: 'Telegram', value: support.support_telegram });

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={step === 'totp' ? verifyTotp : (mode === 'register' ? doRegister : submit)}>
        <div style={{ marginBottom: 18 }}>
          <a href="/" style={{ fontSize: 13, color: 'var(--text-3)' }}>← 返回官网</a>
        </div>
        <h1>中转站 Plus</h1>
        <div className="sub">AI API 中继与配额管理控制台</div>
        {err && <div className="error-box">{err}</div>}
        {step === 'totp' ? (
          <>
            <div className="field">
              <label>验证码</label>
              <input inputMode="numeric" maxLength={6} value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)} placeholder="请输入身份验证器中的 6 位 code" autoFocus />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={loading}>
              {loading ? '验证中…' : '验证并登录'}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <label>邮箱</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            {mode === 'register' && (
              <div className="field">
                <label>用户名（可选）</label>
                <input value={regName} onChange={(e) => setRegName(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label>密码</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder={mode === 'register' ? '至少 6 位' : ''} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={loading}>
              {loading ? '处理中…' : (mode === 'register' ? '注册并登录' : '登录')}
            </button>
            <div style={{ marginTop: 14, textAlign: 'center', fontSize: 13 }}>
              {mode === 'login' ? (
                <span>
                  还没有账号？ <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); setErr(''); }}>立即注册</a>
                  {' · '}
                  <a href="#" onClick={(e) => { e.preventDefault(); setForgot(true); setForgotDone(false); setErr(''); }}>忘记密码</a>
                </span>
              ) : (
                <span>已有账号？ <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setErr(''); }}>返回登录</a></span>
              )}
            </div>

            {forgot && mode === 'login' && (
              <div style={{ marginTop: 14, borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
                {!forgotDone ? (
                  <>
                    <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>输入注册邮箱，我们将发送 6 位重置验证码</div>
                    <div className="modal-actions" style={{ justifyContent: 'center' }}>
                      <button className="btn btn-sm" onClick={() => setForgot(false)}>取消</button>
                      <button className="btn btn-sm btn-primary" onClick={doForgot}>发送验证码</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>验证码已发送到 {email}（未配 SMTP 时见服务器日志）。输入验证码和新密码：</div>
                    <input value={resetCode} onChange={(e) => setResetCode(e.target.value)} placeholder="6 位验证码" style={{ marginBottom: 8, width: '100%', padding: 8 }} />
                    <input type="password" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} placeholder="新密码（至少 6 位）" style={{ marginBottom: 8, width: '100%', padding: 8 }} />
                    <div className="modal-actions" style={{ justifyContent: 'center' }}>
                      <button className="btn btn-sm" onClick={() => { setForgot(false); setForgotDone(false); }}>取消</button>
                      <button className="btn btn-sm btn-primary" onClick={doReset}>重置密码</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {mode === 'login' && !forgot && (
              <div style={{ marginTop: 10, textAlign: 'center' }}>
                <a href="/api/v1/auth/oauth/github">GitHub 登录</a>
              </div>
            )}
          </>
        )}
        {support.support_wechat && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>扫码添加客服微信</div>
            <img src={support.support_wechat} alt="客服微信" style={{ width: 120, height: 120, borderRadius: 8, border: '1px solid #e5e7eb' }} />
          </div>
        )}
        {contactItems.length > 0 && (
          <div style={{ marginTop: 14, fontSize: 12, color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
            {contactItems.map((c) => <div key={c.label} style={{ marginBottom: 4 }}>{c.label}：{c.value}</div>)}
          </div>
        )}
      </form>
    </div>
  );
}
