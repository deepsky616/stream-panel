import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatAccelerator,
  formatNumberModifier,
  normalizeAccelerator,
} from '../../../shared/accelerator';
import { searchDeckItems } from '../../../shared/search';
import { EDUCATION_OFFICES } from '../../../shared/educationOffices';
import type {
  AppConfig,
  ApprovalMonitorStatus,
  DeckItem,
  EducationOfficeCode,
  LibraryEntry,
  WebConnectorBrowserId,
  WebConnectorStatus,
  WebWorkflowSystem,
} from '../../../shared/types';
import { createApprovalInboxTemplate } from '../../../shared/webWorkflows';
import {
  createEducationOfficePatch,
  createWebWorkBrowserCards,
  shouldShowWebWorkSettings,
} from './webWorkViewModel';
import { CustomWebWorkflowBuilder } from './CustomWebWorkflowBuilder';
import { ApprovalMonitorSettings } from './ApprovalMonitorSettings';
import {
  createConfigWriteQueue,
  type ConfigPatchFactory,
} from './configWriteQueue';

type SettingsTab = 'general' | 'appearance' | 'behavior' | 'shortcut' | 'web-work' | 'about';

interface SettingsModalProps {
  open: boolean;
  config: AppConfig;
  onClose: () => void;
  onAddWebWorkflow: (entry: LibraryEntry) => Promise<void>;
  initialTab?: SettingsTab;
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

export function SettingsModal({
  open,
  config,
  onClose,
  onAddWebWorkflow,
  initialTab = 'general',
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [info, setInfo] = useState<{ version: string; platform: string; isPackaged: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [failedNumbers, setFailedNumbers] = useState<string[]>([]);
  const [hotkeyStatuses, setHotkeyStatuses] = useState<Record<string, string>>({});
  const [connectorStatuses, setConnectorStatuses] = useState<WebConnectorStatus[]>([]);
  const [connectorBusy, setConnectorBusy] = useState<WebConnectorBrowserId | null>(null);
  const [connectorError, setConnectorError] = useState<WebConnectorBrowserId | null>(null);
  const [approvalStatuses, setApprovalStatuses] = useState<ApprovalMonitorStatus[]>([]);
  const [approvalBusy, setApprovalBusy] = useState<WebWorkflowSystem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [configWriteQueue] = useState(() => createConfigWriteQueue({
    initial: config,
    write: (patch) => window.api.config.set(patch),
  }));
  const hotkeys = useMemo(() => collectHotkeys(config.root), [config.root]);
  const numberPreview = useMemo(() => {
    const mapped = new Map(
      searchDeckItems(config.root, '', config.grid).map((result) => [result.hint, result]),
    );
    return Array.from({ length: 10 }, (_, index) => {
      const key = index === 9 ? '0' : String(index + 1);
      const rootItem = config.root.find((item) => item.position === index);
      return {
        key,
        ordinal: index + 1,
        label: mapped.get(key)?.label ??
          (rootItem?.kind === 'folder'
            ? `${rootItem.label} — 실행용 폴더가 아님`
            : rootItem
              ? `${rootItem.label} — 현재 맨 앞 화면 밖`
              : '연결된 항목 없음'),
        active: mapped.has(key),
      };
    });
  }, [config.grid, config.root]);
  const connectorCards = useMemo(
    () => createWebWorkBrowserCards(connectorStatuses, connectorBusy, connectorError),
    [connectorBusy, connectorError, connectorStatuses],
  );

  useEffect(() => configWriteQueue.updateBase(config), [config, configWriteQueue]);

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

  const refreshConnectorStatuses = useCallback(() =>
    window.api.webConnector.status().then(setConnectorStatuses).catch(() => {
      setConnectorStatuses([]);
      setMessage('웹 업무 연결 상태를 읽지 못했습니다. 스트림 패널을 다시 시작해 주세요.');
    }), []);
  const refreshApprovalStatuses = useCallback(() =>
    window.api.approvalMonitor.status().then(setApprovalStatuses).catch(() => {
      setApprovalStatuses([]);
      setMessage('결재 대기 알림 상태를 읽지 못했습니다. 스트림 패널을 다시 시작해 주세요.');
    }), []);

  useEffect(() => {
    if (!open || config.platform !== 'win32' || tab !== 'web-work') return;
    void refreshConnectorStatuses();
    void refreshApprovalStatuses();
  }, [config.platform, open, refreshApprovalStatuses, refreshConnectorStatuses, tab]);

  useEffect(() => window.api.on('web-approval:changed', (payload) => {
    if (!Array.isArray(payload)) return;
    setApprovalStatuses(payload as ApprovalMonitorStatus[]);
  }), []);

  useEffect(() => window.api.on('web-connector:changed', (payload) => {
    if (!Array.isArray(payload)) return;
    setConnectorStatuses(payload as WebConnectorStatus[]);
  }), []);

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
  const setConfig = (createPatch: ConfigPatchFactory) => {
    void configWriteQueue.enqueue(createPatch).catch((error) => {
      setMessage(error instanceof Error ? error.message : '설정을 바꾸지 못했습니다. 입력값을 확인해 주세요.');
    });
  };
  const setBehavior = (patch: Partial<AppConfig['behavior']>) => {
    setConfig((current) => ({ behavior: { ...current.behavior, ...patch } }));
  };
  const setKeyboard = (patch: Partial<AppConfig['keyboard']>) => {
    setConfig((current) => ({ keyboard: { ...current.keyboard, ...patch } }));
  };
  const setApprovalMonitor = (
    update: (current: AppConfig['approvalMonitor']) => AppConfig['approvalMonitor'],
  ) => {
    setConfig((current) => ({ approvalMonitor: update(current.approvalMonitor) }));
  };
  const setWebConnection = (patch: Partial<AppConfig['webConnection']>) => {
    setConfig((current) => ({
      webConnection: { ...current.webConnection, ...patch },
    }));
  };
  const updateGrid = (patch: Partial<AppConfig['grid']>) => {
    const next = { ...config.grid, ...patch };
    const nextCapacity = next.cols * next.rows;
    const moved = config.root.filter((item) => item.position >= nextCapacity).length;
    if (nextCapacity < config.grid.cols * config.grid.rows) {
      setMessage(moved ? `${moved}개 항목이 다음 페이지로 이동합니다.` : null);
    }
    setConfig((current) => ({ grid: { ...current.grid, ...patch } }));
    void window.api.window.relayout();
  };
  const readCapturedHotkey = (event: React.KeyboardEvent<HTMLInputElement>): string | null => {
    event.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
    const modifiers = [
      event.ctrlKey || event.metaKey ? 'CommandOrControl' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    if (!modifiers.length) {
      setMessage('수식키와 일반 키를 함께 눌러 주세요.');
      return null;
    }
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    return normalizeAccelerator([...modifiers, key].join('+'));
  };
  const captureHotkey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const accelerator = readCapturedHotkey(event);
    if (!accelerator) return;
    setConfig(() => ({ hotkey: accelerator }));
    setMessage('단축키 등록 결과를 확인하는 중입니다. 충돌하면 이전 값으로 돌아갑니다.');
  };
  const captureLauncherHotkey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const accelerator = readCapturedHotkey(event);
    if (!accelerator) return;
    setKeyboard({ quickLauncherHotkey: accelerator });
    setMessage('퀵 런처 단축키 등록 결과를 확인하는 중입니다. 충돌하면 이전 값으로 돌아갑니다.');
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
  const openConnectorSetup = async (
    browserId: WebConnectorBrowserId,
    target: 'pair' | 'folder',
  ) => {
    setConnectorBusy(browserId);
    setConnectorError(null);
    setMessage(null);
    try {
      const result = await window.api.webConnector.openSetup({ browserId, target });
      if (result.ok) {
        setMessage(target === 'folder'
          ? '문제 해결 폴더를 열었습니다.'
          : '업무용 브라우저와 소속 교육청 포털을 열었습니다. 로그인은 브라우저에서 직접 진행해 주세요.');
        if (target === 'pair') await refreshConnectorStatuses();
      } else {
        setConnectorError(browserId);
        setMessage(result.message);
      }
    } catch (error) {
      setConnectorError(browserId);
      setMessage(error instanceof Error
        ? error.message
        : '업무용 브라우저를 열지 못했습니다. 설치 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally {
      setConnectorBusy(null);
    }
  };
  const testConnector = async (browserId: WebConnectorBrowserId) => {
    setConnectorBusy(browserId);
    setConnectorError(null);
    setMessage('업무용 브라우저를 열고 소속 교육청 포털 연결을 확인하고 있습니다.');
    try {
      const result = await window.api.webConnector.test({ browserId });
      if (result.ok) {
        setMessage(`${browserId === 'edge' ? '엣지' : '크롬'} 업무포털을 열었습니다. 로그인하면 선택한 업무 시스템 연결이 자동으로 이어집니다.`);
      } else {
        setConnectorError(browserId);
        setMessage(result.message);
      }
      await refreshConnectorStatuses();
    } catch (error) {
      setConnectorError(browserId);
      setMessage(error instanceof Error
        ? error.message
        : '업무용 브라우저 연결을 확인하지 못했습니다. 브라우저 설치 상태를 확인해 주세요.');
    } finally {
      setConnectorBusy(null);
    }
  };
  const checkApprovals = async (system: WebWorkflowSystem) => {
    setApprovalBusy(system);
    setMessage(null);
    try {
      const statuses = await window.api.approvalMonitor.check({ system });
      setApprovalStatuses(statuses);
      const status = statuses.find((candidate) => candidate.system === system);
      if (status?.state === 'ready') {
        setMessage(`${system === 'neis' ? '나이스' : '에듀파인'} 결재 대기 ${status.pendingCount ?? 0}건을 확인했습니다.`);
      } else if (status?.message) {
        setMessage(status.message);
      }
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : '결재 대기 수를 확인하지 못했습니다. 업무용 브라우저에서 로그인 상태를 확인해 주세요.');
    } finally {
      setApprovalBusy(null);
    }
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
              ...(shouldShowWebWorkSettings(config.platform)
                ? [['web-work', '웹 업무 연결'] as [SettingsTab, string]]
                : []),
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
                  <input type="checkbox" checked={config.launchAtLogin} disabled={!info?.isPackaged} onChange={(event) => setConfig(() => ({ launchAtLogin: event.target.checked }))} />
                  로그인 시 자동 시작
                </label>
                <label><input type="checkbox" checked={config.window.hideOnLaunch} onChange={(event) => setConfig((current) => ({ window: { ...current.window, hideOnLaunch: event.target.checked } }))} />시작 시 패널 숨기기</label>
                <label><input type="checkbox" checked={config.autoUpdate} onChange={(event) => setConfig(() => ({ autoUpdate: event.target.checked }))} />{config.platform === 'darwin' ? '새 버전 알림 받기' : '자동 업데이트 확인'}</label>
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
                <label>테마<select value={config.theme} onChange={(event) => setConfig(() => ({ theme: event.target.value as AppConfig['theme'] }))}><option value="system">시스템</option><option value="light">라이트</option><option value="dark">다크</option></select></label>
                <label>열 {config.grid.cols}<input type="range" min="2" max="8" value={config.grid.cols} onChange={(event) => updateGrid({ cols: Number(event.target.value) })} /></label>
                <label>행 {config.grid.rows}<input type="range" min="1" max="6" value={config.grid.rows} onChange={(event) => updateGrid({ rows: Number(event.target.value) })} /></label>
                <label>버튼 크기 {config.grid.buttonSize}<input type="range" min="64" max="140" value={config.grid.buttonSize} onChange={(event) => updateGrid({ buttonSize: Number(event.target.value) })} /></label>
                <label>투명도 {Math.round(config.window.opacity * 100)}퍼센트<input type="range" min="0.3" max="1" step="0.05" value={config.window.opacity} onChange={(event) => setConfig((current) => ({ window: { ...current.window, opacity: Number(event.target.value) } }))} /></label>
                <label><input type="checkbox" checked={config.window.alwaysOnTop} onChange={(event) => setConfig((current) => ({ window: { ...current.window, alwaysOnTop: event.target.checked } }))} />항상 최상위</label>
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
                <label className="settings-field-column">퀵 런처
                  <span><input type="checkbox" checked={config.keyboard.quickLauncher} onChange={(event) => setKeyboard({ quickLauncher: event.target.checked })} />어디서든 이름을 검색해 실행</span>
                  <input className="hotkey-input" value={formatAccelerator(config.keyboard.quickLauncherHotkey, config.platform)} readOnly disabled={!config.keyboard.quickLauncher} onKeyDown={captureLauncherHotkey} aria-label="퀵 런처 단축키 입력" />
                  <small>한글 초성으로도 검색할 수 있습니다. 예: ㄱㅂ으로 개발 찾기</small>
                </label>
                <label><input type="checkbox" checked={config.keyboard.globalNumberHotkeys} onChange={(event) => void toggleNumberHotkeys(event.target.checked)} />전역 숫자 단축키</label>
                <label>숫자 수식키<select value={config.keyboard.globalNumberModifier} onChange={(event) => setKeyboard({ globalNumberModifier: event.target.value })}>
                  {config.platform === 'darwin' && <option value="Control+Alt">Ctrl+Option — 기본</option>}
                  <option value="Alt+Shift">Alt+Shift{config.platform === 'win32' ? ' — 기본' : ''}</option>
                  <option value="CommandOrControl+Alt">{config.platform === 'darwin' ? 'Command+Option' : 'Ctrl+Alt'}</option>
                  <option value="CommandOrControl+Shift">{config.platform === 'darwin' ? 'Command+Shift' : 'Ctrl+Shift'}</option>
                  {config.platform === 'win32' && <option value="Super+Alt">Win+Alt</option>}
                </select></label>
                <small>{formatNumberModifier(config.keyboard.globalNumberModifier, config.platform)}와 숫자를 누르면 맨 앞 페이지의 첫 열 개 위치를 실행합니다. 자주 쓰는 항목을 앞쪽에 배치하세요.</small>
                {failedNumbers.length > 0 && <p className="field-error">등록하지 못한 번호: {failedNumbers.join(', ')}</p>}
                <ol className="number-preview" aria-label="전역 숫자 단축키 미리보기">
                  {numberPreview.map(({ key, ordinal, label, active }) => (
                    <li key={key} className={active ? '' : 'inactive'}>
                      <kbd>{key}</kbd><span>{ordinal}번</span><strong>{label}</strong>
                    </li>
                  ))}
                </ol>
                <h3>키별 전역 단축키</h3>
                {hotkeys.length === 0 ? <p className="empty-hotkeys">등록된 키별 단축키가 없습니다.</p> : (
                  <table className="hotkey-table"><thead><tr><th>키</th><th>단축키</th><th>상태</th><th></th></tr></thead><tbody>{hotkeys.map(({ path, item }) => { const status = hotkeyStatuses[item.id] ?? '확인 중'; const ok = status === '등록됨'; return <tr key={item.id}><td>{item.label}</td><td>{formatAccelerator(item.globalHotkey!, config.platform)}</td><td><span className={ok ? 'hotkey-ok' : 'field-error'}>{status}</span></td><td><button type="button" onClick={() => void window.api.deck.upsert({ path, item: { ...item, globalHotkey: undefined } })}>해제</button></td></tr>; })}</tbody></table>
                )}
              </>
            )}
            {config.platform === 'win32' && tab === 'web-work' && (
              <>
                <div className="web-work-heading">
                  <div>
                    <h3>업무용 브라우저</h3>
                    <p>개인 브라우저와 분리된 전용 창에서 나이스와 에듀파인의 정해진 작성 화면까지 이동합니다.</p>
                  </div>
                </div>
                <label className="education-office-field">
                  소속 교육청
                  <select
                    value={config.educationOfficeCode}
                    disabled={connectorBusy !== null}
                    onChange={(event) => setConfig((current) => createEducationOfficePatch(
                      current,
                      event.target.value as EducationOfficeCode,
                    ))}
                  >
                    {EDUCATION_OFFICES.map((office) => (
                      <option key={office.code} value={office.code}>{office.name}</option>
                    ))}
                  </select>
                  <small>교육청을 바꾸면 등록된 웹 업무 키 주소도 함께 안전하게 바뀝니다.</small>
                </label>
                <section className="portal-auto-connect" aria-labelledby="portal-auto-connect-title">
                  <div>
                    <strong id="portal-auto-connect-title">업무포털 로그인 후 자동 연결</strong>
                    <small>포털 로그인을 감지하면 공식 SSO 메뉴를 통해 선택한 업무 시스템의 세션을 미리 준비합니다.</small>
                  </div>
                  <label>
                    <input
                      type="checkbox"
                      checked={config.webConnection.autoConnectAfterPortalLogin}
                      onChange={(event) => setWebConnection({
                        autoConnectAfterPortalLogin: event.target.checked,
                      })}
                    />
                    자동 연결 사용
                  </label>
                  <label>
                    연결 대상
                    <select
                      value={config.webConnection.autoConnectTarget}
                      disabled={!config.webConnection.autoConnectAfterPortalLogin}
                      onChange={(event) => setWebConnection({
                        autoConnectTarget: event.target.value as AppConfig['webConnection']['autoConnectTarget'],
                      })}
                    >
                      <option value="both">나이스와 K-에듀파인 — 기본</option>
                      <option value="neis">나이스</option>
                      <option value="edufine">K-에듀파인</option>
                    </select>
                  </label>
                </section>
                <div className="connector-browser-list">
                  {connectorCards.map((card) => (
                      <article className={`connector-browser-card connector-${card.state}`} key={card.browserId}>
                        <div>
                          <strong>{card.name}</strong>
                          {card.recommended && <span className="connector-recommended">추천</span>}
                          <span className={`connector-state connector-state-${card.state}`}>
                            {card.stateLabel}
                          </span>
                          <small>소속 교육청 전용 프로필을 사용하며 개인 방문 기록과 설정을 섞지 않습니다.</small>
                          <div className="connector-system-list" aria-label={`${card.name} 업무 시스템 연결 상태`}>
                            {card.systems.map((system) => (
                              <span
                                className={`connector-system connector-system-${system.state}`}
                                key={system.system}
                                title={system.message}
                              >
                                <b>{system.label}</b>
                                {system.stateLabel}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="connector-actions">
                          <button
                            type="button"
                            disabled={connectorBusy !== null}
                            onClick={() => void openConnectorSetup(card.browserId, 'pair')}
                          >업무용 브라우저 열기</button>
                          <button
                            className="primary-action"
                            type="button"
                            disabled={connectorBusy !== null}
                            onClick={() => void testConnector(card.browserId)}
                          >{connectorBusy === card.browserId ? '확인 중…' : '연결 시험'}</button>
                          {card.state === 'error' && (
                            <button
                              type="button"
                              disabled={connectorBusy !== null}
                              onClick={() => void openConnectorSetup(card.browserId, 'folder')}
                            >문제 해결 폴더 열기</button>
                          )}
                        </div>
                      </article>
                  ))}
                </div>
                <div className="connector-guide">
                  <h3>사용 순서</h3>
                  <ol>
                    <li>소속 교육청과 사용할 엣지 또는 크롬을 고릅니다.</li>
                    <li>업무용 브라우저 열기를 누르고 업무포털에서 한 번 로그인합니다.</li>
                    <li>로그인이 끝나면 나이스와 K-에듀파인 연결이 순서대로 자동 준비됩니다.</li>
                    <li>오른쪽 액션 목록의 웹 업무 키를 패널에 놓고 실행합니다.</li>
                  </ol>
                </div>
                <CustomWebWorkflowBuilder
                  officeCode={config.educationOfficeCode}
                  onCreate={onAddWebWorkflow}
                />
                <ApprovalMonitorSettings
                  config={config.approvalMonitor}
                  statuses={approvalStatuses}
                  busySystem={approvalBusy}
                  onChange={setApprovalMonitor}
                  onCheck={(system) => void checkApprovals(system)}
                  onAddKey={(system, browserId) => void onAddWebWorkflow(
                    createApprovalInboxTemplate(system, browserId, config.educationOfficeCode),
                  ).then(() => setMessage(`${system === 'neis' ? '나이스' : '에듀파인'} 결재함 키를 맨 앞 화면에 추가했습니다.`))}
                />
                <p className="connector-legacy-note">
                  예전 확장 기능은 더 이상 필요하지 않습니다. 설치되어 있다면 브라우저에서 직접 제거해도 됩니다.
                </p>
                <p className="workflow-safety-note">
                  로그인과 인증서 암호, 외부 프로그램 확인은 사용자가 직접 진행합니다. 기본 업무는 저장·제출·상신·승인·결재를 실행하지 않으며, 내 웹 업무에 추가한 중요 단계는 실행 직전 확인 후 한 번만 실행합니다.
                </p>
              </>
            )}
            {tab === 'about' && (
              <>
                <p>Stream Panel v{info?.version ?? '1.0.0'}</p><p>공개 저장소: github.com/deepsky616/stream-panel</p><p>라이선스: MIT</p>
                {config.platform === 'darwin' && <p className="settings-note">맥에서는 자동 업데이트를 지원하지 않습니다. 새 버전 알림이 오면 메뉴 막대의 릴리즈 페이지에서 직접 내려받아 설치해 주세요.</p>}
                {updateReady && <p className="update-ready">앱을 다시 시작하면 v{updateReady} 업데이트가 적용됩니다.</p>}
                <button type="button" onClick={() => void window.api.update.check().then((result) => setMessage(result.status)).catch(() => setMessage('개발 모드에서는 새 버전을 확인하지 않습니다.'))}>{config.platform === 'darwin' ? '새 버전 확인' : '업데이트 확인'}</button>
              </>
            )}
            {message && <p className="settings-message" role="status">{message}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
