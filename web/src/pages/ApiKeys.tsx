import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ApiKey, Group } from '../types';
import { StatusBadge, useToast, fmtTime } from '../components/ui';

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [userId, setUserId] = useState(0);
  const toast = useToast();

  const load = async () => {
    try {
      const [k, g] = await Promise.all([
        api.get<ApiKey[]>('/api/v1/admin/api-keys'),
        api.get<Group[]>('/api/v1/admin/groups').catch(() => [] as Group[]),
      ]);
      setKeys(k); setGroups(g);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (k: ApiKey) => {
    await api.patch(`/api/v1/admin/api-keys/${k.id}`, { status: k.status === 'active' ? 'disabled' : 'active' });
    load();
  };
  const remove = async (k: ApiKey) => {
    if (!confirm(`删除 Key ${k.key_prefix}…${k.key_tail}？`)) return;
    await api.del(`/api/v1/admin/api-keys/${k.id}`);
    toast('已删除'); load();
  };
  const gen = async () => {
    if (!Number.isInteger(userId) || userId <= 0) return toast('请输入有效的用户 ID（正整数）', 'err');
    const res = await api.post<any>('/api/v1/admin/api-keys', { user_id: userId, name: 'generated' });
    setNewKey(res.api_key); setShowNew(false);
    load();
  };

  if (loading) return <div className="empty">加载中…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>API Key 管理</h1>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>生成 Key</button>
      </div>

      {newKey && (
        <div className="card" style={{ border: '1px solid #bbf7d0', background: '#f0fdf4' }}>
          <h2>新 Key（仅显示一次）</h2>
          <div style={{ background: '#111827', color: '#86efac', padding: 14, borderRadius: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>{newKey}</div>
          <div style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => { navigator.clipboard.writeText(newKey); toast('已复制'); }}>复制并关闭</button>
            <button className="btn" style={{ marginLeft: 8 }} onClick={() => setNewKey('')}>关闭</button>
          </div>
        </div>
      )}

      {showNew && (
        <div className="card">
          <h2>为用户生成 Key</h2>
          <div className="field"><label>用户 ID</label><input type="number" min={1} placeholder="输入要给 Key 的用户 ID（数字）" value={userId || ''} onChange={(e) => setUserId(e.target.value === '' ? 0 : Number(e.target.value))} /></div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowNew(false)}>取消</button>
            <button className="btn btn-primary" onClick={gen}>生成</button>
          </div>
        </div>
      )}

      <div className="card">
        {keys.length === 0 ? <div className="empty">尚无 API Key。</div> : (
          <table className="data">
            <thead><tr><th>ID</th><th>用户</th><th>名称</th><th>Key</th><th>分组</th><th>限额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.id}</td>
                  <td>{k.user_email || `#${k.user_id}`}</td>
                  <td>{k.name}</td>
                  <td className="mono">{k.key_prefix}…{k.key_tail}</td>
                  <td>{k.group_name || groups.find((g) => g.id === k.group_id)?.name || '-'}</td>
                  <td>{[k.rps_limit && `${k.rps_limit}RPS`, k.rpm_limit && `${k.rpm_limit}RPM`, k.tpm_limit && `${k.tpm_limit}TPM`].filter(Boolean).join(' ') || '-'}</td>
                  <td><StatusBadge status={k.status} /></td>
                  <td>{fmtTime(k.created_at)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => toggle(k)}>{k.status === 'active' ? '禁用' : '启用'}</button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(k)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
