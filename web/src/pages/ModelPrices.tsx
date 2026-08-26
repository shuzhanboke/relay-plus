import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { ModelPrice } from '../types';
import { Modal, useToast } from '../components/ui';

const empty = { model: '', provider: 'openai', input_price: 0, output_price: 0, cache_read_price: 0, cache_write_price: 0, official_input_price: 0, official_output_price: 0, context_window: '' };

// 供应商顺序与展示名（对齐截图模式）
const PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'mistral', 'meta', 'qwen', 'kimi', 'zhipu', 'minimax', 'custom'];
const PROVIDER_LABEL: Record<string, string> = {
  openai: 'GPT', anthropic: 'Claude', google: 'Gemini', deepseek: 'DeepSeek',
  xai: 'Grok', mistral: 'Mistral', meta: 'Meta', qwen: 'Qwen', kimi: 'Kimi',
  zhipu: '智谱', minimax: 'MiniMax', custom: '其他',
};
const PROVIDER_COLOR: Record<string, string> = {
  openai: '#10a37f', anthropic: '#d97757', google: '#4285f4', deepseek: '#4d6bfe',
  xai: '#111827', mistral: '#f97316', meta: '#0668e1', qwen: '#7c3aed', kimi: '#111827',
  zhipu: '#2563eb', minimax: '#111827', custom: '#6b7280',
};

function providerKey(p: string) { return p || 'custom'; }

export default function ModelPrices() {
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ ...empty });
  const [active, setActive] = useState('openai');
  const [disCount, setDisCount] = useState(true); // 是否显示折扣列
  const toast = useToast();
  const [titleMode, setTitleMode] = useState('百分比');

  const load = async () => { try { setPrices(await api.get<ModelPrice[]>('/api/v1/admin/model-prices')); } catch {} setLoading(false); };
  useEffect(() => { load(); }, []);

  const providers = useMemo(() => {
    const set = new Set(prices.map((p) => providerKey(p.provider)));
    return PROVIDER_ORDER.filter((k) => set.has(k));
  }, [prices]);

  const list = useMemo(() => prices.filter((p) => providerKey(p.provider) === active), [prices, active]);

  const submit = async () => {
    if (!form.model.trim()) return toast('请输入模型名', 'err');
    await api.post('/api/v1/admin/model-prices', {
      model: form.model, provider: form.provider,
      input_price: Number(form.input_price) || 0, output_price: Number(form.output_price) || 0,
      cache_read_price: Number(form.cache_read_price) || 0, cache_write_price: Number(form.cache_write_price) || 0,
      ...(form.official_input_price ? { official_input_price: Number(form.official_input_price) } : {}),
      ...(form.official_output_price ? { official_output_price: Number(form.official_output_price) } : {}),
      ...(form.context_window ? { context_window: Number(form.context_window) } : {}),
    });
    toast('价格已保存'); setShow(false); setForm({ ...empty }); load();
  };

  const remove = async (id: number) => {
    await api.del(`/api/v1/admin/model-prices/${id}`);
    toast('已删除'); load();
  };

  if (loading) return <div className="empty">加载中…</div>;

  // 批量调价：统一改当前供应商所有模型的 input/output 为指定倍率或百分比
  const bulkAdjust = async (mode: string, value: number) => {
    if (!value || value <= 0) return toast('请输入有效数值', 'err');
    const targets = list;
    for (const p of targets) {
      const inP = mode === 'percent' ? p.official_input_price != null ? p.official_input_price * value : p.input_price * value : p.input_price * value;
      const outP = mode === 'percent' ? p.official_output_price != null ? p.official_output_price * value : p.output_price * value : p.output_price * value;
      await api.post('/api/v1/admin/model-prices', {
        model: p.model, provider: p.provider, input_price: inP, output_price: outP,
        cache_read_price: p.cache_read_price, cache_write_price: p.cache_write_price,
        official_input_price: p.official_input_price, official_output_price: p.official_output_price,
        context_window: p.context_window,
      }).catch(() => {});
    }
    toast('批次调价完成'); load();
  };

  return (
    <div>
      <div className="page-head">
        <h1>模型价格</h1>
        <button className="btn btn-primary" onClick={() => { setForm({ ...empty, provider: active }); setShow(true); }}>新增模型</button>
      </div>

      {/* 供应商 tab */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {providers.length === 0 && <span style={{ color: '#9ca3af', fontSize: 13 }}>暂无价格数据</span>}
            {providers.map((k) => (
              <button key={k} onClick={() => setActive(k)} style={{
                padding: '7px 16px', borderRadius: 8, border: '1px solid ' + (active === k ? PROVIDER_COLOR[k] : '#e5e7eb'),
                background: active === k ? PROVIDER_COLOR[k] : '#fff', color: active === k ? '#fff' : '#374151',
                fontSize: 13.5, cursor: 'pointer', fontWeight: 500,
              }}>{PROVIDER_LABEL[k] || k}<span style={{ opacity: .7, marginLeft: 5, fontSize: 12 }}>{prices.filter((p) => providerKey(p.provider) === k).length}</span></button>
            ))}
          </div>
        </div>
      </div>

      {/* 摘要与批量工具条 */}
      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, color: '#6b7280' }}>当前供应商：<b style={{ color: PROVIDER_COLOR[active] }}>{PROVIDER_LABEL[active] || active}</b> · {list.length} 个模型</span>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12.5, color: '#6b7280' }}><input type="checkbox" checked={disCount} onChange={() => setDisCount(!disCount)} /> 显示折扣</label>
          <button className="btn btn-sm" onClick={() => setTitleMode(titleMode === '百分比' ? '倍率' : '百分比')}>{titleMode === '百分比' ? '按 % 调' : '按倍率调'}</button>
        </div>
        <BulkRow mode={titleMode} onApply={bulkAdjust} />
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>批量调整将按当前供应商的官方价（无则按渠道价）统一修改全部模型。</div>
      </div>

      {/* 价格列表 */}
      <div className="card">
        {list.length === 0 ? <div className="empty">该供应商暂无价格，点击右上角「新增模型」添加。</div> : (
          <table className="data">
            <thead>
              <tr><th>模型</th><th>输入价格</th><th>输出价格</th><th>缓存读取</th><th>缓存写入</th><th>上下文窗口</th>{disCount && <th>折扣</th>}<th>操作</th></tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const disc = (p.official_input_price && p.input_price) ? Math.round((1 - p.input_price / p.official_input_price) * 100) : null;
                return (
                  <tr key={p.id}>
                    <td className="mono">{p.model}{p.official_input_price != null && <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 6 }}>(官方 {p.official_input_price}/{p.official_output_price})</span>}</td>
                    <td>${p.input_price}<div style={{ fontSize: 11, color: '#9ca3af' }}>/1M tokens</div></td>
                    <td>${p.output_price}<div style={{ fontSize: 11, color: '#9ca3af' }}>/1M tokens</div></td>
                    <td>${p.cache_read_price}</td>
                    <td>${p.cache_write_price}</td>
                    <td>{p.context_window ? (p.context_window >= 1000000 ? `${(p.context_window / 1000000).toFixed(0)}M` : `${(p.context_window / 1000).toFixed(0)}K`) : '-'}</td>
                    {disCount && <td>{disc != null ? <span className="badge badge-green">{disc}%</span> : '-'}</td>}
                    <td>
                      <button className="btn btn-sm" onClick={() => { setForm({ ...p, context_window: p.context_window ?? '', official_input_price: p.official_input_price ?? 0, official_output_price: p.official_output_price ?? 0 }); setShow(true); }}>编辑</button>
                      <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => { if (confirm('删除该价格？')) remove(p.id); }}>删除</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {show && (
        <Modal title={form.model ? '编辑模型价格' : '新增模型价格'} onClose={() => setShow(false)}>
          <div className="field"><label>模型名</label><input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="gpt-4o 或 claude-3-7-sonnet" /></div>
          <div className="field"><label>供应商</label>
            <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {PROVIDER_ORDER.map((k) => <option key={k} value={k}>{PROVIDER_LABEL[k] || k}</option>)}
            </select>
          </div>
          <div className="grid-2">
            <div className="field"><label>输入 $/1M</label><input type="number" step="0.01" value={form.input_price} onChange={(e) => setForm({ ...form, input_price: Number(e.target.value) })} /></div>
            <div className="field"><label>输出 $/1M</label><input type="number" step="0.01" value={form.output_price} onChange={(e) => setForm({ ...form, output_price: Number(e.target.value) })} /></div>
            <div className="field"><label>缓存读取 $/1M</label><input type="number" step="0.01" value={form.cache_read_price} onChange={(e) => setForm({ ...form, cache_read_price: Number(e.target.value) })} /></div>
            <div className="field"><label>缓存写入 $/1M</label><input type="number" step="0.01" value={form.cache_write_price} onChange={(e) => setForm({ ...form, cache_write_price: Number(e.target.value) })} /></div>
            <div className="field"><label>官方输入 $/1M</label><input type="number" step="0.01" value={form.official_input_price} onChange={(e) => setForm({ ...form, official_input_price: Number(e.target.value) })} /></div>
            <div className="field"><label>官方输出 $/1M</label><input type="number" step="0.01" value={form.official_output_price} onChange={(e) => setForm({ ...form, official_output_price: Number(e.target.value) })} /></div>
            <div className="field"><label>上下文窗口（tokens）</label><input type="number" value={form.context_window} onChange={(e) => setForm({ ...form, context_window: e.target.value })} placeholder="200000" /></div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setShow(false)}>取消</button>
            <button className="btn btn-primary" onClick={submit}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BulkRow({ mode, onApply }: { mode: string; onApply: (mode: string, value: number) => Promise<void> }) {
  const [value, setValue] = useState('');
  const toast = useToast();
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: '#6b7280' }}>批量调整（{mode === '百分比' ? '%' : '×倍率'}）：</span>
      <input className="search-input" style={{ width: 120 }} type="number" placeholder={mode === '百分比' ? '如 80 表示打8折' : '如 0.8'} value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-sm" onClick={() => { const v = mode === '百分比' ? Number(value) / 100 : Number(value); onApply(mode, v); }}>应用</button>
      <button className="btn btn-sm" onClick={() => setValue('')}>清空</button>
    </div>
  );
}
