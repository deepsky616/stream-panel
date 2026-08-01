import { useEffect, useRef, useState } from 'react';
import type { AppConfig } from '../../../shared/types';

type SettingsTab = 'general' | 'appearance' | 'shortcut' | 'about';

interface SettingsModalProps {
  open: boolean;
  config: AppConfig;
  onClose: () => void;
}

export function SettingsModal({ open, config, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const [info, setInfo] = useState<{ version: string; platform: string; isPackaged: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void window.api.app.info().then((value) => active && setInfo(value));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('button')?.focus());
    return () => {
      active = false;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);
  useEffect(() => window.api.on('update:status', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const status = payload as { state?: string; version?: string; message?: string; progress?: number };
    if (status.state === 'downloaded' && status.version) setUpdateReady(status.version);
    if (status.message) setMessage(status.message);
    else if (status.state === 'downloading' && status.progress !== undefined) {
      setMessage(`업데이트를 ${Math.round(status.progress)}퍼센트 내려받았습니다.`);
    }
  }), []);

  if (!open) return null;
  const setConfig = (patch: Partial<AppConfig>) => {
    void window.api.config.set(patch).catch((error) => {
      setMessage(error instanceof Error ? error.message : '설정을 바꾸지 못했습니다.');
    });
  };
  const updateGrid = (patch: Partial<AppConfig['grid']>) => {
    const next = { ...config.grid, ...patch };
    const oldCapacity = config.grid.cols * config.grid.rows;
    const nextCapacity = next.cols * next.rows;
    if (nextCapacity < oldCapacity) {
      const moved = config.root.filter((item) => item.position >= nextCapacity).length;
      setMessage(moved ? `${moved}개 항목이 다음 페이지로 이동합니다.` : null);
    }
    setConfig({ grid: next });
    void window.api.window.relayout();
  };
  const captureHotkey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    const modifiers = [
      event.ctrlKey ? 'Control' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
      event.metaKey ? 'Command' : '',
    ].filter(Boolean);
    if (!modifiers.length) {
      setMessage('수정 키와 일반 키를 함께 눌러 주세요.');
      return;
    }
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    setConfig({ hotkey: [...modifiers, key].join('+') });
    setMessage('단축키 등록 결과를 확인하는 중입니다.');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="settings-modal" role="dialog" aria-modal="true" aria-label="설정">
        <header>
          <h2>설정</h2>
          <button type="button" onClick={onClose} aria-label="설정 닫기">✕</button>
        </header>
        <div className="settings-body">
          <nav className="settings-tabs" aria-label="설정 항목">
            {([
              ['general', '일반'],
              ['appearance', '모양'],
              ['shortcut', '단축키'],
              ['about', '정보'],
            ] as Array<[SettingsTab, string]>).map(([value, label]) => (
              <button
                key={value}
                className={tab === value ? 'active' : ''}
                type="button"
                onClick={() => { setTab(value); setMessage(null); }}
              >
                {label}
              </button>
            ))}
          </nav>
          <section className="settings-content">
            {tab === 'general' && (
              <>
                <label title={!info?.isPackaged ? '설치 후 사용 가능' : undefined}>
                  <input
                    type="checkbox"
                    checked={config.launchAtLogin}
                    disabled={!info?.isPackaged}
                    onChange={(event) => setConfig({ launchAtLogin: event.target.checked })}
                  />
                  로그인 시 자동 시작
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.window.hideOnLaunch}
                    onChange={(event) => setConfig({ window: { ...config.window, hideOnLaunch: event.target.checked } })}
                  />
                  시작 시 패널 숨기기
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={config.autoUpdate}
                    onChange={(event) => setConfig({ autoUpdate: event.target.checked })}
                  />
                  자동 업데이트 확인
                </label>
                <button
                  className="reset-settings"
                  type="button"
                  onClick={() => {
                    if (!window.confirm('모든 키와 설정을 기본값으로 되돌릴까요?')) return;
                    if (!window.confirm('이 작업은 되돌릴 수 없습니다. 정말 초기화할까요?')) return;
                    void window.api.config.reset();
                    onClose();
                  }}
                >
                  설정 초기화
                </button>
              </>
            )}
            {tab === 'appearance' && (
              <>
                <label>
                  테마
                  <select value={config.theme} onChange={(event) => setConfig({ theme: event.target.value as AppConfig['theme'] })}>
                    <option value="system">시스템</option>
                    <option value="light">라이트</option>
                    <option value="dark">다크</option>
                  </select>
                </label>
                <label>열 {config.grid.cols}<input type="range" min="2" max="8" value={config.grid.cols} onChange={(event) => updateGrid({ cols: Number(event.target.value) })} /></label>
                <label>행 {config.grid.rows}<input type="range" min="1" max="6" value={config.grid.rows} onChange={(event) => updateGrid({ rows: Number(event.target.value) })} /></label>
                <label>버튼 크기 {config.grid.buttonSize}<input type="range" min="64" max="140" value={config.grid.buttonSize} onChange={(event) => updateGrid({ buttonSize: Number(event.target.value) })} /></label>
                <label>투명도 {Math.round(config.window.opacity * 100)}퍼센트<input type="range" min="0.3" max="1" step="0.05" value={config.window.opacity} onChange={(event) => setConfig({ window: { ...config.window, opacity: Number(event.target.value) } })} /></label>
                <label><input type="checkbox" checked={config.window.alwaysOnTop} onChange={(event) => setConfig({ window: { ...config.window, alwaysOnTop: event.target.checked } })} />항상 최상위</label>
              </>
            )}
            {tab === 'shortcut' && (
              <label>
                패널 표시와 숨김
                <input className="hotkey-input" value={config.hotkey} readOnly onKeyDown={captureHotkey} aria-label="전역 단축키 입력" />
                <small>입력 칸을 누른 뒤 원하는 키 조합을 누르세요.</small>
              </label>
            )}
            {tab === 'about' && (
              <>
                <p>Stream Panel v{info?.version ?? '1.0.0'}</p>
                <p>공개 저장소: github.com/deepsky616/stream-panel</p>
                <p>라이선스: MIT</p>
                {updateReady && <p className="update-ready">앱을 다시 시작하면 v{updateReady} 업데이트가 적용됩니다.</p>}
                <button
                  type="button"
                  onClick={() => void window.api.update.check().then((result) => setMessage(result.status)).catch(() => setMessage('개발 모드에서는 업데이트를 확인하지 않습니다.'))}
                >
                  업데이트 확인
                </button>
              </>
            )}
            {message && <p className="settings-message" role="status">{message}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
