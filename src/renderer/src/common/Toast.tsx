import { useEffect, useState } from 'react';

interface ToastPayload {
  level: 'info' | 'error';
  message: string;
}

function isToast(payload: unknown): payload is ToastPayload {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as Partial<ToastPayload>;
  return (
    (candidate.level === 'info' || candidate.level === 'error') &&
    typeof candidate.message === 'string'
  );
}

export function Toast() {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return window.api.on('toast', (payload) => {
      if (!isToast(payload)) return;
      setToast(payload);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 5000);
    });
  }, []);
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.level}`} role="status" aria-live="polite">
      <span>{toast.message}</span>
      <button type="button" onClick={() => setToast(null)} aria-label="알림 닫기">
        ✕
      </button>
    </div>
  );
}
