import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { useToast } from '../components/ui';
import { Users, Coins, Copy, ArrowRight } from '@phosphor-icons/react';

const O = { bg: '#fff8f2', card: '#fff', line: '#ffe7d4', accent: '#f97316', accentDeep: '#ea580c', ink: '#7c2d12' };
const cn = (n: number | string | null | undefined) => { const v = typeof n === 'string' ? Number(n) : n; return v == null || Number.isNaN(v) ? '-' : `¥${v}`; };

interface InvSummary { invite_code: string | null; invite_link: string | null; rebate_rate: number; invited: number; total_reward: number; withdrawable: number; codes: any[] }

export default function Affiliate() {
  const [data, setData] = useState<InvSummary | null>(null);
  const toast = useToast();

  useEffect(() => {
    (async () => { try { setData(await api.get<any>('/api/v1/billing/me/invite-summary')); } catch {} })();
  }, []);

  const copyLink = async () => {
    if (!data?.invite_link) return toast('暂无可邀请链接', 'err');
    try { await navigator.clipboard.writeText(data.invite_link); toast('邀请链接已复制'); } catch { toast('复制失败', 'err'); }
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      {/* 顶部四个统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 16 }}>
        <div style={statCard}><div style={{ color: '#9a3412', fontSize: 12, fontWeight: 600 }}>我的返利比例</div><div style={{ fontSize: 26, fontWeight: 800, color: O.ink, marginTop: 6 }}>{data?.rebate_rate ?? 0}%</div></div>
        <div style={statCard}><div style={{ color: '#9a3412', fontSize: 12, fontWeight: 600 }}>邀请人数</div><div style={{ fontSize: 26, fontWeight: 800, color: O.ink, marginTop: 6 }}>{data?.invited ?? 0}</div></div>
        <div style={statCard}><div style={{ color: '#9a3412', fontSize: 12, fontWeight: 600 }}>可提现额度</div><div style={{ fontSize: 26, fontWeight: 800, color: '#047857', marginTop: 6 }}>{cn(data?.withdrawable)}</div></div>
        <div style={statCard}><div style={{ color: '#9a3412', fontSize: 12, fontWeight: 600 }}>历史提现额度</div><div style={{ fontSize: 26, fontWeight: 800, color: O.ink, marginTop: 6 }}>¥0.00</div></div>
      </div>

      {/* 邀请返利 */}
      <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 22, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#9a3412', marginBottom: 6 }}>邀请返利</div>
        <div style={{ fontSize: 12.5, color: '#78716c', marginBottom: 16 }}>邀请新用户注册并消费，可获返利；返利可提现。</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: O.ink, marginBottom: 8 }}>我的邀请码</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input readOnly value={data?.invite_code || '暂无邀请码'} style={{ flex: 1, padding: 10, borderRadius: 10, border: `1px solid ${O.line}`, fontFamily: 'monospace', fontSize: 13 }} />
          <button style={btnCopy} onClick={() => { if (data?.invite_code) { navigator.clipboard.writeText(data.invite_code); toast('邀请码已复制'); } }}><Copy size={16} />复制</button>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: O.ink, marginBottom: 8 }}>兑换链接</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={data?.invite_link || '—'} style={{ flex: 1, padding: 10, borderRadius: 10, border: `1px solid ${O.line}`, fontSize: 12.5, color: '#78716c' }} />
          <button style={btnCopy} onClick={copyLink}><Copy size={16} />复制链接</button>
        </div>
      </div>

      {/* 使用说明 */}
      <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 22, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#9a3412', marginBottom: 10 }}>使用说明</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#78716c', lineHeight: 1.9 }}>
          <li>可邀请用户注册账户，消费后获得返利</li>
          <li>邀请返利范围仅限邀请参与的用户</li>
          <li>邀请返利体现于用户消费，可按比例提现</li>
          <li>邀请返利用户提现需先完成账户实名验证</li>
        </ul>
      </div>

      {/* 提现 */}
      <div style={{ background: O.card, border: `1px solid ${O.line}`, borderRadius: 16, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#9a3412' }}>返利额度提现</div>
          <button style={{ ...btnCopy, background: O.accentDeep }} onClick={() => toast('提现功能敬请期待', 'ok')}><ArrowRight size={16} />去提现</button>
        </div>
        <div style={{ fontSize: 12.5, color: '#78716c' }}>当前可提现额度 {cn(data?.withdrawable)}，提现前需完成实名验证。</div>
      </div>
    </div>
  );
}

const statCard: CSSProperties = { background: O.card, border: `1px solid ${O.line}`, borderRadius: 14, padding: '16px 18px' };
const btnCopy: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, background: O.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
