import { useEffect, useMemo, useRef, useState } from 'react';
import { formatAccelerator, normalizeAccelerator } from '../../../shared/accelerator';
import type { AppConfig, DeckItem } from '../../../shared/types';

type SettingsTab = 'general' | 'appearance' | 'behavior' | 'shortcut' | 'about';

interface SettingsModalProps {
  open: boolean;
  config: AppConfig;
  onClose: () => void;
}

interface HotkeyRow {
  path: string[];
  item: Extract<DeckItem, { kind: 'action' }>;
}

function collectHotkeys(items: readonly DeckItem[], path: readonly string[] = []): HotkeyRow[] {
  const rows: HotkeyRow[] = [];
  for (const item of items) {
    if (item.kind === 'folder') rows.push(...collectHotkeys(item.children, [...path, item.id]));
    else if (item.globalHotkey) rows.push({ path: [...path], item });
  }
  return rows;
}

export function SettingsModal({ open, config, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const [info, setInfo] = useState<{ version: string; platform: string; isPackaged: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [failedNumbers, setFailedNumbers] = useState<string[]>([]);
  const [hotkeyStatuses, setHotkeyStatuses] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const hotkeys = useMemo(() => collectHotkeys(config.root), [config.root]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all(
      hotkeys.map(async ({ item }) => ({
        id: item.id,
        result: await window.api.hotkey.validate({
          accelerator: item.globalHotkey!,
          itemId: item.id,
        }),
      })),
    ).then((results) => {
      if (!active) return;
      setHotkeyStatuses(
        Object.fromEntries(
          results.map(({ id, result }) => [id, result.ok ? '등록됨' : result.reason]),
        ),
      );
    });
    if (config.keyboard.globalNumberHotkeys) {
      void Promise.all(
        Array.from({ length: 10 }, async (_, index) => {
          const key = index === 9 ? '0' : String(index + 1);
          const result = await window.api.hotkey.validate({
            accelerator: `${config.keyboard.globalNumberModifier}+${key}`,
          });
          return result.ok ? null : key;
        }),
      ).then((results) => {
        if (active) setFailedNumbers(results.filter((key): key is string => key !== null));
      });
    }
    return () => {
      active = false;
    };
  }, [config.keyboard.globalNumberHotkeys, config.keyboard.globalNumberModifier, hotkeys, open]);

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
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, [tabindex]:not([tabindex="-1"])',
        ),
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
  useEffect(
    () =>
      window.api.on('update:status', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const status = payload as {
          state?: string;
          version?: string;
          message?: string;
          progress?: number;
        };
        if (status.state === 'downloaded' && status.version) setUpdateReady(status.version);
        if (status.message) setMessage(status.message);
        else if (status.state === 'downloading' && status.progress !== undefined) {
          setMessage(`업데이트를 ${Math.round(status.progress)}퍼센트 내려받았습니다.`);
        }
      }),
    [],
  );

  if (!open) return null;
  const setConfig = (patch: Partial<AppConfig>) => {
    void window.api.config.set(patch).catch((error) => {
      setMessage(error instanceof Error ? error.message : '설정을 바꾸지 못했습니다. 입력값을 확인해 주세요.');
    });
  };
  const setBehavior = (patch: Partial<AppConfig['behavior']>) => {
    setConfig({ behavior: { ...config.behavior, ...patch } });
  };
  const setKeyboard = (patch: Partial<AppConfig['keyboard']>) => {
    setConfig({ keyboard: { ...config.keyboard, ...patch } });
  };
  const updateGrid = (patch: Partial<AppConfig['grid']>) => {
    const next = { ...config.grid, ...patch };
    const nextCapacity = next.cols * next.rows;
    const moved = config.root.filter((item) => item.position >= nextCapacity).length;
    if (nextCapacity < config.grid.cols * config.grid.rows) {
      setMessage(moved ? `${moved}개 항목이 다음 페이지로 이동합니다.` : null);
    }
    setConfig({ grid: next });
    void window.api.window.relayout();
  };
  const captureHotkey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    const modifiers = [
      event.ctrlKey || event.metaKey ? 'CommandOrControl' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    if (!modifiers.length) {
      setMessage('수식키와 일반 키를 함께 눌러 주세요.');
      return;
    }
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    setConfig({ hotkey: normalizeAccelerator([...modifiers, key].join('+')) });
    setMessage('단축키 등록 결과를 확인하는 중입니다. 충돌하면 이전 값으로 돌아갑니다.');
  };
  const toggleNumberHotkeys = async (enabled: boolean) => {
    if (!enabled) {
      setFailedNumbers([]);
      setKeyboard({ globalNumberHotkeys: false });
      return;
    }
    const failures: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const key = index === 9 ? '0' : String(index + 1);
      const accelerator = `${config.keyboard.globalNumberModifier}+${key}`;
      const result = await window.api.hotkey.validate({ accelerator });
      if (!result.ok) failures.push(key);
    }
    setFailedNumbers(failures);
    setKeyboard({ globalNumberHotkeys: true });
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
              ['behavior', '동작'],
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
                  <input type="checkbox" checked={config.launchAtLogin} disabled={!info?.isPackaged} onChange={(event) => setConfig({ launchAtLogin: event.target.checked })} />
                  로그인 시 자동 시작
                </label>
                <label><input type="checkbox" checked={config.window.hideOnLaunch} onChange={(event) => setConfig({ window: { ...config.window, hideOnLaunch: event.target.checked } })} />시작 시 패널 숨기기</label>
                <label><input type="checkbox" checked={config.autoUpdate} onChange={(event) => setConfig({ autoUpdate: event.target.checked })} />자동 업데이트 확인</label>
                <button className="reset-settings" type="button" onClick={() => {
                  if (!window.confirm('모든 키와 설정을 기본값으로 되돌릴까요?')) return;
                  if (!window.confirm('이 작업은 되돌릴 수 없습니다. 정말 초기화할까요?')) return;
                  void window.api.config.reset();
                  onClose();
                }}>설정 초기화</button>
              </>
            )}
            {tab === 'appearance' && (
              <>
                <label>테마<select value={config.theme} onChange={(event) => setConfig({ theme: event.target.value as AppConfig['theme'] })}><option value="system">시스템</option><option value="light">라이트</option><option value="dark">다크</option></select></label>
                <label>열 {config.grid.cols}<input type="range" min="2" max="8" value={config.grid.cols} onChange={(event) => updateGrid({ cols: Number(event.target.value) })} /></label>
                <label>행 {config.grid.rows}<input type="range" min="1" max="6" value={config.grid.rows} onChange={(event) => updateGrid({ rows: Number(event.target.value) })} /></label>
                <label>버튼 크기 {config.grid.buttonSize}<input type="range" min="64" max="140" value={config.grid.buttonSize} onChange={(event) => updateGrid({ buttonSize: Number(event.target.value) })} /></label>
                <label>투명도 {Math.round(config.window.opacity * 100)}퍼센트<input type="range" min="0.3" max="1" step="0.05" value={config.window.opacity} onChange={(event) => setConfig({ window: { ...config.window, opacity: Number(event.target.value) } })} /></label>
                <label><input type="checkbox" checked={config.window.alwaysOnTop} onChange={(event) => setConfig({ window: { ...config.window, alwaysOnTop: event.target.checked } })} />항상 최상위</label>
              </>
            )}
            {tab === 'behavior' && (
              <>
                <label><input type="checkbox" checked={config.behavior.hideAfterLaunch} onChange={(event) => setBehavior({ hideAfterLaunch: event.target.checked })} />실행 후 패널 숨기기</label>
                <label>숨김 대기 {config.behavior.hideAfterLaunchDelayMs}밀리초<input type="range" min="0" max="600" step="20" value={config.behavior.hideAfterLaunchDelayMs} onChange={(event) => setBehavior({ hideAfterLaunchDelayMs: Number(event.target.value) })} /></label>
                <label><input type="checkbox" checked={config.behavior.edgePeek} onChange={(event) => setBehavior({ edgePeek: event.target.checked })} />가장자리에 마우스를 대면 다시 열기</label>
                <label>가장자리<select value={config.behavior.peekEdge} onChange={(event) => setBehavior({ peekEdge: event.target.value as AppConfig['behavior']['peekEdge'] })}><option value="auto">패널 위치에서 자동 선택</option><option value="right">오른쪽</option><option value="left">왼쪽</option><option value="top">위쪽</option><option value="bottom">아래쪽</option></select></label>
                <label>띠 두께 {config.behavior.peekThickness}픽셀<input type="range" min="4" max="12" value={config.behavior.peekThickness} onChange={(event) => setBehavior({ peekThickness: Number(event.target.value) })} /></label>
                <label>열기 대기 {config.behavior.peekDelayMs}밀리초<input type="range" min="0" max="600" step="20" value={config.behavior.peekDelayMs} onChange={(event) => setBehavior({ peekDelayMs: Number(event.target.value) })} /></label>
                <label><input type="checkbox" checked={config.behavior.idleFade} onChange={(event) => setBehavior({ idleFade: event.target.checked })} />가만히 두면 흐려지고 클릭 통과</label>
                <label>흐려질 때까지 {config.behavior.idleFadeAfterMs / 1000}초<input type="range" min="1000" max="15000" step="500" value={config.behavior.idleFadeAfterMs} onChange={(event) => setBehavior({ idleFadeAfterMs: Number(event.target.value) })} /></label>
                <label>흐린 투명도 {Math.round(config.behavior.idleOpacity * 100)}퍼센트<input type="range" min="0.1" max="0.9" step="0.05" value={config.behavior.idleOpacity} onChange={(event) => setBehavior({ idleOpacity: Number(event.target.value) })} /></label>
              </>
            )}
            {tab === 'shortcut' && (
              <>
                <label className="settings-field-column">패널 표시와 숨김<input className="hotkey-input" value={formatAccelerator(config.hotkey, config.platform)} readOnly onKeyDown={captureHotkey} aria-label="전역 단축키 입력" /><small>입력 칸을 누른 뒤 원하는 키 조합을 누르세요.</small></label>
                <label>힌트 배지<select value={config.keyboard.quickHints} onChange={(event) => setKeyboard({ quickHints: event.target.value as AppConfig['keyboard']['quickHints'] })}><option value="on-focus">패널에 초점이 있을 때</option><option value="always">항상 표시</option><option value="never">숨김</option></select></label>
                <label><input type="checkbox" checked={config.keyboard.hideAfterHotkeyLaunch} onChange={(event) => setKeyboard({ hideAfterHotkeyLaunch: event.target.checked })} />힌트 키 실행 후 패널 숨기기</label>
                <label>힌트 문자<input value={config.keyboard.hintKeys} onChange={(event) => setKeyboard({ hintKeys: event.target.value })} /></label>
                <label><input type="checkbox" checked={config.keyboard.globalNumberHotkeys} onChange={(event) => void toggleNumberHotkeys(event.target.checked)} />전역 숫자 단축키</label>
                <label>숫자 수식키<select value={config.keyboard.globalNumberModifier} onChange={(event) => setKeyboard({ globalNumberModifier: event.target.value })}><option value="CommandOrControl+Alt">기본 수식키와 Alt</option><option value="CommandOrControl+Shift">기본 수식키와 Shift</option><option value="Alt+Shift">Alt와 Shift</option><option value="Super+Alt">운영체제 키와 Alt</option></select></label>
                <small>전역 숫자는 현재 패널에서 보고 있는 페이지의 앞쪽 열 개 키에 연결됩니다.</small>
                {failedNumbers.length > 0 && <p className="field-error">등록하지 못한 번호: {failedNumbers.join(', ')}</p>}
                <h3>키별 전역 단축키</h3>
                {hotkeys.length === 0 ? <p className="empty-hotkeys">등록된 키별 단축키가 없습니다.</p> : (
                  <table className="hotkey-table"><thead><tr><th>키</th><th>단축키</th><th>상태</th><th></th></tr></thead><tbody>{hotkeys.map(({ path, item }) => { const status = hotkeyStatuses[item.id] ?? '확인 중'; const ok = status === '등록됨'; return <tr key={item.id}><td>{item.label}</td><td>{formatAccelerator(item.globalHotkey!, config.platform)}</td><td><span className={ok ? 'hotkey-ok' : 'field-error'}>{status}</span></td><td><button type="button" onClick={() => void window.api.deck.upsert({ path, item: { ...item, globalHotkey: undefined } })}>해제</button></td></tr>; })}</tbody></table>
                )}
              </>
            )}
            {tab === 'about' && (
              <>
                <p>Stream Panel v{info?.version ?? '1.0.0'}</p><p>공개 저장소: github.com/deepsky616/stream-panel</p><p>라이선스: MIT</p>
                {updateReady && <p className="update-ready">앱을 다시 시작하면 v{updateReady} 업데이트가 적용됩니다.</p>}
                <button type="button" onClick={() => void window.api.update.check().then((result) => setMessage(result.status)).catch(() => setMessage('개발 모드에서는 업데이트를 확인하지 않습니다.'))}>업데이트 확인</button>
              </>
            )}
            {message && <p className="settings-message" role="status">{message}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
