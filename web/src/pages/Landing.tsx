import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getToken } from '../api';
import {
  Lightning, ShieldCheck, Gauge, Key, Coins, TerminalWindow, ArrowRight,
  CheckCircle, Globe, Plug, Stack, ChartLine, LockKey,
} from '@phosphor-icons/react';

interface ModelPrice { model: string; input_price: number; output_price: number; }
interface Plan { id: number; name: string; description: string | null; amount: number; credit: number; type: string; period_days: number | null; monthly_credit: number | null; }

const FEATURES = [
  { icon: Key, title: '一键获取 API Key', desc: '注册即可创建 sk- 面板 Key，几十秒接入 Claude Code、Codex、OpenAI SDK。' },
  { icon: Coins, title: '按量计费 · 余额透明', desc: '按真实 usage 计费（含 cache tokens），余额实时扣费，不足自动拒绝。' },
  { icon: Gauge, title: '高并发 · 稳定中转', desc: '多上游账号池 + 负载均衡 + 限流，流式（SSE）透传，响应低延迟。' },
  { icon: ShieldCheck, title: '配额与限流保护', desc: '可按 Key 设 RPM / TPM / 并发上限，防止滥用导致成本失控。' },
  { icon: ChartLine, title: '全量用量统计', desc: '日志、按模型消耗、近 24h 趋势一目了然，成本随时可核对。' },
  { icon: Plug, title: 'OpenAI / Anthropic 兼容', desc: '兼容 /v1 与 /v1/messages，替换 base_url 与 api_key 即可无缝迁移。' },
];

const STEPS = [
  { n: '01', title: '注册并获取 Key', desc: '注册账号 → 创建 API Key，只在创建时展示一次。' },
  { n: '02', title: '充值 / 订阅', desc: '卡密兑换、扫码转账或订阅套餐，即时到账。' },
  { n: '03', title: '接入调用', desc: '把 base_url 与 api_key 填入客户端，即可调用大模型。' },
  { n: '04', title: '查看用量与日志', desc: '实时查看余额、消耗与请求记录，成本心中有数。' },
];

function fmtMoney(n: number | null | undefined): string {
  const num = typeof n === 'string' ? Number(n) : n;
  if (num === null || num === undefined || Number.isNaN(num)) return '-';
  return `$${num.toFixed(6)}`;
}

export default function Landing() {
  const nav = useNavigate();
  const [site, setSite] = useState<Record<string, any>>({});
  const [models, setModels] = useState<ModelPrice[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const authed = !!getToken();

  useEffect(() => {
    (async () => {
      try { setSite(await api.get('/api/v1/public/site')); } catch {}
      try {
        const m = await api.get<any>('/api/v1/public/models');
        setModels((m?.prices || []).slice(0, 12));
      } catch {}
      try {
        const p = await api.get<any>('/api/v1/public/plans');
        setPlans((p?.plans || []).filter((x: Plan) => x.type === 'subscription' || x.amount).slice(0, 6));
      } catch {}
    })();
  }, []);

  const name = site.system_name || '中转站 Plus';
  const start = () => nav(authed ? '/' : '/login?signup=1');

  return (
    <div className="landing">
      {/* ---------- 顶部导航 ---------- */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <span className="brand-mark" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="12" r="2.4" />
                <circle cx="19" cy="5.5" r="2.4" />
                <circle cx="19" cy="18.5" r="2.4" />
                <path d="M7.2 11 16.8 6.4M7.2 13l9.6 4.6" />
              </svg>
            </span>
            <span className="landing-brand-name">{name}<small>AI API 中转</small></span>
          </div>
          <nav className="landing-nav-links">
            <a href="#features">特性</a>
            <a href="#models">模型</a>
            <Link to="/pricing">定价</Link>
            <a href="#start">接入</a>
          </nav>
          <div className="landing-nav-cta">
            {authed ? (
              <Link className="btn btn-primary btn-sm" to="/">进入控制台</Link>
            ) : (
              <>
                <Link className="btn btn-sm" to="/login">登录</Link>
                <Link className="btn btn-primary btn-sm" to="/login?signup=1">免费注册</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="landing-hero">
        <div className="hero-badge rise"><Lightning size={14} /> {name} · 一个 API Key 就够了</div>
        <h1 className="hero-title">
          统一接入全球主流大模型
          <span className="hero-title-accent">，稳定 · 高性价比</span>
        </h1>
        <p className="hero-sub">
          把 OpenAI、Anthropic、Gemini 等上游能力接入一个网关，注册即得面板 Key，
          按量计费、余额透明，兼容 Claude Code / Codex / OpenAI SDK。
        </p>
        <div className="hero-cta">
          <button className="btn btn-primary btn-lg" onClick={start}>
            {authed ? '进入控制台' : '立即免费注册'} <ArrowRight size={16} weight="bold" />
          </button>
          <Link className="btn btn-lg" to="/pricing">查看定价</Link>
        </div>
        <div className="hero-stats">
          <div className="hero-stat"><b>兼容</b><span>OpenAI / Anthropic</span></div>
          <div className="hero-stat"><b>计费</b><span>真实 usage</span></div>
          <div className="hero-stat"><b>接入</b><span>Claude Code · Codex</span></div>
        </div>
      </section>

      {/* ---------- 特性 ---------- */}
      <section className="landing-section" id="features">
        <div className="landing-section-head">
          <h2>为什么选择 {name}</h2>
          <p>面向开发者与个人用户的 AI API 中转服务，稳定、便宜、可自助。</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon"><f.icon size={20} weight="regular" /></div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- 模型矩阵 ---------- */}
      <section className="landing-section" id="models">
        <div className="landing-section-head">
          <h2>模型与单价</h2>
          <p>按输入 / 输出 tokens 计费，单位美元每百万 tokens，真实用量结算。</p>
        </div>
        <div className="model-card">
          <div className="model-table-wrap">
            <table className="data">
              <thead><tr><th>模型</th><th>输入</th><th>输出</th></tr></thead>
              <tbody>
                {models.length === 0 ? (
                  <tr><td colSpan={3} className="empty" style={{ padding: 24 }}>暂无可展示模型，请登录后台配置模型价格。</td></tr>
                ) : models.map((m) => (
                  <tr key={m.model}>
                    <td><span className="mono">{m.model}</span></td>
                    <td className="data-num">{fmtMoney(m.input_price)} /1M</td>
                    <td className="data-num">{fmtMoney(m.output_price)} /1M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- 定价摘要 ---------- */}
      <section className="landing-section" id="pricing">
        <div className="landing-section-head">
          <h2>灵活的计费方式</h2>
          <p>按量充值、月度订阅，满足不同用量需求。</p>
        </div>
        {plans.length === 0 ? (
          <div className="model-card">
            <div className="empty" style={{ padding: 28 }}>套餐即将上线，请先注册体验免费额度。</div>
          </div>
        ) : (
          <div className="plan-grid">
            {plans.map((p) => (
              <div className={p.type === 'subscription' ? 'plan-card is-featured' : 'plan-card'} key={p.id}>
                <div className="plan-name">{p.name}</div>
                {p.description && <div className="plan-desc">{p.description}</div>}
                <div className="plan-price">${p.amount}<span className="per">{p.type === 'subscription' ? ` / ${p.period_days || 30} 天` : ''}</span></div>
                <div className="plan-note">
                  {p.type === 'subscription' ? `每月可用额度 ${fmtMoney(p.monthly_credit)}` : `到账 ${fmtMoney(p.credit)} 余额`}
                </div>
                <div className="plan-cta">
                  <Link className="btn btn-primary btn-sm" to="/login?signup=1">开始使用</Link>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="pricing-note"><Link to="/pricing">查看完整定价 →</Link></div>
      </section>

      {/* ---------- 接入步骤 ---------- */}
      <section className="landing-section" id="start">
        <div className="landing-section-head">
          <h2>三步开始调用</h2>
          <p>无需复杂配置，替换 base_url 与 api_key 即可。</p>
        </div>
        <div className="step-grid">
          {STEPS.map((s) => (
            <div className="step-card" key={s.n}>
              <div className="step-n">{s.n}</div>
              <div className="step-title">{s.title}</div>
              <div className="step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
        <div className="code-card">
          <div className="code-head"><TerminalWindow size={16} weight="regular" /> Claude Code 接入示例</div>
          <pre className="code-block">{`export ANTHROPIC_BASE_URL="https://你的域名/v1"
export ANTHROPIC_AUTH_TOKEN="sk-你的面板Key"`}</pre>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="landing-cta">
        <div className="cta-inner">
          <h2>立即开始你的 AI API 之路</h2>
          <p>注册即享免费体验额度，轻松接入主流大模型。</p>
          <button className="btn btn-primary btn-lg" onClick={start}>
            {authed ? '进入控制台' : '免费注册账号'} <ArrowRight size={16} weight="bold" />
          </button>
        </div>
      </section>

      {/* ---------- 页脚 ---------- */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-brand">
            <span className="brand-mark" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="12" r="2.4" />
                <circle cx="19" cy="5.5" r="2.4" />
                <circle cx="19" cy="18.5" r="2.4" />
                <path d="M7.2 11 16.8 6.4M7.2 13l9.6 4.6" />
              </svg>
            </span>
            <span className="landing-brand-name">{name}<small>AI API 中转</small></span>
          </div>
          <div className="landing-footer-links">
            <Link to="/pricing">定价</Link>
            <a href="#features">特性</a>
            <a href="#models">模型</a>
            <Link to="/login">登录</Link>
          </div>
          <div className="landing-footer-note">
            <ShieldCheck size={14} /> 合规提示：请遵守上游平台服务条款，自行评估风险并控制用量。
          </div>
        </div>
      </footer>
    </div>
  );
}
