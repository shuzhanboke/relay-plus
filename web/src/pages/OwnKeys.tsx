import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ApiKey, Group } from '../types';
import { Modal, StatusBadge, useToast, fmtTime } from '../components/ui';
import TestApiDialog from '../components/TestApiDialog';
import { PencilSimple, Copy } from '@phosphor-icons/react';

export default function OwnKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [edit, setEdit] = useState<ApiKey | null>(null);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [rpm, setRpm] = useState('');
  const [tpm, setTpm] = useState('');
  const [newKey, setNewKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [testOpen, setTestOpen] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setKeys(await api.get<ApiKey[]>('/api/v1/me/api-keys')); } catch {}
    try { const p = await api.get<any>('/api/v1/public/pricing'); setGroups((p?.groups || []).map((g: any) => ({ id: g.id, name: g.name, platform: g.platform, description: null, created_at: '', rate_multiplier: g.rate_multiplier }))); } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => { setName(''); setGroupId(''); setRpm(''); setTpm(''); setNewKey(''); };

  const create = async () => {
    const res = await api.post<any>('/api/v1/me/api-keys', {
      name: name || 'default',
      group_id: groupId ? Number(groupId) : undefined,
      rpm_limit: rpm ? Number(rpm) : undefined,
      tpm_limit: tpm ? Number(tpm) : undefined,
    });
    setNewKey(res.api_key);
    toast('Key 创建成功');
    load();
  };

  const saveEdit = async () => {
    if (!edit) return;
    await api.patch(`/api/v1/me/api-keys/${edit.id}`, {
      name, group_id: groupId ? Number(groupId) : null,
      rpm_limit: rpm ? Number(rpm) : null, tpm_limit: tpm ? Number(tpm) : null,
    });
    toast('已保存'); setEdit(null); load();
  };
  const openEdit = (k: ApiKey) => {
    setEdit(k); setName(k.name); setGroupId(k.group_id ? String(k.group_id) : ''); setRpm(k.rpm_limit ? String(k.rpm_limit) : ''); setTpm(k.tpm_limit ? String(k.tpm_limit) : '');
  };

  const remove = async (id: number) => {
    if (!confirm('确定删除该 Key？删除后立即失效。')) return;
    await api.del(`/api/v1/me/api-keys/${id}`);
    toast('已删除', 'ok');
    load();
  };
  const copy = async (k: ApiKey) => {
    const t = `${k.key_prefix}…${k.key_tail}`;
    try { await navigator.clipboard.writeText(t); toast('已复制（完整 Key 仅在创建时显示一次）'); } catch { toast('复制失败', 'err'); }
  };

  if (loading) return <div className="empty">加载中…</div>;

  const groupOpts = groups.map((g) => <option key={g.id} value={g.id}>{g.name}（{g.platform}）</option>);

  return (
    <div>
      <div className="page-head">
        <h1>我的 API Key</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => setTestOpen(true)}>测试 API</button>
          <button className="btn btn-primary" onClick={() => { resetForm(); setShowCreate(true); }}>创建 Key</button>
        </div>
      </div>

      {testOpen && <TestApiDialog onClose={() => setTestOpen(false)} keys={keys} />}

      <div className="card">
        {keys.length === 0 ? (
          <div className="empty">还没有 API Key，点击右上角创建。</div>
        ) : (
          <table className="data">
            <thead><tr><th>名称</th><th>Key</th><th>分组</th><th>限额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="mono">{k.key_prefix}…{k.key_tail}</td>
                  <td>{k.group_name || '-'}</td>
                  <td>{k.rpm_limit ? `${k.rpm_limit} RPM` : '-'}{k.tpm_limit ? ` / ${k.tpm_limit} TPM` : ''}</td>
                  <td><StatusBadge status={k.status} /></td>
                  <td>{fmtTime(k.created_at)}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => openEdit(k)}><PencilSimple size={13} />编辑</button>
                    <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => copy(k)}><Copy size={13} />复制</button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(k.id)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <Modal title="创建 API Key" onClose={() => setShowCreate(false)}>
          {newKey ? (
            <>
              <div className="ok-box">请立即保存，完整 Key 只显示这一次：</div>
              <div style={{ background: '#111827', color: '#86efac', padding: 14, borderRadius: 8, fontFamily: 'monospace', wordBreak: 'break-all' }}>{newKey}</div>
              <div className="modal-actions">
                <button className="btn" onClick={() => { navigator.clipboard.writeText(newKey); toast('已复制'); }}>复制</button>
                <button className="btn btn-primary" onClick={() => setShowCreate(false)}>完成</button>
              </div>
            </>
          ) : (
            <>
              <div className="field"><label>Key 名称</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：claude-code" /></div>
              <div className="field"><label>分组（真实路由到该分组上游）</label><select value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">不绑定</option>{groupOpts}</select></div>
              <div className="grid-2">
                <div className="field"><label>RPM 限流（每分钟请求，空=不限）</label><input type="number" value={rpm} onChange={(e) => setRpm(e.target.value)} /></div>
                <div className="field"><label>TPM 限流（每分钟 token，空=不限）</label><input type="number" value={tpm} onChange={(e) => setTpm(e.target.value)} /></div>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setShowCreate(false)}>取消</button>
                <button className="btn btn-primary" onClick={create}>生成</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {edit && (
        <Modal title={`编辑 Key · ${edit.name}`} onClose={() => setEdit(null)}>
          <div className="field"><label>Key 名称</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>分组</label><select value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">不绑定</option>{groupOpts}</select></div>
          <div className="grid-2">
            <div className="field"><label>RPM 限流</label><input type="number" value={rpm} onChange={(e) => setRpm(e.target.value)} /></div>
            <div className="field"><label>TPM 限流</label><input type="number" value={tpm} onChange={(e) => setTpm(e.target.value)} /></div>
          </div>
          <div className="modal-actions"><button className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn btn-primary" onClick={saveEdit}>保存</button></div>
        </Modal>
      )}
    </div>
  );
}
