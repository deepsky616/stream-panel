import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppConfig } from '../../shared/types';
import './styles/theme.css';
import './styles/peek.css';

export function PeekStrip() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void window.api.config.get().then((value) => active && setConfig(value));
    const unsubscribe = window.api.on('config:changed', (payload) => {
      if (payload && typeof payload === 'object') setConfig(payload as AppConfig);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const enter = () => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      void window.api.window.show();
    }, config?.behavior.peekDelayMs ?? 220);
  };

  return (
    <main
      className={`peek-strip theme-${config?.theme ?? 'system'}`}
      onMouseEnter={enter}
      onMouseLeave={cancel}
      aria-label="Stream Panel 열기"
    >
      <span aria-hidden="true">‹</span>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PeekStrip />
  </StrictMode>,
);
