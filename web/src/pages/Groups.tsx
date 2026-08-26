import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Group } from '../types';
import { Modal, useToast, fmtTime } from '../components/ui';
import { Stack, Trash, PencilSimple, Plus } from '@phosphor-icons/react';

const O = { bg: '#fff8f2', card: '#fff', line: '#ffe7d4', accent: '#f97316', accentDeep: '#ea580c', ink: '#7c2d12', accentBg: '#fff4e6' };
const PLATFORM_BADGE: Record<string, string> = { openai: '#10a37f', anthropic: '#d97757', google: '#4285f4', deepseek: '#4d6bfe', xai: '#111827', mistral: '#f97316', meta: '#0668e1', qwen: '#7c3aed', kimi: '#111827', zhipu: '#2563eb', minimax: '#111827', custom: '#0d9488' };
const PLATFORM_LABEL: Record<string, string> = { openai: 'OpenAI', anthropic: 'Claude', google: 'Gemini', deepseek: 'DeepSeek', xai: 'Grok', mistral: 'Mistral', meta: 'Meta Llama', qwen: 'Qwen', kimi: 'Kimi', zhipu: '智谱', minimax: 'MiniMax', custom: 'Custom' };
const PLATFORM_OPTIONS = Object.keys(PLATFORM_LABEL);
const fold = (m: number | undefined): string => { const r = m ?? 1; return r >= 0.999 ? '官方价' : `${(r * 10).toFixed(1)}折`; };

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('openai');
  const [edit, setEdit] = useState<Group | null>(null);
  const [rateMul, setRateMul] = useState('1');
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const toast = useToast();

  const load = async () => { try { setGroups(await api.get<Group[]>('/api/v1/admin/groups')); } catch {} };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return toast('请输入分组名', 'err');
    await api.post('/api/v1/admin/groups', { name: name.trim(), platform, description: editDesc });
    setName(''); setEditDesc(''); toast('分组已创建'); setShowCreate(false); load();
  };
  const openEdit = (g: Group) => { setEdit(g); setRateMul(String(g.rate_multiplier ?? 1)); setEditName(g.name); setEditDesc(g.description || ''); };
  const saveEdit = async () => {
    if (!edit) return;
    await api.patch(`/api/v1/admin/groups/${edit.id}`, { name: editName.trim(), description: editDesc, rate_multiplier: Number(rateMul) || 1 });
    toast('分组已更新'); setEdit(null); load();
  };
  const remove = async (id: number, grpName: string) => {
    if (!confirm(`确定删除分组「${grpName}」？`)) return;
    await api.del(`/api/v1/admin/groups/${id}`);
    toast('已删除'); load();
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-head">
        <h1>分组管理</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />新建分组</button>
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <div className="empty">暂无分组。分组用于把上游账号归类（如 codex / claude），并可绑到用户的 API Key。</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px,1fr))', gap: 14 }}>
          {groups.map((g) => (
            <div key={g.id} style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 14, padding: 18, boxShadow: '0 6px 20px -12px rgba(180,83,9,0.12)' }}>
              {/* 头部：平台徽标 + 名称 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: PLATFORM_BADGE[g.platform] || '#94a3b8', color: '#fff', fontSize: 11, fontWeight: 700 }}>{g.platform.slice(0, 3).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: O.ink, fontSize: 15 }}>{g.name}</div>
                  <div style={{ fontSize: 11.5, color: '#a8a29e' }}>{PLATFORM_LABEL[g.platform] || g.platform} · #{g.id}</div>
                </div>
              </div>
              {/* 折扣倍率 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#78716c' }}>售价倍率</span>
                <span style={{ background: O.accentBg, color: O.accentDeep, padding: '3px 10px', borderRadius: 8, fontWeight: 700, fontSize: 12.5 }}>{fold(g.rate_multiplier)}</span>
              </div>
              {/* 账号数 */}
              <div style={{ fontSize: 12.5, color: '#9a3412', marginBottom: 12 }}>
                <b>{g.account_count ?? 0}</b> 个上游账号
                {g.model_count != null && <span style={{ marginLeft: 10 }}>· <b>{g.model_count}</b> 个模型</span>}
                {g.description && <span style={{ display: 'block', color: '#a8a29e', fontSize: 11.5, marginTop: 4 }}>{g.description}</span>}
              </div>
              {/* 操作 */}
              <div style={{ display: 'flex', gap: 8, borderTop: `1px solid #fff1e2`, paddingTop: 10 }}>
                <button className="btn btn-sm" onClick={() => openEdit(g)}><PencilSimple size={13} />倍率</button>
                <button className="btn btn-sm btn-danger" style={{ marginLeft: 'auto' }} onClick={() => remove(g.id, g.name)}><Trash size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <Modal title="新建分组" onClose={() => setShowCreate(false)}>
          <div className="field"><label>名称</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 codex / claude" /></div>
          <div className="field"><label>描述</label><input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="可选，如：Claude 主力分组" /></div>
          <div className="field"><label>平台</label>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
            </select>
          </div>
          <div className="modal-actions"><button className="btn" onClick={() => setShowCreate(false)}>取消</button><button className="btn btn-primary" onClick={create}>创建</button></div>
        </Modal>
      )}

      {edit && (
        <Modal title={`编辑分组 · ${edit.name}`} onClose={() => setEdit(null)}>
          <div className="field"><label>分组名称</label><input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
          <div className="field"><label>描述</label><input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="如：Claude 主力分组" /></div>
          <div className="field"><label>售价倍率（1 = 官方价，0.16 = 1.6折）</label>
            <input type="number" step="0.01" min={0} value={rateMul} onChange={(e) => setRateMul(e.target.value)} />
            <div className="hint">{fold(Number(rateMul) || 1)} · 用户实付 = 官方价 × 倍率</div>
          </div>
          <div className="modal-actions"><button className="btn" onClick={() => setEdit(null)}>取消</button><button className="btn btn-primary" onClick={saveEdit}>保存</button></div>
        </Modal>
      )}
    </div>
  );
}
