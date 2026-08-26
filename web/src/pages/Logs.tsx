import { useEffect, useState } from 'react';
import { api } from '../api';
import type { LogEntry } from '../types';
import { fmtMoney, fmtTime } from '../components/ui';

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('24h');
  const [model, setModel] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '200', limit_timezone: range });
      if (model) qs.set('model', model);
      setLogs(await api.get<LogEntry[]>(`/api/v1/admin/logs?${qs}`));
    } catch { setLogs([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [range]);

  const search = () => load();

  return (
    <div>
      <div className="page-head"><h1>请求日志</h1></div>
      <div className="toolbar">
        <select value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="1h">近 1 小时</option>
          <option value="24h">近 24 小时</option>
          <option value="168">近 7 天</option>
          <option value="all">全部</option>
        </select>
        <input className="search-input" placeholder="按模型过滤" value={model} onChange={(e) => setModel(e.target.value)} />
        <button className="btn" onClick={search}>查询</button>
      </div>

      <div className="card">
        {loading ? <div className="empty">加载中…</div> : logs.length === 0 ? (
          <div className="empty">暂无请求日志。调用过 /v1 端点后这里会出现记录。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead><tr><th>时间</th><th>用户</th><th>模型</th><th>端点</th><th>流式</th><th>Prompt</th><th>Completion</th><th>成本</th><th>状态</th><th>耗时</th><th>错误</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{fmtTime(l.created_at)}</td>
                    <td>{l.user_email || '-'}</td>
                    <td>{l.model}</td>
                    <td className="mono">{l.endpoint}</td>
                    <td>{l.stream ? '是' : '否'}</td>
                    <td>{l.prompt_tokens}</td>
                    <td>{l.completion_tokens}</td>
                    <td>{fmtMoney(l.cost)}</td>
                    <td>{l.success ? <span className="badge badge-green">成功</span> : <span className="badge badge-red">{l.status_code}</span>}</td>
                    <td>{l.latency_ms != null ? `${l.latency_ms}ms` : '-'}</td>
                    <td style={{ maxWidth: 180 }}>{l.error_message ? <span style={{ color: '#b91c1c', fontSize: 12 }}>{l.error_message}</span> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
