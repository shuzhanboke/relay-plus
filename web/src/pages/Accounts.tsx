import { useEffect, useState } from 'react';
import { api } from '../api';
import type { UpstreamAccount, Group, Proxy } from '../types';
import { Modal, StatusBadge, useToast, fmtTime } from '../components/ui';

// 主流供应商池：与模型价格页/分组页保持一致
const SUPPLIER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', base: 'https://api.openai.com' },
  { value: 'anthropic', label: 'Claude (Anthropic)', base: 'https://api.anthropic.com' },
  { value: 'gemini', label: 'Gemini (Google)', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { value: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com' },
  { value: 'xai', label: 'Grok (xAI)', base: 'https://api.x.ai' },
  { value: 'mistral', label: 'Mistral', base: 'https://api.mistral.ai' },
  { value: 'meta', label: 'Meta Llama', base: 'https://api.together.xyz' },
  { value: 'qwen', label: 'Qwen (通义千问)', base: 'https://dashscope.aliyuncs.com/compatible-mode' },
  { value: 'kimi', label: 'Kimi (Moonshot)', base: 'https://api.moonshot.cn' },
  { value: 'zhipu', label: '智谱 (GLM)', base: 'https://open.bigmodel.cn/api/paas/v4' },
  { value: 'minimax', label: 'MiniMax', base: 'https://api.minimax.chat' },
  { value: 'custom', label: '自定义', base: '' },
];

export default function Accounts() {
  const [accounts, setAccounts] = useState<UpstreamAccount[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showProxy, setShowProxy] = useState(false);
  const [createType, setCreateType] = useState('api_key');
  const [editing, setEditing] = useState<UpstreamAccount | null>(null);
  const toast = useToast();

  const load = async () => {
    try {
      const [a, g, p] = await Promise.all([
        api.get<UpstreamAccount[]>('/api/v1/admin/accounts'),
        api.get<Group[]>('/api/v1/admin/groups'),
        api.get<Proxy[]>('/api/v1/admin/proxies'),
      ]);
      setAccounts(a); setGroups(g); setProxies(p);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const groupIds = (fd.getAll('group_ids') as string[]).map(Number).filter(Boolean);
    const body: any = {
      name: fd.get('name'), platform: fd.get('platform'),
      type: fd.get('type') || 'api_key',
      base_url: fd.get('base_url') as string || undefined,
      api_key: fd.get('api_key') as string || undefined,
      concurrency: Number(fd.get('concurrency')) || 4,
      priority: Number(fd.get('priority')) || 1,
      proxy_id: fd.get('proxy_id') ? Number(fd.get('proxy_id')) : undefined,
      group_ids: groupIds,
    };
    await api.post('/api/v1/admin/accounts', body);
    toast('上游账号已创建'); setShowCreate(false); load();
  };

  const saveEdit = async (a: UpstreamAccount, patch: any) => {
    await api.patch(`/api/v1/admin/accounts/${a.id}`, patch);
    toast('已保存'); setEditing(null); load();
  };

  const toggleStatus = async (a: UpstreamAccount) => {
    await api.patch(`/api/v1/admin/accounts/${a.id}`, { status: a.status === 'active' ? 'paused' : 'active' });
    load();
  };

  const remove = async (a: UpstreamAccount) => {
    if (!confirm(`删除上游账号「${a.name}」？`)) return;
    await api.del(`/api/v1/admin/accounts/${a.id}`);
    toast('已删除'); load();
  };

  const [probe, setProbe] = useState<Record<number, { status: 'loading' | 'done'; ok?: boolean; latency_ms?: number; balance?: string | null; error?: string | null; note?: string }>>({});
  const runProbe = async (a: UpstreamAccount) => {
    setProbe((p) => ({ ...p, [a.id]: { status: 'loading' } }));
    try {
      const r = await api.post<any>(`/api/v1/admin/accounts/${a.id}/probe`);
      setProbe((p) => ({ ...p, [a.id]: { status: 'done', ok: r.ok, latency_ms: r.latency_ms, balance: r.balance, error: r.error, note: r.note } }));
    } catch (ex: any) {
      setProbe((p) => ({ ...p, [a.id]: { status: 'done', ok: false, error: ex?.message || '探测失败' } }));
    }
  };

  if (loading) return <div className="empty">加载中…</div>;

  return (
    <div>
      <div className="page-head">
        <h1>上游账号</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => setShowProxy(true)}>代理管理</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>添加上游</button>
        </div>
      </div>

      {accounts.length === 0 && (
        <div className="card">
          <div className="ok-box">还没有上游账号。上游账号 = 你有权访问的 AI 后端（如 OpenAI 官方 key，或 OAuth 登录得到的 ChatGPT 账号）。</div>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.8 }}>
            <b>API Key 型</b>：Base URL 填官方或你的上游地址，API Key 填上游密钥。<br />
            <b>OAuth / Codex PAT 型</b>：可与 FlowPilot 扩展对接。FlowPilot 侧设置「来源 = SUB2API」，填本面板管理登录账号，分组名一致即可。<br />
            注意：OAuth 类型账号的密钥通过 FlowPilot 回调自动写入本系统，手动在此创建请用 API Key 型。
          </div>
        </div>
      )}

      <div className="card">
        <table className="data">
          <thead><tr><th>ID</th><th>名称</th><th>平台</th><th>类型</th><th>上游地址</th><th>分组</th><th>代理</th><th>并发</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.name}</td>
                <td>{a.platform}</td>
                <td>{a.type}</td>
                <td className="mono">{a.base_url || '默认'}</td>
                <td>{a.groups?.join(', ') || '-'}</td>
                <td>{a.proxy_name || '-'}</td>
                <td>{a.concurrency}</td>
                <td><StatusBadge status={a.status} /></td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing(a)}>编辑</button>
                  <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => runProbe(a)}>{probe[a.id]?.status === 'loading' ? '探测中…' : '探测'}</button>
                  <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => toggleStatus(a)}>{a.status === 'active' ? '暂停' : '启用'}</button>
                  <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(a)}>删除</button>
                  {probe[a.id] && probe[a.id].status === 'done' && (
                    <div style={{ marginTop: 6, fontSize: 11.5, padding: '6px 8px', borderRadius: 8, background: probe[a.id]!.ok ? '#ecfdf5' : '#fef2f2', color: probe[a.id]!.ok ? '#047857' : '#b91c1c' }}>
                      {probe[a.id]!.ok ? `✔ 连通 ${probe[a.id]!.latency_ms ?? '-'}ms` : '✖ 失败'}
                      {probe[a.id]!.balance && ` · 额度 ${probe[a.id]!.balance}`}
                      {probe[a.id]!.note && <div style={{ color: '#78716c', marginTop: 2 }}>{probe[a.id]!.note}</div>}
                      {probe[a.id]!.error && <div className="mono" style={{ marginTop: 2, wordBreak: 'break-all' }}>{probe[a.id]!.error}</div>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="添加上游账号" onClose={() => setShowCreate(false)}>
          <form onSubmit={createAccount}>
            <div className="field"><label>名称</label><input name="name" required placeholder="如 openai-main" /></div>
            <div className="grid-2">
              <div className="field"><label>平台</label><select name="platform" defaultValue="openai" onChange={(e) => { const s = SUPPLIER_OPTIONS.find((x) => x.value === e.target.value); const baseUrlInput = e.target.closest('form')?.querySelector<HTMLInputElement>('input[name="base_url"]'); if (baseUrlInput && s) baseUrlInput.value = s.base; }}>{SUPPLIER_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
              <div className="field"><label>类型</label><select name="type" value={createType} onChange={(e) => setCreateType(e.target.value)}><option value="api_key">api_key</option><option value="oauth">oauth</option><option value="codex_pat">codex_pat</option></select></div>
            </div>
            <div className="field"><label>Base URL（留空用官方默认，选平台后自动填充）</label><input name="base_url" placeholder="https://api.openai.com" /></div>
            {createType === 'api_key' ? (
              <div className="field"><label>上游 API Key</label><input name="api_key" placeholder="sk-..." /></div>
            ) : (
              <div className="ok-box" style={{ fontSize: 12.5 }}>{createType === 'oauth' ? 'OAuth 类型：密钥通过 FlowPilot 回调自动写入，无需在此填 Key。' : 'Codex PAT 类型：通过 FlowPilot exchange-code / create-from-oauth 自动回写 PAT。'}</div>
            )}
            <div className="grid-2">
              <div className="field"><label>并发上限</label><input name="concurrency" type="number" defaultValue={4} /></div>
              <div className="field"><label>优先级</label><input name="priority" type="number" defaultValue={1} /></div>
            </div>
            <div className="field"><label>代理</label>
              <select name="proxy_id" defaultValue="">
                <option value="">无</option>
                {proxies.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.protocol}://{p.host}:{p.port})</option>)}
              </select>
            </div>
            <div className="field"><label>所属分组</label>
              <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid #d1d5db', borderRadius: 8, padding: 8 }}>
                {groups.map((g) => (
                  <label key={g.id} style={{ display: 'block', padding: '3px 0', fontSize: 13 }}>
                    <input type="checkbox" name="group_ids" value={g.id} /> {g.name} ({g.platform})
                  </label>
                ))}
                {groups.length === 0 && <span style={{ color: '#9ca3af' }}>暂无分组，请先创建分组</span>}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" type="submit">创建</button>
            </div>
          </form>
        </Modal>
      )}

      {showProxy && (
        <Modal title="代理管理" onClose={() => setShowProxy(false)}>
          <ProxyManager proxies={proxies} onDone={() => { setShowProxy(false); load(); }} />
        </Modal>
      )}

      {editing && (
        <EditAccountModal
          account={editing}
          groups={groups}
          proxies={proxies}
          onClose={() => setEditing(null)}
          onSaved={saveEdit}
        />
      )}
    </div>
  );
}

function EditAccountModal({ account, groups, proxies, onClose, onSaved }: {
  account: UpstreamAccount; groups: Group[]; proxies: Proxy[];
  onClose: () => void; onSaved: (a: UpstreamAccount, patch: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: account.name, platform: account.platform, type: account.type,
    base_url: account.base_url || '', api_key: '', status: account.status,
    concurrency: account.concurrency, priority: account.priority,
    proxy_id: account.proxy_id ? String(account.proxy_id) : '',
  });
  const [groupNames, setGroupNames] = useState<string[]>(account.groups || []);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const toggleGroup = (g: Group) => {
    setGroupNames((prev) => prev.includes(g.name) ? prev.filter((n) => n !== g.name) : [...prev, g.name]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast('名称不能为空', 'err');
    setSaving(true);
    try {
      const groupIds = groups.filter((g) => groupNames.includes(g.name)).map((g) => g.id);
      await onSaved(account, {
        name: form.name, platform: form.platform,
        base_url: form.base_url || null,
        ...(form.api_key ? { api_key: form.api_key } : {}),
        status: form.status, concurrency: Number(form.concurrency) || 1,
        priority: Number(form.priority) || 1,
        proxy_id: form.proxy_id ? Number(form.proxy_id) : null,
        group_ids: groupIds,
      });
    } catch (ex: any) {
      toast(ex?.message || '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`编辑上游 · ${account.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field"><label>名称</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="grid-2">
          <div className="field"><label>平台</label>
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {SUPPLIER_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="field"><label>类型</label><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="api_key">api_key</option><option value="oauth">oauth</option><option value="codex_pat">codex_pat</option></select></div>
        </div>
        <div className="field"><label>Base URL（留空用官方默认）</label><input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.example.com" /></div>
        <div className="field"><label>上游 API Key（留空则不修改）</label><input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." autoComplete="off" /></div>
        <div className="grid-2">
          <div className="field"><label>并发上限</label><input type="number" value={form.concurrency} onChange={(e) => setForm({ ...form, concurrency: Number(e.target.value) })} /></div>
          <div className="field"><label>优先级</label><input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
        </div>
        <div className="field"><label>状态</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">active</option><option value="paused">paused</option><option value="disabled">disabled</option></select></div>
        <div className="field"><label>代理</label>
          <select value={form.proxy_id} onChange={(e) => setForm({ ...form, proxy_id: e.target.value })}>
            <option value="">无</option>
            {proxies.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.protocol}://{p.host}:{p.port})</option>)}
          </select>
        </div>
        <div className="field"><label>所属分组</label>
          <div style={{ maxHeight: 120, overflow: 'auto', border: '1px solid #d1d5db', borderRadius: 8, padding: 8 }}>
            {groups.map((g) => (
              <label key={g.id} style={{ display: 'block', padding: '3px 0', fontSize: 13 }}>
                <input type="checkbox" checked={groupNames.includes(g.name)} onChange={() => toggleGroup(g)} /> {g.name} ({g.platform})
              </label>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ProxyManager({ proxies, onDone }: { proxies: Proxy[]; onDone: () => void }) {
  const [name, setName] = useState(''); const [host, setHost] = useState(''); const [port, setPort] = useState(1080);
  const [protocol, setProtocol] = useState('http');
  const toast = useToast();
  const add = async () => {
    if (!name || !host) return toast('填写名称和主机', 'err');
    await api.post('/api/v1/admin/proxies', { name, host, port, protocol });
    toast('代理已添加'); onDone();
  };
  const remove = async (id: number) => { await api.del(`/api/v1/admin/proxies/${id}`); toast('已删除'); onDone(); };
  return (
    <div>
      {proxies.length > 0 && (
        <table className="data" style={{ marginBottom: 14 }}>
          <thead><tr><th>名称</th><th>地址</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>{proxies.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td className="mono">{p.protocol}://{p.host}:{p.port}</td><td><StatusBadge status={p.status} /></td><td><button className="btn btn-sm btn-danger" onClick={() => remove(p.id)}>删除</button></td></tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input className="search-input" placeholder="名称" style={{ width: 120 }} value={name} onChange={(e) => setName(e.target.value)} />
        <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="http">http</option><option value="https">https</option><option value="socks5">socks5</option>
        </select>
        <input className="search-input" placeholder="主机" style={{ width: 140 }} value={host} onChange={(e) => setHost(e.target.value)} />
        <input className="search-input" placeholder="端口" style={{ width: 80 }} type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
        <button className="btn btn-primary" onClick={add}>添加</button>
      </div>
      <div className="modal-actions"><button className="btn" onClick={onDone}>完成</button></div>
    </div>
  );
}
