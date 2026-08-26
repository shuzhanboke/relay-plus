import { createContext, useContext, useState, type ReactNode } from 'react';

const ToastCtx = createContext<(msg: string, type?: 'ok' | 'err') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const [type, setType] = useState<'ok' | 'err'>('ok');
  const show = (msg: string, t: 'ok' | 'err' = 'ok') => {
    setToast(msg); setType(t);
    setTimeout(() => setToast(null), 2600);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={type === 'err' ? 'toast toast-err' : 'toast toast-ok'}>{toast}</div>}
    </ToastCtx.Provider>
  );
}

export function useToast() { return useContext(ToastCtx); }

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'badge badge-green', disabled: 'badge badge-red', paused: 'badge badge-yellow',
    expired: 'badge badge-gray', success: 'badge badge-green',
  };
  const cls = map[status] || 'badge badge-gray';
  const label = status === 'active' ? '正常' : status === 'disabled' ? '已禁用' : status === 'paused' ? '已暂停' : status === 'expired' ? '已过期' : status === 'success' ? '成功' : status;
  return <span className={cls}>{label}</span>;
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function fmtNum(n: number | string | null | undefined): string {
  const num = typeof n === 'string' ? Number(n) : n;
  if (num === null || num === undefined || Number.isNaN(num)) return '-';
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function fmtMoney(n: number | string | null | undefined): string {
  const num = typeof n === 'string' ? Number(n) : n;
  if (num === null || num === undefined || Number.isNaN(num)) return '-';
  return `$${num.toFixed(6)}`;
}

export function fmtTime(ts: string | null | undefined): string {
  if (!ts) return '-';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
}
