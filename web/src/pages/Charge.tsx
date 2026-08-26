import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useToast } from '../components/ui';
import { QrCode, CheckCircle, Wallet, ArrowRight, type Icon } from '@phosphor-icons/react';

interface Method { id: string; label: string; hint: string; address?: string; qr_image?: string }
interface Plan { id: number; name: string; amount: number; credit: number; rebate: number; type: string; period_days?: number | null; monthly_credit?: number | null }

// apikey 橙色系（用于充值/订阅页视觉）
const O = {
  bg: '#fff8f2',
  card: '#ffffff',
  line: '#ffe7d4',
  accent: '#f97316',
  accentDeep: '#ea580c',
  accentBg: '#fff4e6',
  ink: '#7c2d12',
} as const;

const METHOD_ICONS: Record<string, Icon> = { qr: QrCode, test_qr: QrCode, usdt: Wallet };
const FALLBACK_ICON: Icon = Wallet;

const pageStyle: CSSProperties = { background: O.bg, borderRadius: 18, padding: 26, border: `1px solid ${O.line}` };
const cardStyle: CSSProperties = { background: O.card, borderRadius: 16, border: `1px solid ${O.line}`, padding: 22, marginBottom: 16, boxShadow: '0 6px 20px -12px rgba(180,83,9,0.15)' };
const tabStyle = (active: boolean): CSSProperties => ({ padding: '8px 16px', borderRadius: 10, border: `1px solid ${active ? O.accent : O.line}`, background: active ? O.accent : '#fff', color: active ? '#fff' : O.ink, fontWeight: 600, cursor: 'pointer', fontSize: 13.5 });
const buyBtn: CSSProperties = { width: '100%', background: O.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 700, cursor: 'pointer', fontSize: 13.5 };
const buyBtnHot: CSSProperties = { ...buyBtn, background: O.accentDeep };

function fmt(n: number | null | undefined): string { const v = typeof n === 'string' ? Number(n) : n; return v == null || Number.isNaN(v) ? '-' : String(v); }

export default function Charge() {
  const [methods, setMethods] = useState<Method[]>([]);
  const [channels, setChannels] = useState<{ id: string; label: string; enabled: boolean }[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<'prepaid' | 'subscription'>('prepaid');
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [customAmount, setCustomAmount] = useState('');
  const [manualInfo, setManualInfo] = useState('');
  const [testQr, setTestQr] = useState<{ image: string; info: string } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payTab, setPayTab] = useState<'rmb' | 'usdt'>('rmb');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      try { const d = await api.get<any>('/api/v1/billing/me/payment-methods'); setMethods(d.methods || []); } catch {}
      try { const c = await api.get<any>('/api/v1/billing/pay/channels'); setChannels(c.channels || []); } catch {}
      try { const d = await api.get<any>('/api/v1/billing/plans'); setPlans(d.plans || []); } catch {}
      try { setMe(await api.get('/api/v1/auth/me')); } catch {}
    })();
  }, []);

  const activePlans = plans.filter((p) => p.type === tab);
  const balance = Number(me?.balance) || 0;

  const openPay = (planId?: number) => { if (planId) setSelectedPlan(String(planId)); if (!planId && !selectedPlan && !customAmount) return toast('请先选择套餐或输入金额', 'err'); setPayOpen(true); };
  const pay = async (m: Method) => {
    const amount = selectedPlan ? (plans.find((p) => String(p.id) === String(selectedPlan))?.amount || 0) : (Number(customAmount) || 0);
    if (amount <= 0) return toast('金额无效', 'err');
    if (m.id === 'test_qr') { try { const r = await api.get<any>('/api/v1/billing/pay/test-qr'); setTestQr(r); } catch (ex: any) { toast(ex?.message || '拉取收款码失败', 'err'); } return; }
    setBusy(true);
    try {
      const r: any = await api.post('/api/v1/billing/me/orders', { plan_id: selectedPlan ? Number(selectedPlan) : undefined, amount: selectedPlan ? undefined : amount, channel: m.id });
      setManualInfo(typeof r.message === 'string' ? r.message : (r.manual_info || ('订单 ' + r.order_no + ' 已生成，请联系管理员确认到账。')));
      toast('已生成订单');
    } catch (ex: any) { toast(ex?.message || '下单失败', 'err'); }
    setBusy(false); setPayOpen(false);
  };
  const payThird = async (ch: { id: string; enabled: boolean }) => {
    const amount = selectedPlan ? (plans.find((p) => String(p.id) === String(selectedPlan))?.amount || 0) : (Number(customAmount) || 0);
    if (amount <= 0) return toast('金额无效', 'err');
    setBusy(true);
    try {
      if (!ch.enabled) { const o = await api.post<any>('/api/v1/billing/me/orders', { plan_id: selectedPlan ? Number(selectedPlan) : undefined, amount: selectedPlan ? undefined : amount, channel: 'manual' }); setManualInfo('该支付方式暂未开通在线支付，已生成本地订单 ' + o.order_no + '，请联系客服转账确认到账。'); toast('该支付方式尚未配置', 'err'); setBusy(false); setPayOpen(false); return; }
      const r: any = await api.post('/api/v1/billing/pay/start', { channel: ch.id, plan_id: selectedPlan ? Number(selectedPlan) : undefined, amount: selectedPlan ? undefined : amount });
      if (r.mode === 'qr' && r.code_url) setManualInfo('请使用对应 APP 扫码支付：\n' + r.code_url);
      else if (r.pay_url) window.location.href = r.pay_url;
      else toast('支付跳转失败');
    } catch (ex: any) { toast(ex?.message || '发起支付失败', 'err'); }
    setBusy(false); setPayOpen(false);
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* 顶部余额卡 */}
      <div style={{ ...cardStyle, background: `linear-gradient(135deg, ${O.accent}, ${O.accentDeep})`, color: '#fff', border: 'none' }}>
        <div style={{ fontSize: 13, opacity: 0.9 }}>当前余额</div>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4 }}>¥{fmt(balance)}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>充值 1 元 = 1 美元余额（按量扣费）</div>
      </div>

      {/* 按量/按月 Tab */}
      <div style={pageStyle}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <button style={tabStyle(tab === 'prepaid')} onClick={() => setTab('prepaid')}>按量充值</button>
          <button style={tabStyle(tab === 'subscription')} onClick={() => setTab('subscription')}>按月订阅</button>
        </div>

        {/* 多充多送提示条 */}
        <div style={{ background: '#fff4e6', border: '1px solid #fed7aa', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 14 }}>多充多送，充值返利随充值越多</div>
            <div style={{ fontSize: 12, color: '#c2410c', marginTop: 3 }}>可受邀用户使用返利比 × 兑率，最高返利 ¥24.9</div>
          </div>
          <span style={{ background: O.accent, color: '#fff', padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>最高返利 ¥24.9</span>
        </div>

        {/* 套餐卡网格 */}
        {activePlans.length === 0 ? <div style={{ color: '#a8a29e', textAlign: 'center', padding: '28px 0' }}>暂无{tab === 'prepaid' ? '按量' : '按月'}套餐，请联系管理员配置。</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 12 }}>
            {activePlans.map((p, i) => {
              const hot = p.amount >= 500 && i === 2;
              const selected = String(p.id) === String(selectedPlan);
              const active = hot || selected;
              return (
                <div key={p.id} style={{ ...cardStyle, marginBottom: 0, position: 'relative', borderColor: active ? O.accent : O.line, boxShadow: active ? '0 0 0 2px ' + O.accent + '55' : undefined, transition: 'border-color .2s, transform .15s, box-shadow .2s', cursor: 'pointer' }}>
                  {selected && <span style={{ position: 'absolute', top: -8, right: 10, background: O.accent, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8 }}>已选</span>}
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#78716c' }}>{p.name}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#7c2d12', margin: '6px 0' }}>¥{fmt(p.amount)}</div>
                  <div style={{ fontSize: 12, color: '#9a3412' }}>到账 {fmt(p.credit)} 余额</div>
                  {p.rebate > 0 && <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>送 {fmt(p.rebate)} 返利</div>}
                  {tab === 'subscription' && <div style={{ fontSize: 12, color: '#a8a29e', marginTop: 2 }}>{p.period_days || 30} 天 / {fmt(p.monthly_credit)} 额度</div>}
                  <div style={{ marginTop: 10 }}>
                    <button style={hot ? buyBtnHot : buyBtn} onClick={() => openPay(p.id)}>立即购买</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 自定义金额 */}
        <div style={{ ...cardStyle, marginTop: 16, marginBottom: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 10 }}>或自定义充值</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input type="number" min={1} value={customAmount} onChange={(e) => { setCustomAmount(e.target.value); setSelectedPlan(''); }} placeholder="输入金额（¥）" style={{ flex: 1, padding: 10, borderRadius: 10, border: `1px solid ${O.line}`, fontSize: 13.5 }} />
            <button style={buyBtn} onClick={() => openPay()}>去支付</button>
          </div>
        </div>
      </div>

      {/* 支付方式 */}
      {channels.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 12 }}>在线支付</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10 }}>
            {channels.map((ch) => (
              <button key={ch.id} onClick={() => payThird(ch)} disabled={busy} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 16, border: `1px solid ${O.line}`, borderRadius: 12, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: O.accentBg, color: O.accentDeep }}>{ch.enabled ? <CheckCircle size={20} /> : <QrCode size={20} />}</span>
                <span style={{ fontWeight: 700, color: '#44403c', fontSize: 13.5 }}>{ch.label}</span>
                <span style={{ fontSize: 11.5, color: ch.enabled ? '#4b8f5a' : '#c2410c' }}>{ch.enabled ? '已配置' : '联系客服'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(manualInfo || testQr) && (
        <div style={cardStyle}>
          {manualInfo && <div style={{ background: '#fff7ed', border: `1px solid #fed7aa`, color: '#9a3412', padding: 12, borderRadius: 12, whiteSpace: 'pre-wrap' }}>{manualInfo}</div>}
          {testQr && <div style={{ textAlign: 'center', padding: '8px 0' }}><img src={testQr.image} alt="付款码" width={180} height={180} style={{ borderRadius: 12, border: `1px solid ${O.line}` }} /><div style={{ fontSize: 12, color: '#78716c', marginTop: 10, whiteSpace: 'pre-wrap' }}>{testQr.info}</div></div>}
        </div>
      )}

      {/* 支付方式弹窗（RMB/USDT） */}
      {payOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={() => setPayOpen(false)}>
          <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#7c2d12' }}>选择支付方式</div>
              <button style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#a8a29e' }} onClick={() => setPayOpen(false)}>×</button>
            </div>
            <div style={{ background: '#fff7ed', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#9a3412' }}>支付金额</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#7c2d12' }}>{payTab === 'rmb' ? `¥${selectedPlan ? fmt(plans.find((p) => String(p.id) === String(selectedPlan))?.amount) : customAmount || '0'}` : `$${selectedPlan ? fmt(plans.find((p) => String(p.id) === String(selectedPlan))?.amount) : customAmount || '0'}`}</div>
              <div style={{ fontSize: 12, color: '#9a3412' }}>到账 {selectedPlan ? fmt(plans.find((p) => String(p.id) === String(selectedPlan))?.credit) : (customAmount || '0')} 余额</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button style={{ ...tabStyle(payTab === 'rmb'), flex: 1 }} onClick={() => setPayTab('rmb')}>RMB 支付</button>
              <button style={{ ...tabStyle(payTab === 'usdt'), flex: 1 }} onClick={() => setPayTab('usdt')}>USDT 支付</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {payTab === 'rmb' ? (channels.length ? channels.map((ch) => (
                <button key={ch.id} onClick={() => { payThird(ch); }} disabled={busy} style={buyBtn}>{ch.label}</button>
              )) : methods.map((m) => (
                <button key={m.id} onClick={() => pay(m)} disabled={busy} style={buyBtn}>{m.label}</button>
              ))) : (
                (methods.filter((m) => m.id === 'usdt').length ? methods.filter((m) => m.id === 'usdt').map((m) => (
                  <button key={m.id} onClick={() => pay(m)} disabled={busy} style={buyBtn}>{m.label}{m.address ? ` · ${m.address}` : ''}</button>
                )) : <button style={buyBtn} onClick={() => { setPayOpen(false); toast('请先联系管理员配置 USDT 收款', 'err'); }}>USDT 暂未开通</button>)
              )}
            </div>
            <div style={{ marginTop: 14, textAlign: 'center', display: 'flex', gap: 8, justifyContent: 'center', fontSize: 11, color: '#a8a29e' }}>
              <span>VISA</span><span>Master</span><span>AMEX</span><span>JCB</span><span>UnionPay</span>
            </div>
          </div>
        </div>
      )}

      <div style={{ ...cardStyle, fontSize: 12, color: '#a8a29e', lineHeight: 1.7 }}>
        到账方式：<b style={{ color: '#c2410c' }}>卡密兑换</b>（立即到账）可选；或选择套餐下单后由管理员确认到账。调用时优先消耗订阅额度，其余扣余额。
      </div>
    </div>
  );
}
