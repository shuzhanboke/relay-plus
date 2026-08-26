import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useToast, fmtMoney } from '../components/ui';
import { Package, Plus, PencilSimple, Power } from '@phosphor-icons/react';

interface PlanRow {
  id: number; name: string; description: string | null; amount: number; credit: number;
  enabled: boolean; sort: number; type: 'prepaid' | 'subscription';
  period_days: number | null; monthly_credit: number | null; created_at: string;
}

const emptyForm = () => ({
  name: '', description: '', amount: 0, credit: 0, type: 'prepaid' as 'prepaid' | 'subscription',
  period_days: null as number | null, monthly_credit: null as number | null, sort: 0,
});

export default function ManagePlans() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = async () => { try { setPlans(await api.get<PlanRow[]>('/api/v1/admin/plans')); } catch {} setLoading(false); };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditId(null); setForm(emptyForm()); setShow(true); };
  const openEdit = (p: PlanRow) => {
    setEditId(p.id);
    setForm({ name: p.name, description: p.description || '', amount: p.amount, credit: p.credit, type: p.type, period_days: p.period_days, monthly_credit: p.monthly_credit, sort: p.sort });
    setShow(true);
  };

  const submit = async () => {
    if (!form.name.trim()) return toast('请输入套餐名称', 'err');
    const payload: Record<string, unknown> = {
      name: form.name.trim(), description: form.description || null, amount: form.amount,
      credit: form.type === 'prepaid' ? form.credit : 0, type: form.type, sort: form.sort,
    };
    if (form.type === 'subscription') {
      payload.period_days = form.period_days; payload.monthly_credit = form.monthly_credit;
      if (!form.period_days || !form.monthly_credit) return toast('订阅套餐需填周期天数与每月额度', 'err');
    } else {
      payload.period_days = null; payload.monthly_credit = null;
    }
    setBusy(true);
    try {
      if (editId) { await api.patch(`/api/v1/admin/plans/${editId}`, payload); toast('套餐已更新'); }
      else { await api.post('/api/v1/admin/plans', payload); toast('套餐已创建'); }
      setShow(false); load();
    } catch (ex: any) { toast(ex?.message || '保存失败', 'err'); }
    setBusy(false);
  };

  const toggle = async (p: PlanRow) => {
    await api.patch(`/api/v1/admin/plans/${p.id}`, { enabled: !p.enabled });
    toast(p.enabled ? '已停用' : '已启用'); load();
  };

  if (loading) return <div className="empty">加载中…</div>;

  return (
    <div>
      <div className="page-head rise" style={{ '--i': 0 } as CSSProperties}>
        <div>
          <h1>套餐管理</h1>
          <div className="page-sub">创建与管理按量、按月订购套餐（创建后用户即可购买，真实生效）</div>
        </div>
        <button className="btn btn-primary" onClick={openNew}><Plus size={15} weight="regular" />新增套餐</button>
      </div>

      <div className="card rise" style={{ '--i': 1 } as CSSProperties}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>名称</th><th>类型</th><th>价格</th><th>额度 / 周期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b>{p.description && <span style={{ color: 'var(--text-3)' }}> · {p.description}</span>}</td>
                  <td><span className="badge" style={{ background: p.type === 'subscription' ? 'var(--info-bg)' : 'var(--ok-bg)', color: p.type === 'subscription' ? 'var(--info)' : 'var(--ok)', borderColor: p.type === 'subscription' ? 'var(--info-line)' : 'var(--ok-line)' }}>{p.type === 'subscription' ? '月度订阅' : '按量充值'}</span></td>
                  <td className="data-num">{fmtMoney(p.amount)}</td>
                  <td className="mono">{p.type === 'subscription' ? `${fmtMoney(p.monthly_credit ?? 0)} / ${p.period_days ?? 30} 天` : `到账 ${fmtMoney(p.credit)}`}</td>
                  <td><span className="badge" style={{ background: p.enabled ? 'var(--ok-bg)' : 'var(--danger-bg)', color: p.enabled ? 'var(--ok)' : 'var(--danger)', borderColor: p.enabled ? 'var(--ok-line)' : 'var(--danger-line)' }}>{p.enabled ? '启用' : '停用'}</span></td>
                  <td>
                    <button className="btn btn-sm" onClick={() => openEdit(p)}><PencilSimple size={13} weight="regular" />编辑</button>
                    <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => toggle(p)}><Power size={13} weight="regular" />{p.enabled ? '停用' : '启用'}</button>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && <tr><td colSpan={6}><div className="empty">暂无套餐。点击「新增套餐」创建第一个。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <div className="modal-overlay" onClick={() => setShow(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editId ? '编辑套餐' : '新增套餐'}</h3>
            <div className="field"><label>套餐名称 *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 入门按量 / Pro 月度" /></div>
            <div className="field"><label>描述</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="一句话说明（可选）" /></div>
            <div className="grid-2">
              <div className="field"><label>类型 *</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'prepaid' | 'subscription' })}>
                  <option value="prepaid">按量充值</option>
                  <option value="subscription">月度订阅</option>
                </select>
              </div>
              <div className="field"><label>价格 (USD) *</label><input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} /></div>
              {form.type === 'prepaid' ? (
                <div className="field"><label>到账额度 (USD)</label><input type="number" min={0} step="0.01" value={form.credit} onChange={(e) => setForm({ ...form, credit: Number(e.target.value) })} /></div>
              ) : (
                <>
                  <div className="field"><label>周期天数 *</label><input type="number" min={1} value={form.period_days ?? ''} onChange={(e) => setForm({ ...form, period_days: e.target.value ? Number(e.target.value) : null })} placeholder="如 30" /></div>
                  <div className="field"><label>每月可用额度 (USD) *</label><input type="number" min={0} step="0.01" value={form.monthly_credit ?? ''} onChange={(e) => setForm({ ...form, monthly_credit: e.target.value ? Number(e.target.value) : null })} /></div>
                </>
              )}
              <div className="field"><label>排序</label><input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })} /></div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShow(false)}>取消</button>
              <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? '保存中…' : '保存套餐'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
