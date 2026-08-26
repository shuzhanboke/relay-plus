import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast, fmtMoney, fmtTime } from '../components/ui';

interface Order { id: number; order_no: string; user_email: string | null; plan_id: number | null; amount: number; credit: number; channel: string; status: string; remark: string | null; created_at: string; paid_at: string | null }

export default function OrdersAdmin() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();

  const load = async () => {
    try {
      const qs = status ? `?status=${status}` : '';
      setOrders(await api.get<Order[]>('/api/v1/admin/orders' + qs));
    } catch {}
  };
  useEffect(() => { load(); }, [status]);

  const confirmPaid = async (o: Order) => {
    if (!confirm(`确认到账 ${fmtMoney(o.credit)}？确认后自动为用户加余额。`)) return;
    setBusy(o.id);
    try {
      await api.post(`/api/v1/admin/orders/${o.order_no}/paid`, {});
      toast(`已确认到账 ${fmtMoney(o.credit)}`);
      load();
    } catch (ex: any) { toast(ex?.message || '操作失败', 'err'); }
    setBusy(null);
  };

  const statusBadge = (s: string) => {
    const m: Record<string, string> = { pending: 'badge badge-yellow', paid: 'badge badge-green', cancelled: 'badge badge-gray', expired: 'badge badge-gray', refunded: 'badge badge-red' };
    return <span className={m[s] || 'badge badge-gray'}>{s === 'pending' ? '待支付' : s === 'paid' ? '已到账' : s}</span>;
  };

  const counts = (st: string) => orders.filter(o => !st || o.status === st).length;
  const pending = orders.filter(o => o.status === 'pending').length;

  return (
    <div>
      <div className="page-head"><h1>订单管理</h1></div>
      <div className="card">
        <div className="toolbar">
          <button className={`btn ${status === '' ? 'btn-primary' : ''}`} onClick={() => setStatus('')}>全部 ({counts('')})</button>
          <button className={`btn ${status === 'pending' ? 'btn-primary' : ''}`} onClick={() => setStatus('pending')}>待支付 ({pending})</button>
          <button className={`btn ${status === 'paid' ? 'btn-primary' : ''}`} onClick={() => setStatus('paid')}>已到账</button>
        </div>
      </div>
      <div className="card">
        {orders.length === 0 ? <div className="empty">暂无订单。</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead><tr><th>单号</th><th>用户</th><th>金额</th><th>到账额度</th><th>渠道</th><th>状态</th><th>备注</th><th>创建</th><th>到账时间</th><th>操作</th></tr></thead>
              <tbody>{orders.map(o => (
                <tr key={o.id}>
                  <td className="mono">{o.order_no}</td>
                  <td>{o.user_email || `#${o.id}`}</td>
                  <td>{fmtMoney(o.amount)}</td>
                  <td>{fmtMoney(o.credit)}</td>
                  <td>{o.channel}</td>
                  <td>{statusBadge(o.status)}</td>
                  <td style={{ maxWidth: 120 }}>{o.remark || '-'}</td>
                  <td>{fmtTime(o.created_at)}</td>
                  <td>{o.paid_at ? fmtTime(o.paid_at) : '-'}</td>
                  <td>{o.status === 'pending' && <button className="btn btn-primary btn-sm" disabled={busy === o.id} onClick={() => confirmPaid(o)}>确认到账</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
