import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useToast, fmtMoney } from '../components/ui';
import { UserCircle, Envelope, ShieldCheck, CurrencyDollar, LockKey } from '@phosphor-icons/react';

export default function Profile() {
  const [me, setMe] = useState<any>(null);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => { (async () => { try { setMe(await api.get('/api/v1/auth/me')); } catch {} })(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPwd.length < 6) return toast('新密码至少 6 位', 'err');
    if (newPwd !== newPwd2) return toast('两次输入的新密码不一致', 'err');
    setBusy(true);
    try {
      await api.post('/api/v1/auth/change-password', { old_password: oldPwd, new_password: newPwd });
      toast('密码已修改'); setOldPwd(''); setNewPwd(''); setNewPwd2('');
    } catch (ex: any) { toast(ex?.message || '修改失败', 'err'); }
    setBusy(false);
  };

  const info = [
    { k: '邮箱', v: me?.email || '-', icon: Envelope },
    { k: '用户名', v: me?.username || '-', icon: UserCircle },
    { k: '角色', v: me?.role === 'admin' ? '管理员' : '用户', icon: ShieldCheck },
    { k: '当前余额', v: fmtMoney(me?.balance), icon: CurrencyDollar },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>我的资料</h1>
          <div className="page-sub">账号信息与安全设置</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><UserCircle size={16} weight="regular" />账号信息</h2>
        <div className="kv-grid">
          {info.map(({ k, v, icon: Icon }) => (
            <div className="kv-cell" key={k}>
              <div className="kv-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon size={13} weight="regular" />{k}</div>
              <div className="kv-value">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LockKey size={16} weight="regular" />修改密码</h2>
        <form onSubmit={submit}>
          <div className="field"><label>原密码</label><input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} required /></div>
          <div className="field"><label>新密码</label><input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} required minLength={6} /></div>
          <div className="field"><label>确认新密码</label><input type="password" value={newPwd2} onChange={(e) => setNewPwd2(e.target.value)} required /></div>
          <button className="btn btn-primary" disabled={busy}>{busy ? '处理中…' : '保存新密码'}</button>
        </form>
      </div>
    </div>
  );
}
