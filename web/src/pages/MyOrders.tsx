import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtTime } from '../components/ui';
import { Download, ArrowDown } from '@phosphor-icons/react';

interface Order { id: number; order_no: string; plan_id: number | null; amount: number; credit: number; rebate?: number; channel: string; status: string; remark: string | null; created_at: string; paid_at: string | null }
interface Tx { type: string; ref: string; amount: string; created_at: string }

const O = { bg: '#fff8f2', card: '#fff', line: '#ffe7d4', accent: '#f97316', accentDeep: '#ea580c', ink: '#7c2d12' };
const cn = (n: number | string | null | undefined) => { const v = typeof n === 'string' ? Number(n) : n; return v == null || Number.isNaN(v) ? '-' : `¥${v}`; };

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: '待支付', color: '#b45309', bg: '#fffbeb' },
  paid: { label: '已到账', color: '#047857', bg: '#ecfdf5' },
  cancelled: { label: '已取消', color: '#57534e', bg: '#f5f5f4' },
  expired: { label: '已过期', color: '#57534e', bg: '#f5f5f4' },
  refunded: { label: '已退款', color: '#b91c1c', bg: '#fef2f2' },
};

export default function MyOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tx, setTx] = useState<Tx[]>([]);
  const [tab, setTab] = useState<'orders' | 'transactions'>('orders');
  const [status, setStatus] = useState('');

  useEffect(() => {
    (async () => {
      try { setOrders(await api.get<Order[]>('/api/v1/billing/me/orders')); } catch {}
      try { setTx(await api.get<Tx[]>('/api/v1/billing/me/transactions')); } catch {}
    })();
  }, []);

  const filtered = status ? orders.filter((o) => o.status === status) : orders;
  const exportCsv = () => {
    const rows = [['订单编号', '金额', '到账', '方式', '状态', '创建时间'], ...filtered.map((o) => [o.order_no, cn(o.amount), cn((Number(o.credit) || 0) + (Number(o.rebate) || 0)), o.channel, STATUS_MAP[o.status]?.label || o.status, fmtTime(o.created_at)])];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'orders.csv'; a.click();
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-head" style={{ alignItems: 'center' }}>
        <h1>我的订单</h1>
        <button style={{ display: 'flex', alignItems: 'center', gap: 6, background: O.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }} onClick={exportCsv}><Download size={16} />导出</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button style={{ ...tabBtn(tab === 'orders'), }} onClick={() => setTab('orders')}>充值订单</button>
        <button style={{ ...tabBtn(tab === 'transactions') }} onClick={() => setTab('transactions')}>资金流水</button>
      </div>

      {tab === 'orders' ? (
        <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 18 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '8px 10px', borderRadius: 10, border: `1px solid ${O.line}`, fontSize: 13 }}><option value="">全部</option><option value="pending">待支付</option><option value="paid">已到账</option><option value="cancelled">已取消</option></select>
          </div>
          {filtered.length === 0 ? <div style={{ color: '#a8a29e', textAlign: 'center', padding: 28 }}>暂无订单</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['订单编号', '金额', '到账额度', '支付方式', '状态', '创建时间'].map((h) => <th key={h} style={{ textAlign: 'left', color: '#78716c', fontWeight: 600, padding: '10px 10px', borderBottom: `1px solid ${O.line}` }}>{h}</th>)}</tr></thead>
              <tbody>{filtered.map((o) => {
                const st = STATUS_MAP[o.status] || STATUS_MAP.cancelled;
                return (
                  <tr key={o.id}>
                    <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2', fontFamily: 'monospace', fontSize: 12 }}>{o.order_no}</td>
                    <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2', color: O.ink }}>{cn(o.amount)}</td>
                    <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2', color: '#047857', fontWeight: 600 }}>{cn((Number(o.credit) || 0) + (Number(o.rebate) || 0))}</td>
                    <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2' }}>{o.channel}</td>
                    <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2' }}><span style={{ padding: '3px 10px', borderRadius: 8, background: st.bg, color: st.color, fontSize: 11.5, fontWeight: 600 }}>{st.label}</span></td>
                    <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2', color: '#78716c', fontSize: 12 }}>{fmtTime(o.created_at)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
      ) : (
        <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 18 }}>
          {tx.length === 0 ? <div style={{ color: '#a8a29e', textAlign: 'center', padding: 28 }}>暂无资金流水</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['类型', '说明', '金额', '时间'].map((h) => <th key={h} style={{ textAlign: 'left', color: '#78716c', fontWeight: 600, padding: '10px', borderBottom: `1px solid ${O.line}` }}>{h}</th>)}</tr></thead>
              <tbody>{tx.map((t, i) => (
                <tr key={i}>
                  <td style={{ padding: '12px', borderBottom: '1px solid #fff1e2' }}>{t.type}</td>
                  <td style={{ padding: '12px', borderBottom: '1px solid #fff1e2', fontFamily: 'monospace', fontSize: 12 }}>{t.ref}</td>
                  <td style={{ padding: '12px', borderBottom: '1px solid #fff1e2', color: Number(t.amount) >= 0 ? '#047857' : '#dc2626', fontWeight: 600 }}>{Number(t.amount) >= 0 ? '+' : ''}{cn(t.amount)}</td>
                  <td style={{ padding: '12px', borderBottom: '1px solid #fff1e2', color: '#78716c', fontSize: 12 }}>{fmtTime(t.created_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function tabBtn(active: boolean) { return { padding: '8px 16px', borderRadius: 10, border: `1px solid ${active ? O.accent : O.line}`, background: active ? O.accent : '#fff', color: active ? '#fff' : O.ink, fontWeight: 600, cursor: 'pointer', fontSize: 13.5 } as const; }
