import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtMoney, fmtTime } from '../components/ui';

interface L { id: number; model: string; endpoint: string; cost: number; success: boolean; status_code: number; error_message: string | null; prompt_tokens: number; completion_tokens: number; created_at: string }

export default function MyLogs() {
  const [logs, setLogs] = useState<L[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => { try { setLogs(await api.get<L[]>('/api/v1/billing/me/logs?limit=100')); } catch {} setLoading(false); })();
  }, []);
  return (
    <div>
      <div className="page-head"><h1>我的调用日志</h1></div>
      <div className="card">
        {loading ? <div className="empty">加载中…</div> : logs.length === 0 ? <div className="empty">暂无调用记录。用你的 API Key 调用 /v1 端点后会出现。</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead><tr><th>时间</th><th>模型</th><th>端点</th><th>Prompt</th><th>Completion</th><th>成本</th><th>状态</th><th>错误</th></tr></thead>
              <tbody>{logs.map(l => (
                <tr key={l.id}>
                  <td>{fmtTime(l.created_at)}</td><td>{l.model}</td><td className="mono">{l.endpoint}</td>
                  <td>{l.prompt_tokens}</td><td>{l.completion_tokens}</td><td>{fmtMoney(l.cost)}</td>
                  <td>{l.success ? <span className="badge badge-green">成功</span> : <span className="badge badge-red">{l.status_code}</span>}</td>
                  <td style={{ maxWidth: 180 }}>{l.error_message ? <span style={{ color: '#b91c1c', fontSize: 12 }}>{l.error_message}</span> : '-'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
