import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getToken } from '../api';
import { CheckCircle, ArrowRight, Tag } from '@phosphor-icons/react';

interface ModelPrice {
  model: string; input_price: number; output_price: number;
  cache_read_price: number; cache_write_price: number;
  peak_input_price?: number | null; peak_output_price?: number | null;
  peak_cache_read_price?: number | null; peak_cache_write_price?: number | null;
}
interface Group { id: number; name: string; platform: string; rate_multiplier: number }
interface PricingData {
  currency: string; multiplier: number; groups: Group[]; models: ModelPrice[]; peak_rule: string;
}

// 厂商 Tab：(标签, 前缀关键字数组)
const VENDORS: { label: string; keys: string[] }[] = [
  { label: 'Claude', keys: ['claude'] },
  { label: 'ChatGPT', keys: ['gpt', 'chatgpt', 'o1', 'o3', 'o4'] },
  { label: 'Grok', keys: ['grok'] },
  { label: 'Gemini', keys: ['gemini'] },
  { label: '智谱', keys: ['glm', 'zhipu'] },
  { label: 'Kimi', keys: ['kimi', 'moonshot'] },
  { label: 'DeepSeek', keys: ['deepseek'] },
  { label: 'MiniMax', keys: ['minimax', 'abab'] },
];

function vendorOf(model: string): string {
  const m = model.toLowerCase();
  for (const v of VENDORS) if (v.keys.some((k) => m.startsWith(k) || m.includes(k))) return v.label;
  return '其他';
}
function fmt(n: number | null | undefined, d = 2): string {
  const num = typeof n === 'string' ? Number(n) : n;
  if (num === null || num === undefined || Number.isNaN(num)) return '-';
  return num.toFixed(d);
}
// 分组倍率 -> 折扣文案（0.16 -> 1.6折，1 -> 原价）
function foldText(rate: number): string {
  if (rate >= 0.999) return '原价';
  return `${(rate * 10).toFixed(1)}折`;
}
function savingsPct(rate: number): number {
  return Math.max(0, Math.round((1 - rate) * 100));
}

export default function Pricing() {
  const nav = useNavigate();
  const [data, setData] = useState<PricingData>({ currency: 'CNY', multiplier: 1, groups: [], models: [], peak_rule: '' });
  const [vendor, setVendor] = useState('Claude');
  const [groupRate, setGroupRate] = useState<number>(1);
  const authed = !!getToken();

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get<any>('/api/v1/public/pricing');
        setData({ currency: 'CNY', multiplier: d?.multiplier ?? 1, groups: d?.groups || [], models: d?.models || [], peak_rule: d?.peak_rule || '' });
      } catch { /* 保持空 */ }
    })();
  }, []);

  const vendors = [...new Set(data.models.map((m) => vendorOf(m.model)))];
  const activeVendor = vendors.includes(vendor) ? vendor : (vendors[0] || 'Claude');
  const vendorModels = data.models.filter((m) => vendorOf(m.model) === activeVendor);
  // 有谷峰价的模型才显示谷峰列
  const anyPeak = vendorModels.some((m) => m.peak_input_price != null || m.peak_output_price != null);
  const start = () => nav(authed ? '/app' : '/login?signup=1');

  return (
    <div className="pricing-page">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <span className="brand-mark" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="12" r="2.4" /><circle cx="19" cy="5.5" r="2.4" /><circle cx="19" cy="18.5" r="2.4" /><path d="M7.2 11 16.8 6.4M7.2 13l9.6 4.6" />
              </svg>
            </span>
            <span className="landing-brand-name">中转站 Plus<small>模型价格</small></span>
          </div>
          <nav className="landing-nav-links">
            <Link to="/">首页</Link>
            <a href="/#features">特性</a>
            <a href="/#models">接入</a>
          </nav>
          <div className="landing-nav-cta">
            {authed ? (<Link className="btn btn-primary btn-sm" to="/app">进入控制台</Link>) : (<Link className="btn btn-primary btn-sm" to="/login?signup=1">免费注册</Link>)}
          </div>
        </div>
      </header>

      <section className="pt-hero">
        <h1>模型价格</h1>
        <p>单价单位：¥ / 1M tokens（按输入 / 输出分别计量）。官方价格 × ¥1 折算，分组价格 = 官方价格 × 分组倍率 × 1。</p>
      </section>

      {/* 厂商 Tab */}
      <section className="pt-card">
        <div className="pt-vendor-tabs">
          {vendors.length === 0 ? <span className="pt-dim">暂无可展示厂商</span> : vendors.map((v) => (
            <button key={v} className={v === activeVendor ? 'pt-tab active' : 'pt-tab'} onClick={() => setVendor(v)}>{v}</button>
          ))}
        </div>

        {/* 分组倍率卡 */}
        {data.groups.length > 0 && (
          <div className="pt-group-row">
            {data.groups.map((g) => (
              <button key={g.id} className={g.rate_multiplier === groupRate ? 'pt-group selected' : 'pt-group'} onClick={() => setGroupRate(g.rate_multiplier)}>
                <span className="pt-group-name">{g.name}</span>
                <span className="pt-group-fold">{foldText(g.rate_multiplier)}</span>
              </button>
            ))}
            <button className={groupRate === 1 ? 'pt-group selected' : 'pt-group'} onClick={() => setGroupRate(1)}>
              <span className="pt-group-name">原价</span><span className="pt-group-fold">官方价</span>
            </button>
          </div>
        )}

        <div className="pt-rule">{data.peak_rule}</div>

        <div className="pt-table-wrap">
          <table className="pt-table">
            <thead>
              <tr>
                <th>模型 ID</th><th>输入价格</th><th>输出价格</th><th>缓存读取</th><th>缓存写入</th>
                {anyPeak && <th>谷峰</th>}
                <th>节省幅度</th>
              </tr>
            </thead>
            <tbody>
              {vendorModels.length === 0 ? (
                <tr><td colSpan={7} className="pt-dim pt-empty">{activeVendor} 暂无可展示模型。</td></tr>
              ) : vendorModels.map((m) => {
                const hasPeak = m.peak_input_price != null || m.peak_output_price != null;
                const pct = savingsPct(groupRate);
                return (
                  <tr key={m.model}>
                    <td className="pt-model">{m.model}</td>
                    <td className="pt-price">¥{fmt(m.input_price * groupRate)}<span className="pt-per">/1M</span></td>
                    <td className="pt-price">¥{fmt(m.output_price * groupRate)}<span className="pt-per">/1M</span></td>
                    <td className="pt-price">¥{fmt(m.cache_read_price * groupRate)}</td>
                    <td className="pt-price">¥{fmt(m.cache_write_price * groupRate)}</td>
                    {anyPeak && (
                      <td>{hasPeak ? <span className="pt-peak">谷/峰</span> : <span className="pt-dim">—</span>}</td>
                    )}
                    <td><span className={pct > 0 ? 'pt-saving' : 'pt-dim'}>{pct > 0 ? `${pct}% 省` : '—'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pt-note"><Tag size={14} /> 实际费用按发起请求时的真实 usage 与所选分组倍率结算。你的 API Key 绑定的分组倍率优先于上方展示的全局倍率，具体倍率可在控制台「我的用量」页查看。</div>
      </section>

      <section className="pt-cta">
        <h2>准备好开始了吗？</h2>
        <div className="pt-cta-row">
          <button className="btn btn-primary btn-lg" onClick={start}>{authed ? '进入控制台' : '免费注册'} <ArrowRight size={16} weight="bold" /></button>
          <Link className="btn btn-lg" to="/">{authed ? '返回控制台' : '返回首页'}</Link>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-note">
            <CheckCircle size={14} /> 定价与模型价目由平台运营方维护，最终以实际请求结算为准。
          </div>
        </div>
      </footer>
    </div>
  );
}
