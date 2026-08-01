import { useEffect, useState } from 'react';
import type { AppConfig } from '../../../shared/types';

interface TitleBarProps {
  config: AppConfig;
}

export function TitleBar({ config }: TitleBarProps) {
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => window.api.on('update:status', (payload) => {
    if (payload && typeof payload === 'object' && 'state' in payload) {
      setUpdateReady((payload as { state: string }).state === 'downloaded');
    }
  }), []);
  const toggleLock = () => {
    void window.api.config.set({ window: { ...config.window, locked: !config.window.locked } });
  };
  return (
    <header className={`titlebar ${config.window.locked ? 'locked' : ''}`}>
      <span className="drag-mark" aria-hidden="true">
        ⠿
      </span>
      <strong>Stream Panel</strong>
      <div className="title-actions">
        <button type="button" onClick={toggleLock} aria-label={config.window.locked ? '잠금 해제' : '잠금'}>
          {config.window.locked ? '🔒' : '🔓'}
        </button>
        <button className="editor-title-button" type="button" onClick={() => void window.api.editor.open()} aria-label="편집기 열기">
          ⚙
          {updateReady && <span className="update-dot" aria-label="업데이트 준비됨" />}
        </button>
        <button
          type="button"
          title="숨기기 (Ctrl+Alt+D로 다시 열기)"
          onClick={() => void window.api.window.hide()}
          aria-label="패널 숨기기"
        >
          ✕
        </button>
      </div>
    </header>
  );
}
