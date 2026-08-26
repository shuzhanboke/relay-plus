import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtTime } from '../components/ui';

interface A { id: number; actor_email: string; actor_id: number; action: string; target_type: string | null; target_id: number | null; detail: any; ip: string | null; created_at: string }

const ACTION_LABEL: Record<string, string> = {
  update_user: '修改用户', delete_user: '删除用户', update_account: '修改上游', delete_account: '删除上游',
  confirm_order_paid: '确认到账', create_gift_cards: '生成卡密', invite: '生成邀请码',
};

export default function AuditLogs() {
  const [logs, setLogs] = useState<A[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try { setLogs(await api.get<A[]>('/api/v1/admin/audit?limit=200')); } catch {}
    setBusy(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="page-head"><h1>操作审计日志</h1><button className="btn" onClick={load}>刷新</button></div>
      <div className="card">
        {busy && logs.length === 0 ? <div className="empty">加载中…</div> : logs.length === 0 ? <div className="empty">暂无操作记录。管理员执行修改用户/余额、删除上游、确认到账、生成卡密等会留痕。</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>对象</th><th>详情</th><th>IP</th></tr></thead>
              <tbody>{logs.map(l => (
                <tr key={l.id}>
                  <td>{fmtTime(l.created_at)}</td>
                  <td>{l.actor_email || `#${l.actor_id}`}</td>
                  <td>{ACTION_LABEL[l.action] || l.action}</td>
                  <td>{l.target_type ? `${l.target_type}${l.target_id ? '#' + l.target_id : ''}` : '-'}</td>
                  <td style={{ maxWidth: 260, fontSize: 12 }}><span className="mono">{JSON.stringify(l.detail || {})}</span></td>
                  <td className="mono">{l.ip || '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
