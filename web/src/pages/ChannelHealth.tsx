import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { StatusBadge, useToast, fmtTime } from '../components/ui';
import { Pulse, ArrowClockwise } from '@phosphor-icons/react';

interface ChannelHealth {
  id: number; name: string; platform: string; type: string; base_url?: string | null;
  status: string; last_error?: string | null; created_at: string;
  proxy_name: string; group_names: string;
  req_1h: number; ok_1h: number; req_24h: number; ok_24h: number;
  avg_latency_24h: number; tokens_24h: number; cost_24h: number; last_used_at: string;
  success_rate_24h: number | null; health: string;
}
interface Summary { total: number; healthy: number; degraded: number; off: number; req_24h: number; success_rate_24h: number | null; cost_24h: number; tokens_24h: number; }

const HEALTH_META: Record<string, { label: string; cls: string }> = {
  healthy: { label: '健康', cls: 'ok' },
  degraded: { label: '降级', cls: 'warn' },
  idle_error: { label: '异常(闲置)', cls: 'warn' },
  idle: { label: '闲置', cls: 'dim' },
  paused: { label: '已暂停', cls: 'dim' },
  off: { label: '已停用', cls: 'bad' },
};

function HealthBadge({ h }: { h: string }) {
  const m = HEALTH_META[h] || { label: h, cls: 'dim' };
  return <span className={`status-badge ${m.cls}`}><span className="live-dot" />{m.label}</span>;
}

function fmtNum(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

export default function ChannelHealth() {
  const [data, setData] = useState<{ summary: Summary; channels: ChannelHealth[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = async () => {
    try {
      const d = await api.get<{ summary: Summary; channels: ChannelHealth[] }>('/api/v1/admin/channel-health');
      setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (c: ChannelHealth) => {
    await api.patch(`/api/v1/admin/accounts/${c.id}`, { status: c.status === 'active' ? 'paused' : 'active' });
    toast('状态已更新'); load();
  };

  if (loading) return <div className="empty"><span className="skeleton-inline" />正在载入渠道健康…</div>;
  const s = data?.summary;

  return (
    <div>
      <div className="page-head rise" style={{ '--i': 0 } as CSSProperties}>
        <div>
          <h1>渠道状态监控</h1>
          <div className="page-sub">各上游账号的实时健康、用量与延迟</div>
        </div>
        <button className="btn" onClick={load}><ArrowClockwise size={15} weight="regular" />刷新</button>
      </div>

      {s && (
        <div className="kpi-panel rise" style={{ '--i': 1 } as CSSProperties}>
          <div className="kpi-grid">
            <div className="kpi kpi-half"><div className="kpi-label">上游渠道</div><div className="kpi-value">{s.total}</div></div>
            <div className="kpi kpi-half"><div className="kpi-label"><Pulse size={14} weight="regular" />健康</div><div className="kpi-value kpi-accent">{s.healthy}</div></div>
            <div className="kpi kpi-half"><div className="kpi-label">降级/异常</div><div className="kpi-value" style={{ color: 'var(--warn)' }}>{s.degraded}</div></div>
            <div className="kpi kpi-half"><div className="kpi-label">停用/暂停</div><div className="kpi-value dim">{s.off}</div></div>
            <div className="kpi kpi-main"><div className="kpi-label">24h 请求</div><div className="kpi-value">{fmtNum(s.req_24h)}</div></div>
            <div className="kpi kpi-main"><div className="kpi-label">24h 成功率</div><div className="kpi-value">{s.success_rate_24h === null ? '—' : s.success_rate_24h + '%'}</div></div>
            <div className="kpi kpi-main"><div className="kpi-label">24h 消耗</div><div className="kpi-value kpi-accent">${s.cost_24h}</div></div>
          </div>
        </div>
      )}

      {(!data || data.channels.length === 0) && (
        <div className="card"><div className="ok-box">还没有上游账号。先在「上游账号」页添加，这里会显示每个渠道的健康状态。</div></div>
      )}

      <div className="ch-grid">
        {data?.channels.map((c) => {
          const sr = c.success_rate_24h;
          return (
            <div className="ch-card" key={c.id}>
              <div className="ch-head">
                <div className="ch-title">
                  <span className="ch-name">{c.name}</span>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-4)' }}>#{c.id}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <StatusBadge status={c.status} />
                  <HealthBadge h={c.health} />
                </div>
              </div>

              <div className="ch-meta">{(c.platform || c.type) && <span>{c.platform} / {c.type}</span>}{c.base_url && <span className="mono">· {c.base_url}</span>}{c.group_names && <span>分组：{c.group_names}</span>}{c.proxy_name && <span>代理：{c.proxy_name}</span>}</div>

              {/* 健康可视化：成功率 + 延迟条 */}
              <div className="ch-viz">
                <div className="viz-row"><span className="viz-label">成功率</span>
                  <div className="viz-track"><div className="viz-fill" style={{ width: `${sr === null ? 0 : Math.max(0, Math.min(100, sr))}%`, background: (sr ?? 0) >= 95 ? 'var(--ok)' : (sr ?? 0) >= 75 ? 'var(--warn)' : 'var(--danger)' }} /></div>
                  <span className="viz-num">{sr === null ? '—' : sr + '%'}</span>
                </div>
                <div className="viz-row"><span className="viz-label">平均延迟</span>
                  <div className="viz-track"><div className="viz-fill" style={{ width: `${c.avg_latency_24h ? Math.min(100, (c.avg_latency_24h / 3000) * 100) : 0}%`, background: c.avg_latency_24h && c.avg_latency_24h < 800 ? 'var(--accent)' : 'var(--warn)' }} /></div>
                  <span className="viz-num">{c.avg_latency_24h ? c.avg_latency_24h + 'ms' : '—'}</span>
                </div>
              </div>

              <div className="ch-stats">
                <div className="ch-stat"><span className="k">1h 请求</span><span className="v">{c.req_1h} <span className="k" style={{ fontWeight: 400 }}>(成功 {c.ok_1h})</span></span></div>
                <div className="ch-stat"><span className="k">24h 请求</span><span className="v">{c.req_24h}</span></div>
                <div className="ch-stat"><span className="k">成功率</span><span className="v">{sr === null ? '—' : sr + '%'}</span></div>
                <div className="ch-stat"><span className="k">平均延迟</span><span className="v">{c.avg_latency_24h ? c.avg_latency_24h + 'ms' : '—'}</span></div>
                <div className="ch-stat"><span className="k">24h Tokens</span><span className="v">{fmtNum(c.tokens_24h)}</span></div>
                <div className="ch-stat"><span className="k">24h 消耗</span><span className="v">${c.cost_24h}</span></div>
                <div className="ch-stat"><span className="k">最近使用</span><span className="v" style={{ fontWeight: 400, fontSize: 12 }}>{c.last_used_at ? fmtTime(c.last_used_at) : '—'}</span></div>
                <div className="ch-stat"><span className="k">创建</span><span className="v" style={{ fontWeight: 400, fontSize: 12 }}>{fmtTime(c.created_at)}</span></div>
              </div>

              {c.last_error && (
                <div className="err-box" style={{ fontSize: 12, wordBreak: 'break-all' }}>上次错误：{c.last_error}</div>
              )}

              <div className="ch-foot">
                <button className="btn btn-sm" onClick={() => toggle(c)}>{c.status === 'active' ? '暂停' : '启用'}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
