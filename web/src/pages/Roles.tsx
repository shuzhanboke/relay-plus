import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmtTime } from '../components/ui';

interface Role { id: number; name: string; description: string | null; permissions: string[]; is_system: boolean; created_at: string }
interface PermGroup { [group: string]: { key: string; label: string; desc?: string }[] }

export default function Roles() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<PermGroup>({});
  const [editing, setEditing] = useState<Role | null>(null);
  const [showNew, setShowNew] = useState(false);
  const toast = useToast();

  const load = async () => {
    try {
      const d = await api.get<{ roles: Role[]; permission_groups: PermGroup }>('/api/v1/admin/roles');
      setRoles(d.roles); setGroups(d.permission_groups);
    } catch { }
  };
  useEffect(() => { load(); }, []);

  const save = async (r: Role) => {
    if (!r.name.trim()) return toast('角色名不能为空', 'err');
    try {
      if (r.id) await api.patch(`/api/v1/admin/roles/${r.id}`, { name: r.name, description: r.description, permissions: r.permissions });
      else await api.post('/api/v1/admin/roles', { name: r.name, description: r.description, permissions: r.permissions });
      toast('角色已保存'); setEditing(null); setShowNew(false); load();
    } catch (ex: any) { toast(ex?.message || '保存失败', 'err'); }
  };

  const remove = async (r: Role) => {
    if (!confirm(`删除角色「${r.name}」？`)) return;
    try { await api.del(`/api/v1/admin/roles/${r.id}`); toast('已删除'); load(); }
    catch (ex: any) { toast(ex?.message || '删除失败', 'err'); }
  };

  const togglePerm = (r: Role, key: string) => {
    const has = r.permissions.includes(key);
    setEditing(editing && editing.id === r.id ? { ...editing, permissions: has ? r.permissions.filter(p => p !== key) : [...r.permissions, key] } : r);
    if (editing && editing.id === r.id) setRoles(roles.map(x => x.id === r.id ? { ...x, permissions: has ? x.permissions.filter(p => p !== key) : [...x.permissions, key] } : x));
  };

  const editor = editing ?? (showNew ? { id: 0, name: '', description: '', permissions: [], is_system: false, created_at: '' } : null);

  return (
    <div>
      <div className="page-head"><h1>角色管理</h1><button className="btn btn-primary" onClick={() => { setShowNew(true); setEditing({ id: 0, name: '', description: '', permissions: [], is_system: false, created_at: '' }); }}>新建角色</button></div>

      <div className="card">
        <table className="data">
          <thead><tr><th>ID</th><th>角色名</th><th>权限数</th><th>系统内置</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            {roles.map(r => (
              <tr key={r.id}>
                <td>{r.id}</td><td>{r.name}</td><td>{r.permissions.length}</td>
                <td>{r.is_system ? '是' : '否'}</td><td>{fmtTime(r.created_at)}</td>
                <td>
                  <button className="btn btn-sm" onClick={() => { setEditing(r); setShowNew(false); }}>编辑权限</button>
                  {!r.is_system && <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(r)}>删除</button>}
                </td>
              </tr>
            ))}
            {roles.length === 0 && <tr><td colSpan={6} className="empty">暂无角色</td></tr>}
          </tbody>
        </table>
      </div>

      {editor && (
        <div className="card">
          <h2>{editor.id ? '编辑角色' : '新建角色'}</h2>
          <div className="grid-2">
            <div className="field"><label>角色名</label><input value={editor.name} onChange={(e) => setEditing({ ...editor, name: e.target.value })} /></div>
            <div className="field"><label>描述</label><input value={editor.description || ''} onChange={(e) => setEditing({ ...editor, description: e.target.value })} /></div>
          </div>
          <h3 style={{ fontSize: 14 }}>权限矩阵（勾选开通）</h3>
          {Object.entries(groups).map(([g, permsList]) => (
            <div key={g} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{g}</div>
              {permsList.map(p => (
                <label key={p.key} style={{ display: 'inline-flex', gap: 4, margin: '2px 14px 2px 0', fontSize: 13 }}>
                  <input type="checkbox" checked={editor.permissions.includes(p.key)} onChange={() => togglePerm(editor, p.key)} /> {p.label}
                </label>
              ))}
            </div>
          ))}
          <div className="modal-actions">
            <button className="btn" onClick={() => { setEditing(null); setShowNew(false); }}>取消</button>
            <button className="btn btn-primary" onClick={() => save(editor)}>保存</button>
          </div>
        </div>
      )}
    </div>
  );
}
