import { useState, useRef, useEffect } from 'react';
import { api } from '../api';
import { useToast } from './ui';
import { PaperPlaneRight, Sliders, X, Image as ImageIcon, Trash } from '@phosphor-icons/react';

// 消息支持纯文本或带图片的 content（OpenAI 多模态数组）
interface ContentPart { type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }
interface Msg { role: 'user' | 'assistant'; parts: ContentPart[]; images?: string[] }
interface ApiKeyItem { id: number; name: string; key_prefix: string; key_tail: string; model_whitelist?: string[] | null }

const SUPPLIERS: { label: string; url: string }[] = [
  { label: '本中转站（留空）', url: '' },
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'Anthropic', url: 'https://api.anthropic.com/v1' },
  { label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { label: 'Gemini', url: 'https://generativelanguage.googleapis.com/v1beta' },
  { label: 'Kimi (Moonshot)', url: 'https://api.moonshot.cn/v1' },
  { label: '智谱 (GLM)', url: 'https://open.bigmodel.cn/api/paas/v4' },
  { label: 'Grok (xAI)', url: 'https://api.x.ai/v1' },
  { label: 'MiniMax', url: 'https://api.minimax.chat/v1' },
  { label: '自建中转', url: 'https://api.shuzhan.one/v1' },
];

function partsToContent(parts: ContentPart[]): string | ContentPart[] {
  // 纯文本：简化成 string；含图片：用数组
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text || '').join('');
  return parts;
}

export default function TestApiDialog({ onClose, keys }: { onClose: () => void; keys?: ApiKeyItem[] }) {
  const [cfgOpen, setCfgOpen] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [models, setModels] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    (async () => { try { const m = await api.get<any>('/api/v1/public/models'); const list: string[] = ((m?.prices || []) as any[]).map((p) => String(p.model)); const stems: string[] = [...new Set(list.map((x) => x.replace(/\*$/, '')))]; setModels(stems); } catch {} })();
  }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);

  const addImage = (file: File) => {
    if (!file.type.startsWith('image/')) return toast('请选择图片文件', 'err');
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      // 已有的文本部分作为 text part，图片作为 image_url part
      setMsgs((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        // 若最后一条是用户消息，追加图片到它；否则新建一个用户消息
        if (last && last.role === 'user' && !last.images?.includes(url)) {
          copy[copy.length - 1] = { role: 'user', parts: [...last.parts, { type: 'image_url', image_url: { url } }] };
        } else {
          copy.push({ role: 'user', parts: [{ type: 'image_url', image_url: { url } }] });
        }
        return copy;
      });
      toast('图片已添加');
    };
    reader.readAsDataURL(file);
  };

  const send = async () => {
    const text = input.trim();
    const hasPendingImage = msgs.length > 0 && msgs[msgs.length - 1].role === 'user';
    if (!text && !hasPendingImage) return;
    // 未填 Key 时，若用本平台（base_url 留空）且用户已有 Key，自动取第一个可用的
    let useKey = apiKey.trim();
    if (!useKey && !baseUrl.trim() && keys && keys.length > 0) {
      try {
        const first = keys[0];
        const r = await api.get<any>(`/api/v1/me/api-keys/${first.id}/reveal`);
        if (r.api_key) { useKey = r.api_key; setApiKey(r.api_key); toast('已自动使用你的第一个 API Key'); }
      } catch { /* 无保存明文则忽略 */ }
    }
    if (!useKey) return toast('请填写 API Key（可在「我的 API Key」页生成）', 'err');
    let userMsg: Msg;
    if (hasPendingImage && msgs[msgs.length - 1].role === 'user') {
      // 把输入文本并入最后一条用户图片消息，或新建
      const last = msgs[msgs.length - 1];
      userMsg = text ? { role: 'user', parts: [...last.parts, { type: 'text', text }] } : last;
      setMsgs([...msgs.slice(0, -1), userMsg]);
    } else {
      userMsg = { role: 'user', parts: [{ type: 'text', text }] };
      setMsgs([...msgs, userMsg]);
    }
    setInput(''); setError(''); setBusy(true);
    const history = [...msgs.slice(0, -1), userMsg];
    try {
      const r = await api.post<any>('/api/v1/debug/test-key', {
        base_url: baseUrl || undefined, api_key: useKey, model: model || undefined,
        messages: history.map((m) => ({ role: m.role, content: partsToContent(m.parts) })),
      });
      if (r.ok) {
        const parts: ContentPart[] = [{ type: 'text', text: r.reply || '(模型未返回内容)' }];
        if (Array.isArray(r.images) && r.images.length) parts.push(...r.images.map((u: string) => ({ type: 'image_url', image_url: { url: u } })));
        setMsgs((m) => [...m, { role: 'assistant', parts, images: r.images }]);
      } else {
        setError(`连接失败（HTTP ${r.status ?? '-'}）：${r.error || r.note || '未知错误'}`);
      }
    } catch (ex: any) {
      setError(ex?.message || '发送失败');
    }
    setBusy(false);
  };

  const removeImageAt = (msgIdx: number, imgIdx: number) => {
    setMsgs((m) => m.map((mm, i) => {
      if (i !== msgIdx) return mm;
      const parts = mm.parts.filter((p, j) => !(p.type === 'image_url' && j === imgIdx));
      return { ...mm, parts };
    }));
  };

  const renderContent = (m: Msg) => {
    const text = m.parts.filter((p) => p.type === 'text' && p.text).map((p) => p.text).join('');
    const imgs = m.parts.filter((p) => p.type === 'image_url' && p.image_url?.url).map((p) => p.image_url!.url);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {text && <span style={{ wordBreak: 'break-word' }}>{text}</span>}
        {imgs.map((u, i) => <img key={i} src={u} alt="img" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 10, objectFit: 'cover' }} />)}
      </div>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20, backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 560, height: '82dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px -12px rgba(0,0,0,0.2)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontWeight: 700, color: '#1f2937', fontSize: 15 }}>测试 API · 对话（支持图片）</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setCfgOpen((v) => !v)} style={hbtn}><Sliders size={14} />配置</button>
            <button onClick={onClose} style={hbtn}><X size={16} /></button>
          </div>
        </div>

        {cfgOpen && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
            <div style={{ fontSize: 12, color: '#78716c', marginBottom: 8 }}>API 配置（留空 base_url 用本平台）</div>
            {keys && keys.length > 0 && (
              <select value="" onChange={async (e) => { const k = keys.find((x) => String(x.id) === e.target.value); if (k) { try { const r = await api.get<any>(`/api/v1/me/api-keys/${k.id}/reveal`); if (r.api_key) { setApiKey(r.api_key); toast('已自动填充该 Key'); } else { toast('该 Key 未保存明文，请手动粘贴', 'err'); } } catch { toast('该 Key 为旧版创建、无保存明文，请重建或手动粘贴完整 Key', 'err'); } } }} style={inp}>
                <option value="">选择已有 Key（自动填充）</option>
                {keys.map((k) => <option key={k.id} value={k.id}>{k.name} · {k.key_prefix}…{k.key_tail}</option>)}
              </select>
            )}
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key * (sk-...)" style={inp} />
            <select value={model} onChange={(e) => setModel(e.target.value)} style={inp}>
              {models.length === 0 ? <option value={model}>{model}</option> : models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value="" onChange={(e) => { const s = SUPPLIERS.find((x) => x.label === e.target.value); if (s) setBaseUrl(s.url); }} style={inp}>
              <option value="">选择供应商（自动填充 Base URL）</option>
              {SUPPLIERS.map((s) => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL（留空用本平台，或选供应商自动填充）" style={{ ...inp, marginBottom: 0 }} />
          </div>
        )}

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fafafa' }}>
          {msgs.length === 0 && !busy && (
            <div style={{ margin: 'auto', textAlign: 'center', color: '#a8a29e', fontSize: 13 }}>
              输入消息或上传图片开始对话，即可测试 API 连通性。<br />支持图片多模态（如 gpt-4o、claude-3-vision 等）。<br />模型回复中的图片也会显示在气泡中。
            </div>
          )}
          {busy && <div style={{ textAlign: 'center', color: '#78716c', fontSize: 12, padding: 6 }}>模型响应中…</div>}
          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '78%', padding: '10px 14px', borderRadius: 14, lineHeight: 1.6, fontSize: 13.5, background: m.role === 'user' ? '#f97316' : '#fff', color: m.role === 'user' ? '#fff' : '#1f2937', border: m.role === 'user' ? 'none' : '1px solid #e5e5e5' }}>
                {renderContent(m)}
              </div>
            </div>
          ))}
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '8px 12px', borderRadius: 10, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 10, alignItems: 'flex-end', background: '#fff' }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} title="上传图片" style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e5e5', cursor: 'pointer' }}><ImageIcon size={17} /></button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="输入消息，Enter 发送…"
            rows={2}
            style={{ flex: 1, resize: 'none', padding: '10px 12px', borderRadius: 12, border: '1px solid #e5e5e5', fontSize: 13.5, fontFamily: 'inherit', outline: 'none' }}
          />
          <button onClick={send} disabled={busy} style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: busy ? '#d4d4d4' : '#f97316', color: '#fff', border: 'none', cursor: busy ? 'not-allowed' : 'pointer' }}><PaperPlaneRight size={17} /></button>
        </div>
      </div>
    </div>
  );
}

const hbtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #e5e5e5', background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, color: '#4b5563', cursor: 'pointer' };
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 9, border: '1px solid #e5e5e5', fontSize: 13, marginBottom: 6, boxSizing: 'border-box', fontFamily: 'inherit' };
