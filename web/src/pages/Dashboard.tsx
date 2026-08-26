import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { Link } from 'react-router-dom';
import { TrendUp, TerminalWindow, BookOpen, Coins, ArrowRight } from '@phosphor-icons/react';

interface TrendPoint { label: string; requests: number }
interface ByModel { model: string; requests: number; prompt_tokens: number; completion_tokens: number; cost: number }

const O = { bg: '#fff8f2', card: '#fff', line: '#ffe7d4', accent: '#f97316', accentDeep: '#ea580c', ink: '#7c2d12', green: '#047857', greenBg: '#ecfdf5', accentBg: '#fff4e6' };

// 模型前缀 → 厂商配色
const VENDOR_COLORS: [string, string][] = [
  ['claude', '#d97706'], ['gpt', '#2563eb'], ['o1', '#2563eb'], ['o3', '#2563eb'], ['o4', '#2563eb'],
  ['gemini', '#7c3aed'], ['deepseek', '#0ea5e9'], ['grok', '#64748b'], ['kimi', '#f59e0b'], ['glm', '#10b981'],
];
function vendorColor(model: string): string {
  const m = model.toLowerCase();
  for (const [k, c] of VENDOR_COLORS) if (m.startsWith(k) || m.includes(k)) return c;
  return '#94a3b8';
}
const fmt = (n: number | null | undefined): string => { const v = typeof n === 'string' ? Number(n) : n; return v == null || Number.isNaN(v) ? '0' : String(v); };
const fmtK = (n: number | null | undefined): string => {
  const v = typeof n === 'string' ? Number(n) : n;
  if (v == null || Number.isNaN(v)) return '0';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return String(v);
};

function TrendChart({ series }: { series: TrendPoint[] }) {
  if (!series || series.length === 0) return <div style={{ color: '#a8a29e', textAlign: 'center', padding: 32 }}>暂无请求数据</div>;
  const W = 720, H = 150, P = 8;
  const max = Math.max(1, ...series.map((s) => s.requests));
  const stepX = series.length > 1 ? (W - P * 2) / (series.length - 1) : 0;
  const points = series.map((s, i) => ({ x: P + i * stepX, y: H - P - (s.requests / max) * (H - P * 2), ...s }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${path} L${(points[points.length - 1]?.x ?? P).toFixed(1)},${(H - P).toFixed(1)} L${P.toFixed(1)},${(H - P).toFixed(1)} Z`;
  const labelStep = Math.max(1, Math.ceil(series.length / 8));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="请求趋势">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1={P} x2={W - P} y1={H - P - f * (H - P * 2)} y2={H - P - f * (H - P * 2)} stroke="#ffe7d4" strokeWidth="1" />)}
      <path d={area} fill="url(#dashFill)" />
      <path d={path} fill="none" stroke={O.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => i % labelStep === 0 || i === points.length - 1 ? (
        <g key={i}><circle cx={p.x} cy={p.y} r="3" fill="#fff" stroke={O.accent} strokeWidth="2" /><text x={p.x} y={H - 2} textAnchor="middle" fontSize="9" fill="#a8a29e">{p.label}</text></g>
      ) : null)}
      <defs><linearGradient id="dashFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={O.accent} stopOpacity="0.25" /><stop offset="100%" stopColor={O.accent} stopOpacity="0" /></linearGradient></defs>
    </svg>
  );
}

const card: CSSProperties = { background: O.card, border: `1px solid ${O.line}`, borderRadius: 14, padding: 20, marginBottom: 14, boxShadow: '0 6px 20px -12px rgba(180,83,9,0.15)' };
const kpiCard: CSSProperties = { background: O.card, border: `1px solid ${O.line}`, borderRadius: 14, padding: '16px 18px' };

function fmtHour(h: string): string { const d = new Date(h); return Number.isNaN(d.getTime()) ? h.slice(11, 16) : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

interface DashStats {
  totalRequests: number;
  successRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [byModel, setByModel] = useState<ByModel[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get<any>('/api/v1/auth/me');
        setMe(me);
        const perms: string[] = me?.permissions || [];
        const isAdmin = me?.role === 'admin' || perms.includes('*') || perms.includes('log.view');
        if (isAdmin) {
          // 管理员：全站运营视图
          const data = await api.get<any>('/api/v1/admin/logs/stats').catch(() => null);
          if (data) {
            const s = data.stats || {};
            setStats({
              totalRequests: Number(s.totalRequests) || 0,
              successRequests: Number(s.successRequests) || 0,
              promptTokens: Number(s.promptTokens) || 0,
              completionTokens: Number(s.completionTokens) || 0,
              totalCost: Number(s.totalCost) || 0,
            });
            setTrend((data.hourly || []).map((h: any) => ({ label: fmtHour(h.hour), requests: Number(h.requests) || 0 })));
            setByModel(data.byModel || []);
          }
        } else {
          // 普通用户：个人用量视图
          const data = await api.get<any>('/api/v1/billing/me/usage?days=7').catch(() => null);
          if (data) {
            const t = data.totals || {};
            setStats({
              totalRequests: Number(t.requests) || 0,
              successRequests: Number(t.successRequests) || 0,
              promptTokens: Number(t.promptTokens) || 0,
              completionTokens: Number(t.completionTokens) || 0,
              totalCost: Number(t.cost) || 0,
            });
            setTrend((data.series || []).map((s: any) => ({ label: s.day, requests: Number(s.requests) || 0 })));
            setByModel(data.byModel || []);
          }
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div style={{ color: '#a8a29e', textAlign: 'center', padding: 40 }}>加载中…</div>;

  const s = stats || { totalRequests: 0, successRequests: 0, promptTokens: 0, completionTokens: 0, totalCost: 0 };
  const balance = Number(me?.balance) || 0;
  const isAdminView = me?.role === 'admin' || (me?.permissions || []).includes('*') || (me?.permissions || []).includes('log.view');
  const logsLink = isAdminView ? '/app/logs' : '/app/my-logs';

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      {/* 顶部提示条 */}
      <div style={{ background: '#fff4e6', border: `1px solid #fed7aa`, borderRadius: 12, padding: '12px 16px', marginBottom: 14, color: '#9a3412', fontSize: 13.5 }}>
        请通过 API 密钥访问服务。当前为<b>{isAdminView ? '运营视图' : '个人用量视图'}</b>，展示{isAdminView ? '全站流量、计费与趋势' : '你的请求记录与消费'}。
      </div>

      {/* KPI 网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px,1fr))', gap: 12, marginBottom: 14 }}>
        <div style={{ ...kpiCard, background: `linear-gradient(135deg, ${O.accent}, ${O.accentDeep})`, color: '#fff', border: 'none' }}>
          <div style={{ opacity: 0.9, fontSize: 12 }}>当前余额</div>
          <div style={{ fontSize: 25, fontWeight: 800, marginTop: 6 }}>¥{fmt(balance)}</div>
        </div>
        <div style={kpiCard}><div style={{ color: '#9a3412', fontSize: 12 }}>累计 Token</div><div style={{ fontSize: 25, fontWeight: 800, color: O.ink, marginTop: 6 }}>{fmtK(s.promptTokens)}</div></div>
        <div style={kpiCard}><div style={{ color: '#9a3412', fontSize: 12 }}>成功请求</div><div style={{ fontSize: 25, fontWeight: 800, color: O.ink, marginTop: 6 }}>{fmt(s.successRequests)}</div></div>
        <div style={kpiCard}><div style={{ color: '#9a3412', fontSize: 12 }}>总请求</div><div style={{ fontSize: 25, fontWeight: 800, color: O.ink, marginTop: 6 }}>{fmt(s.totalRequests)}</div></div>
        <div style={kpiCard}><div style={{ color: '#9a3412', fontSize: 12 }}>总 Token</div><div style={{ fontSize: 25, fontWeight: 800, color: O.ink, marginTop: 6 }}>{fmtK(s.promptTokens + s.completionTokens)}</div></div>
        <div style={kpiCard}><div style={{ color: '#9a3412', fontSize: 12 }}>累计消耗</div><div style={{ fontSize: 25, fontWeight: 800, color: O.green, marginTop: 6 }}>¥{fmt(s.totalCost)}</div></div>
        <div style={kpiCard}><div style={{ color: '#9a3412', fontSize: 12 }}>成功率</div><div style={{ fontSize: 25, fontWeight: 800, color: O.ink, marginTop: 6 }}>{s.totalRequests ? Math.round((s.successRequests / s.totalRequests) * 100) : 0}%</div></div>
        <div style={{ ...kpiCard, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Link to={logsLink} style={{ display: 'flex', alignItems: 'center', gap: 6, background: O.accent, color: '#fff', padding: '10px 16px', borderRadius: 10, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>查看历史 <ArrowRight size={14} /></Link>
        </div>
      </div>

      {/* 模型分布（厂商小卡） */}
      {byModel.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#9a3412', marginBottom: 12 }}>模型分布</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px,1fr))', gap: 10 }}>
            {byModel.slice(0, 12).map((m) => (
              <div key={m.model} style={{ border: `1px solid ${O.line}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: vendorColor(m.model) }} />
                  <span style={{ fontSize: 12, color: '#78716c' }}>{m.model}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: O.ink, marginTop: 6 }}>{fmtK(m.prompt_tokens + m.completion_tokens)}</div>
                <div style={{ fontSize: 11, color: '#a8a29e' }}>{fmt(m.requests)} 请求</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 时间筛选 + 趋势图 */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#9a3412' }}><TrendUp size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />请求趋势（{isAdminView ? '近 24 小时' : '近 7 天'}）</div>
        </div>
        <TrendChart series={trend} />
      </div>

      {/* 最近请求 */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#9a3412', marginBottom: 12 }}>{isAdminView ? '最近请求' : '我的请求'}</div>
        {byModel.length === 0 ? <div style={{ color: '#a8a29e', textAlign: 'center', padding: 24 }}>暂无请求数据</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['模型', '请求数', 'Prompt', '输出', '成本'].map((h) => <th key={h} style={{ textAlign: 'left', color: '#78716c', fontWeight: 600, padding: '8px 10px', borderBottom: `1px solid ${O.line}` }}>{h}</th>)}</tr></thead>
            <tbody>{byModel.map((m) => (
              <tr key={m.model}>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2' }}>{m.model}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2' }}>{fmt(m.requests)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2' }}>{fmtK(m.prompt_tokens)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2' }}>{fmtK(m.completion_tokens)}</td>
                <td style={{ padding: '12px 10px', borderBottom: '1px solid #fff1e2', color: O.green }}>¥{fmt(m.cost)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {/* 快捷操作 */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#9a3412', marginBottom: 12 }}>快捷操作</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px,1fr))', gap: 10 }}>
          {[
            { icon: BookOpen, title: '接入文档', desc: '了解如何接入 Claude Code / Codex', link: '/app/keys' },
            { icon: Coins, title: '余额查询 API', desc: '查看当前余额与充值方式', link: '/app/charge' },
            { icon: TerminalWindow, title: '最新 API', desc: '查看可用模型与价格', link: '/pricing' },
          ].map((q) => (
            <Link key={q.title} to={q.link} style={{ ...kpiCard, display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none', color: 'inherit' }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: O.accentBg, color: O.accentDeep }}><q.icon size={20} /></span>
              <span>
                <span style={{ display: 'block', fontWeight: 700, color: '#44403c', fontSize: 14 }}>{q.title}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#a8a29e', marginTop: 2 }}>{q.desc}</span>
              </span>
              <span style={{ marginLeft: 'auto', color: O.accent }}><ArrowRight size={16} /></span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
