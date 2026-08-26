import { useEffect, useState } from 'react';
import { api } from '../api';
import { StatusBadge, useToast, fmtMoney, fmtTime } from '../components/ui';

interface Card { id: number; code: string; credit: number; status: string; batch: string | null; used_email: string | null; used_at: string | null; created_at: string }

export default function GiftCards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [showGen, setShowGen] = useState(false);
  const [count, setCount] = useState(10);
  const [credit, setCredit] = useState(1);
  const [batch, setBatch] = useState('');
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const toast = useToast();

  const load = async () => { try { setCards(await api.get<Card[]>('/api/v1/admin/gift-cards?limit=200')); } catch {} };
  useEffect(() => { load(); }, []);

  const gen = async () => {
    try {
      const r = await api.post<any>('/api/v1/admin/gift-cards', { count, credit, batch: batch || undefined });
      setNewCodes(r.codes || []);
      setShowGen(false);
      toast(`已生成 ${r.count} 张卡密`);
      load();
    } catch (ex: any) { toast(ex?.message || '生成失败', 'err'); }
  };

  const toggle = async (c: Card) => {
    const s = c.status === 'unused' ? 'disabled' : 'unused';
    await api.patch(`/api/v1/admin/gift-cards/${c.id}`, { status: s });
    load();
  };

  const copyAll = () => {
    navigator.clipboard.writeText(newCodes.join('\n'));
    toast('已复制全部卡密');
  };

  return (
    <div>
      <div className="page-head">
        <h1>卡密管理</h1>
        <button className="btn btn-primary" onClick={() => setShowGen(true)}>生成卡密</button>
      </div>

      {newCodes.length > 0 && (
        <div className="card" style={{ border: '1px solid #bbf7d0', background: '#f0fdf4' }}>
          <h2>新卡密（请立即保存，仅显示一次）</h2>
          <textarea readOnly value={newCodes.join('\n')} rows={Math.min(newCodes.length, 10)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={copyAll}>复制全部</button>
            <button className="btn" style={{ marginLeft: 8 }} onClick={() => setNewCodes([])}>关闭</button>
          </div>
        </div>
      )}

      {showGen && (
        <div className="card">
          <h2>生成卡密</h2>
          <div className="grid-2" style={{ marginBottom: 4 }}>
            <div className="field"><label>数量</label><input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value))} /></div>
            <div className="field"><label>单张额度 (USD)</label><input type="number" step="0.01" min={0.01} value={credit} onChange={(e) => setCredit(Number(e.target.value))} /></div>
          </div>
          <div className="field"><label>批次名（可选）</label><input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="如 2026-06 批" /></div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setShowGen(false)}>取消</button>
            <button className="btn btn-primary" onClick={gen}>生成</button>
          </div>
        </div>
      )}

      <div className="card">
        {cards.length === 0 ? <div className="empty">暂无卡密。右上角生成后可发卡给用户。</div> : (
          <table className="data">
            <thead><tr><th>ID</th><th>卡密</th><th>额度</th><th>批次</th><th>状态</th><th>使用者</th><th>使用时间</th><th>创建</th><th>操作</th></tr></thead>
            <tbody>{cards.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td className="mono">{c.code}</td>
                <td>{fmtMoney(c.credit)}</td>
                <td>{c.batch || '-'}</td>
                <td><StatusBadge status={c.status} /></td>
                <td>{c.used_email || '-'}</td>
                <td>{c.used_at ? fmtTime(c.used_at) : '-'}</td>
                <td>{fmtTime(c.created_at)}</td>
                <td>{c.status !== 'used' && <button className="btn btn-sm" onClick={() => toggle(c)}>{c.status === 'unused' ? '禁用' : '启用'}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
