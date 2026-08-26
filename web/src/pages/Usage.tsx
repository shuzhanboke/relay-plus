import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useToast, fmtMoney, fmtNum } from '../components/ui';
import { ChartBar, Lightning, TextT, TextAlignLeft, CurrencyDollar, TrendUp } from '@phosphor-icons/react';

interface UsageResp {
  days: number;
  totals: { requests: number; prompt_tokens: number; completion_tokens: number; tokens?: number; cost: number };
  byModel: { model: string; requests: number; prompt_tokens: number; completion_tokens: number; cost: number }[];
  series: { day: string; requests: number; cost: number; tokens: number }[];
}

interface KeyRate { key_id: number; key_name: string; group_id: number | null; group_name: string | null; rate_multiplier: number }

const DAYS_OPTIONS = [7, 30, 90];

export default function Usage() {
  const [data, setData] = useState<UsageResp | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [pricing, setPricing] = useState<{ multiplier: number; effectiveRate: number; keyRates: KeyRate[] } | null>(null);
  const toast = useToast();

  const load = async (d: number) => {
    setLoading(true);
    try {
      const r = await api.get<UsageResp>(`/api/v1/billing/me/usage?days=${d}`);
      setData(r);
    } catch (ex: any) { toast(ex?.message || '加载用量失败', 'err'); }
    setLoading(false);
  };
  useEffect(() => {
    load(days);
    // 加载倍率信息（仅一次）
    api.get<any>('/api/v1/billing/me/pricing').then((p) => {
      if (p) setPricing({ multiplier: p.multiplier, effectiveRate: p.effectiveRate, keyRates: p.keyRates || [] });
    }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const pickDays = (d: number) => { setDays(d); load(d); };

  const kpis = data ? [
    { label: '总请求', value: fmtNum(data.totals.requests), icon: Lightning },
    { label: 'Prompt Tokens', value: fmtNum(data.totals.prompt_tokens), icon: TextT },
    { label: 'Completion Tokens', value: fmtNum(data.totals.completion_tokens), icon: TextAlignLeft },
    { label: '总 Token', value: fmtNum((data.totals.prompt_tokens || 0) + (data.totals.completion_tokens || 0)), icon: TrendUp },
    { label: '累计成本', value: fmtMoney(data.totals.cost), accent: true, icon: CurrencyDollar },
  ] : [];

  const maxSeriesReq = Math.max(1, ...(data?.series.map((s) => s.requests) || [1]));
  const globalMult = pricing?.multiplier ?? 1;
  const effectiveRate = pricing?.effectiveRate ?? 1;
  const rateDiffers = Math.abs(effectiveRate - globalMult) > 0.0001;

  return (
    <div>
      <div className="page-head rise" style={{ '--i': 0 } as CSSProperties}>
        <div>
          <h1>我的用量</h1>
          <div className="page-sub">你在本中转站的请求记录与消费（已按站内价格与倍率综合计算）</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {DAYS_OPTIONS.map((d) => (
            <button key={d} className={days === d ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => pickDays(d)}>{d} 天</button>
          ))}
        </div>
      </div>

      {/* 倍率信息条：展示用户实际计费倍率 */}
      {pricing && (
        <div className="card rise" style={{ '--i': 0.5 } as CSSProperties, { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>你的实际计费倍率：<span style={{ color: 'var(--accent-deep)' }}>{effectiveRate}×</span></span>
          {rateDiffers ? (
            <span style={{ color: 'var(--text-3)' }}>（全局倍率 {globalMult}×，你绑定的分组倍率 {effectiveRate}× 优先生效）</span>
          ) : (
            <span style={{ color: 'var(--text-3)' }}>（与全局倍率一致）</span>
          )}
          {pricing.keyRates.length > 0 && (
            <span style={{ color: 'var(--text-3)' }}>
              · Key 倍率：{pricing.keyRates.map((k) => `${k.key_name}→${k.group_name || '无分组'}(${k.rate_multiplier}×)`).join('，')}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="card">
          <div className="skeleton" style={{ width: '100%', height: 160 }} />
        </div>
      ) : data ? (
        <>
          <div className="kpi-panel rise" style={{ '--i': 1 } as CSSProperties}>
            <div className="kpi-grid">
              {kpis.map((k, i) => (
                <div key={k.label} className={i === 4 ? 'kpi kpi-hero' : 'kpi kpi-half'}>
                  <div className="kpi-label"><k.icon size={15} weight="regular" />{k.label}</div>
                  <div className={k.accent ? 'kpi-value kpi-accent' : 'kpi-value'}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card rise" style={{ '--i': 2 } as CSSProperties}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ChartBar size={16} weight="regular" />每日用量（近 {days} 天）</h2>
            {data.series.length === 0 ? (
              <div className="empty">该时段暂无用量数据。</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.series.map((s) => (
                  <div key={s.day} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 120px', alignItems: 'center', gap: 12 }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{s.day}</span>
                    <div style={{ height: 14, borderRadius: 4, overflow: 'hidden', background: 'var(--panel-soft)', border: '1px solid var(--line)' }}>
                      <div style={{ width: `${Math.round((s.requests / maxSeriesReq) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-deep))', borderRadius: 4 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span className="data-num">{fmtNum(s.requests)}</span>
                      <span className="data-num" style={{ color: 'var(--accent-deep)' }}>{fmtMoney(s.cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card rise" style={{ '--i': 3 } as CSSProperties}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ChartBar size={16} weight="regular" />按模型用量（我的）</h2>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>模型</th><th>请求数</th><th>Prompt</th><th>Completion</th><th>成本 (USD)</th></tr></thead>
                <tbody>
                  {data.byModel.map((m) => (
                    <tr key={m.model}>
                      <td><span className="mono">{m.model}</span></td>
                      <td className="data-num">{fmtNum(m.requests)}</td>
                      <td className="data-num">{fmtNum(m.prompt_tokens)}</td>
                      <td className="data-num">{fmtNum(m.completion_tokens)}</td>
                      <td className="data-num">{fmtMoney(m.cost)}</td>
                    </tr>
                  ))}
                  {data.byModel.length === 0 && <tr><td colSpan={5}><div className="empty">暂无模型用量。</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="card"><div className="empty">暂无用量数据。</div></div>
      )}
    </div>
  );
}
