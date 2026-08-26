import { useEffect, useState } from 'react';
import { api } from '../api';
import type { User } from '../types';
import { Modal, StatusBadge, useToast, fmtMoney, fmtTime } from '../components/ui';

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showKey, setShowKey] = useState<User | null>(null);
  const [genKey, setGenKey] = useState('');
  const [assignUser, setAssignUser] = useState<User | null>(null);
  const [assignRoleId, setAssignRoleId] = useState<number | ''>('');
  const toast = useToast();

  const load = async () => {
    try { setUsers(await api.get<User[]>('/api/v1/admin/users')); } catch {}
    try { const d = await api.get<any>('/api/v1/admin/roles'); setRoles(d.roles || []); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const fd = new FormData(form);
    await api.post('/api/v1/admin/users', {
      email: fd.get('email'), password: fd.get('password'),
      balance: Number(fd.get('balance')) || 0, username: fd.get('username'),
    });
    toast('用户已创建');
    setShowCreate(false); load();
  };

  const toggleStatus = async (u: User) => {
    await api.patch(`/api/v1/admin/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' });
    load();
  };

  const genApiKey = async (u: User) => {
    const res = await api.post<any>('/api/v1/admin/api-keys', { user_id: u.id, name: 'generated' });
    setGenKey(res.api_key); setShowKey(u);
  };

  const assignRole = async () => {
    if (!assignUser) return;
    try { await api.patch(`/api/v1/admin/users/${assignUser.id}/role`, { role_id: assignRoleId === '' ? null : assignRoleId }); toast('角色已分配'); setAssignUser(null); load(); }
    catch (ex: any) { toast(ex?.message || '分配失败', 'err'); }
  };

  if (loading) return <div className="empty">加载中…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>用户管理</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>新建用户</button>
      </div>

      <div className="card">
        <table className="data">
          <thead><tr><th>ID</th><th>邮箱</th><th>角色</th><th>状态</th><th>余额 (USD)</th><th>累计消耗</th><th>Key 数</th><th>注册时间</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.email}</td>
                <td>{u.role === 'admin' ? '管理员' : '用户'}</td>
                <td><StatusBadge status={u.status} /></td>
                <td>{fmtMoney(u.balance)}</td>
                <td>{fmtMoney(u.spent)}</td>
                <td>{u.key_count ?? 0}</td>
                <td>{fmtTime(u.created_at)}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => genApiKey(u)}>生成 Key</button>
                  <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => { setAssignUser(u); setAssignRoleId(''); }}>分配角色</button>
                  <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => toggleStatus(u)}>{u.status === 'active' ? '禁用' : '启用'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="新建用户" onClose={() => setShowCreate(false)}>
          <form onSubmit={createUser}>
            <div className="field"><label>邮箱</label><input name="email" type="email" required /></div>
            <div className="field"><label>密码</label><input name="password" type="password" required minLength={6} /></div>
            <div className="field"><label>用户名</label><input name="username" /></div>
            <div className="field"><label>初始余额 (USD)</label><input name="balance" type="number" step="0.01" defaultValue={0} /></div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" type="submit">创建</button>
            </div>
          </form>
        </Modal>
      )}

      {showKey && (
        <Modal title={`为用户 ${showKey.email} 生成 Key`} onClose={() => { setShowKey(null); setGenKey(''); }}>
          <div className="ok-box">完整 Key 仅显示一次：</div>
          <div style={{ background: '#111827', color: '#86efac', padding: 14, borderRadius: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>{genKey}</div>
          <div className="modal-actions">
            <button className="btn" onClick={() => { navigator.clipboard.writeText(genKey); toast('已复制'); }}>复制</button>
            <button className="btn btn-primary" onClick={() => { setShowKey(null); setGenKey(''); }}>完成</button>
          </div>
        </Modal>
      )}

      {assignUser && (
        <Modal title={`为 ${assignUser.email} 分配角色`} onClose={() => setAssignUser(null)}>
          <div className="field"><label>角色</label>
            <select value={assignRoleId} onChange={(e) => setAssignRoleId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">（不分配/普通用户）</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}（{r.permissions.length} 项权限）</option>)}
            </select>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setAssignUser(null)}>取消</button>
            <button className="btn btn-primary" onClick={assignRole}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
