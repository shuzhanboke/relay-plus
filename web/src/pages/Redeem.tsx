import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useToast, fmtTime } from '../components/ui';
import { Gift, CheckCircle, Info } from '@phosphor-icons/react';

interface RedeemRow { code: string; credit: number; created_at: string }

const O = { bg: '#fff8f2', card: '#fff', line: '#ffe7d4', accent: '#f97316', accentDeep: '#ea580c', accentBg: '#fff4e6', ink: '#7c2d12' };
const cnNum = (n: number | null | undefined): string => { const v = typeof n === 'string' ? Number(n) : n; return v == null || Number.isNaN(v) ? '-' : String(v); };

export default function Redeem() {
  const [code, setCode] = useState('');
  const [records, setRecords] = useState<RedeemRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<any>(null);
  const toast = useToast();

  const load = async () => {
    try { setRecords(await api.get<RedeemRow[]>('/api/v1/billing/me/redeems')); } catch {}
    try { setMe(await api.get('/api/v1/auth/me')); } catch {}
    setLoaded(true);
  };
  useEffect(() => { if (!loaded) load(); }, [loaded]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return toast('请输入卡密', 'err');
    setLoading(true);
    try {
      const r = await api.post<any>('/api/v1/billing/me/redeem', { code: code.trim() });
      toast(`兑换成功，已到账 ¥${cnNum(r.credited)}`);
      setCode(''); load();
    } catch (ex: any) { toast(ex?.message || '兑换失败', 'err'); } finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* 余额卡 */}
      <div style={{ background: `linear-gradient(135deg, ${O.accent}, ${O.accentDeep})`, borderRadius: 18, padding: 26, color: '#fff', textAlign: 'center' }}>
        <Gift size={22} style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 13, opacity: 0.9 }}>当前余额</div>
        <div style={{ fontSize: 30, fontWeight: 800, marginTop: 4 }}>¥{cnNum(me?.balance)}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>充值 ¥10 返 1</div>
      </div>

      {/* 兑换码 */}
      <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 22, marginTop: 16 }}>
        <form onSubmit={submit}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 8 }}>兑换码</div>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="请输入兑换码" autoFocus
            style={{ width: '100%', padding: 12, borderRadius: 12, border: `1px solid ${O.line}`, fontSize: 14, fontFamily: 'monospace' }} />
          <div style={{ fontSize: 11.5, color: '#a8a29e', marginTop: 6 }}>兑换码区分大小写</div>
          <button type="submit" disabled={loading} style={{ width: '100%', marginTop: 14, background: O.accent, color: '#fff', border: 'none', borderRadius: 12, padding: 12, fontWeight: 700, cursor: 'pointer' }}>
            {loading ? '兑换中…' : '兑换'}
          </button>
        </form>
      </div>

      {/* 关于兑换码 */}
      <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 22, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9a3412', fontWeight: 700, marginBottom: 12 }}><Info size={18} />关于兑换码</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#78716c', lineHeight: 1.8 }}>
          <li>每个兑换码仅可使用一次</li>
          <li>兑换码仅可兑换余额 / 额度</li>
          <li>兑换码有效期请查看卡面</li>
          <li>兑换折扣未使用到全价时</li>
        </ul>
      </div>

      {/* 最近活动 */}
      <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 22, marginTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 12 }}>最近活动</div>
        {records.length === 0 ? <div style={{ color: '#a8a29e', textAlign: 'center', padding: 20 }}>暂无兑换记录</div> : records.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i === records.length - 1 ? 'none' : `1px solid #fff1e2` }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#44403c', fontSize: 13 }}><CheckCircle size={16} style={{ color: '#047857' }} />余额兑换（{r.code}）</span>
            <span style={{ color: '#047857', fontWeight: 700, fontSize: 13 }}>+¥{cnNum(r.credit)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
