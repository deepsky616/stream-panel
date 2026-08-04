import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assignHints, findHintByCode } from '../../../shared/hintMap';
import { findFirstEmptyPosition, getPageCount, getPageSlots } from '../../../shared/layout';
import { cloneItemWithNewIds, countDeckItems, getItemsAtPath } from '../../../shared/tree';
import type { DeckItem, MultiActionProgress } from '../../../shared/types';
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { Toast } from '../common/Toast';
import { useConfig } from '../hooks/useConfig';
import {
  clearDeckClipboard,
  getDeckClipboard,
  setDeckClipboard,
} from '../hooks/useClipboard';
import { useDeckStore } from '../store/deckStore';
import { Footer } from './Footer';
import { PanelGrid } from './PanelGrid';
import { TitleBar } from './TitleBar';

interface MenuState {
  x: number;
  y: number;
  item: DeckItem | null;
  position: number;
}

function isMultiActionProgress(payload: unknown): payload is MultiActionProgress {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as Partial<MultiActionProgress>;
  return (
    typeof value.runId === 'string' &&
    typeof value.itemId === 'string' &&
    typeof value.label === 'string' &&
    Number.isInteger(value.currentStep) &&
    Number.isInteger(value.totalSteps) &&
    ['running', 'completed', 'failed', 'cancelled'].includes(String(value.state))
  );
}

export function PanelApp() {
  const config = useConfig();
  const location = useDeckStore((state) => state.location);
  const setLocation = useDeckStore((state) => state.setLocation);
  const error = useDeckStore((state) => state.error);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [panelFocused, setPanelFocused] = useState(() => document.hasFocus());
  const [focusUnavailable, setFocusUnavailable] = useState(false);
  const [multiActionProgress, setMultiActionProgress] = useState<MultiActionProgress | null>(null);
  const [showNumberIntro, setShowNumberIntro] = useState(
    () => localStorage.getItem('global-number-intro-seen') !== '1',
  );
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleActive = useRef(false);
  const items = useMemo(
    () => (config ? getItemsAtPath(config.root, location.path) : []),
    [config, location.path],
  );
  const pageCount = config ? getPageCount(items, config.grid, location.path.length > 0) : 1;
  const showFooter = location.path.length > 0 || pageCount > 1;
  const hintAssignments = useMemo(
    () =>
      config
        ? assignHints(
            getPageSlots(items, config.grid, location.page, location.path.length > 0),
            config.keyboard.hintKeys,
          )
        : [],
    [config, items, location.page, location.path.length],
  );
  const closeMenu = useCallback(() => setMenu(null), []);
  const restoreIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (!idleActive.current) return;
    idleActive.current = false;
    void window.api.window.setIdle(false);
  }, []);

  const removeItem = useCallback(async (item: DeckItem) => {
    if (
      item.kind === 'folder' &&
      !window.confirm(`이 폴더와 하위 ${countDeckItems(item.children)}개 항목을 함께 삭제할까요?`)
    ) {
      return;
    }
    await window.api.deck.remove({ path: location.path, id: item.id });
  }, [location.path]);

  const pasteAt = useCallback(async (position: number) => {
    const clipboard = getDeckClipboard();
    if (!clipboard) return;
    if (clipboard.cut) {
      await window.api.deck.move({
        from: { path: clipboard.path, id: clipboard.item.id },
        to: { path: location.path, position },
      });
      clearDeckClipboard();
    } else {
      const copy = cloneItemWithNewIds(clipboard.item);
      copy.position = position;
      await window.api.deck.upsert({ path: location.path, item: copy });
    }
  }, [location.path]);

  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.api.on('multi-action:progress', (payload) => {
      if (!isMultiActionProgress(payload)) return;
      if (clearTimer) clearTimeout(clearTimer);
      setMultiActionProgress(payload);
      if (payload.state !== 'running') {
        clearTimer = setTimeout(() => setMultiActionProgress(null), 4_000);
      }
    });
    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    document.title = showFooter ? 'Stream Panel [footer]' : 'Stream Panel';
    void window.api.window.relayout();
  }, [showFooter]);
  useEffect(() => {
    const encoded = encodeURIComponent(JSON.stringify(location));
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#panel=${encoded}`);
  }, [location]);
  useEffect(() => {
    if (config?.behavior.idleFade) return;
    restoreIdle();
    void window.api.window.setIdle(false);
  }, [config?.behavior.idleFade, restoreIdle]);
  useEffect(() => () => restoreIdle(), [restoreIdle]);
  useEffect(() => {
    if (location.page >= pageCount) setLocation({ ...location, page: pageCount - 1 });
  }, [location, pageCount, setLocation]);
  useEffect(() => {
    const focus = () => {
      setPanelFocused(true);
      setFocusUnavailable(false);
    };
    const blur = () => {
      setPanelFocused(false);
      setFocusUnavailable(false);
    };
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.api.on('panel:visibility', (payload) => {
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = null;
      setFocusUnavailable(false);
      if (payload !== true) return;
      focusTimer = setTimeout(() => {
        focusTimer = null;
        if (!document.hasFocus()) setFocusUnavailable(true);
      }, 180);
    });
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        void window.api.window.hide();
        return;
      }
      if (config && !event.isComposing) {
        const assignment = findHintByCode(hintAssignments, event.code);
        const hintedItem = assignment
          ? items.find((item) => item.id === assignment.itemId)
          : undefined;
        if (hintedItem) {
          event.preventDefault();
          if (hintedItem.kind === 'folder') {
            setLocation({ path: [...location.path, hintedItem.id], page: 0 });
          } else {
            void window.api.button.launch({
              path: location.path,
              id: hintedItem.id,
              keepOpen: event.shiftKey || !config.keyboard.hideAfterHotkeyLaunch,
            });
          }
          return;
        }
      }
      if (event.key === 'Backspace' && location.path.length > 0) {
        event.preventDefault();
        setLocation({ path: location.path.slice(0, -1), page: 0 });
      }
      if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        setLocation({ ...location, page: Math.max(0, Math.min(pageCount - 1, location.page + delta)) });
      }
      if (!config || config.window.locked) return;
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-position]');
      const focusedId = focused?.dataset.itemId;
      const focusedItem = focusedId ? items.find((item) => item.id === focusedId) : null;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'c' && focusedItem) {
        event.preventDefault();
        setDeckClipboard(focusedItem, location.path, false);
      } else if (command && event.key.toLowerCase() === 'x' && focusedItem) {
        event.preventDefault();
        setDeckClipboard(focusedItem, location.path, true);
      } else if (command && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        const position = focusedId
          ? findFirstEmptyPosition(items)
          : Number(focused?.dataset.position ?? findFirstEmptyPosition(items));
        void pasteAt(position);
      } else if (event.key === 'Delete' && focusedItem) {
        event.preventDefault();
        void removeItem(focusedItem);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config, hintAssignments, items, location, pageCount, pasteAt, removeItem, setLocation]);

  if (!config) return <main className="panel loading">패널을 불러오는 중입니다...</main>;

  const dismissNumberIntro = () => {
    localStorage.setItem('global-number-intro-seen', '1');
    setShowNumberIntro(false);
  };

  const changePage = (page: number) => setLocation({ ...location, page });
  const showHints =
    config.keyboard.quickHints === 'always' ||
    (config.keyboard.quickHints === 'on-focus' && panelFocused) ||
    focusUnavailable;
  const onWheel = (event: React.WheelEvent) => {
    if (pageCount < 2 || Math.abs(event.deltaY) < 4) return;
    changePage(Math.max(0, Math.min(pageCount - 1, location.page + (event.deltaY > 0 ? 1 : -1))));
  };
  const menuItems: ContextMenuItem[] = menu?.item
    ? [
        { label: '편집', onSelect: () => void window.api.editor.open({ path: location.path, slot: menu.position }) },
        { label: '복사', shortcut: 'Ctrl+C', onSelect: () => setDeckClipboard(menu.item!, location.path, false) },
        { label: '잘라내기', shortcut: 'Ctrl+X', onSelect: () => setDeckClipboard(menu.item!, location.path, true) },
        { label: '복제', onSelect: () => void window.api.deck.duplicate({ path: location.path, id: menu.item!.id }) },
        { label: '아이콘 변경', onSelect: () => void window.api.editor.open({ path: location.path, slot: menu.position }) },
        {
          label: '위치 열기',
          disabled:
            menu.item.kind === 'folder' ||
            menu.item.type === 'url' ||
            menu.item.type === 'uwp' ||
            menu.item.type === 'multi',
          onSelect: () => menu.item?.kind === 'action' && void window.api.shell.reveal(menu.item.target),
        },
        { separator: true },
        { label: '삭제', shortcut: 'Delete', danger: true, onSelect: () => void removeItem(menu.item!) },
      ]
    : [
        {
          label: '붙여넣기',
          shortcut: 'Ctrl+V',
          disabled: !getDeckClipboard(),
          onSelect: () => menu && void pasteAt(menu.position),
        },
      ];

  return (
    <main
      className={`panel theme-${config.theme}`}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
      onMouseEnter={restoreIdle}
      onMouseMove={() => {
        if (idleActive.current) restoreIdle();
      }}
      onMouseLeave={() => {
        if (!config.behavior.idleFade) return;
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => {
          idleTimer.current = null;
          idleActive.current = true;
          void window.api.window.setIdle(true);
        }, config.behavior.idleFadeAfterMs);
      }}
    >
      <TitleBar config={config} />
      <PanelGrid
        config={config}
        items={items}
        path={location.path}
        page={location.page}
        onEnterFolder={(id) => setLocation({ path: [...location.path, id], page: 0 })}
        onBack={() => setLocation({ path: location.path.slice(0, -1), page: 0 })}
        onContextItem={(event, item) => {
          event.preventDefault();
          if (!config.window.locked) setMenu({ x: event.clientX, y: event.clientY, item, position: item.position });
        }}
        onContextEmpty={(event, position) => {
          event.preventDefault();
          if (!config.window.locked) setMenu({ x: event.clientX, y: event.clientY, item: null, position });
        }}
        showHints={showHints}
        hintMuted={focusUnavailable}
      />
      {focusUnavailable && (
        <div className="focus-guidance" role="status">
          이 창을 클릭하면 키보드로 실행할 수 있습니다
        </div>
      )}
      {config.keyboard.globalNumberHotkeys && showNumberIntro && !focusUnavailable && (
        <div className="number-intro" role="status">
          <span>
            {config.platform === 'darwin' ? 'Ctrl+Option' : 'Alt+Shift'}와 1부터 0을 누르면 어디서든 바로 실행할 수 있습니다
          </span>
          <button type="button" onClick={() => { dismissNumberIntro(); void window.api.editor.open(); }}>
            설정 보기
          </button>
          <button type="button" onClick={dismissNumberIntro} aria-label="전역 숫자 안내 닫기">✕</button>
        </div>
      )}
      {multiActionProgress && (
        <div className={`multi-progress multi-progress-${multiActionProgress.state}`} role="status">
          <div>
            <strong>{multiActionProgress.label}</strong>
            <span>
              {multiActionProgress.state === 'running'
                ? `${multiActionProgress.currentStep}/${multiActionProgress.totalSteps}단계 실행 중`
                : multiActionProgress.message}
            </span>
          </div>
          <progress
            max={multiActionProgress.totalSteps}
            value={multiActionProgress.currentStep}
            aria-label="멀티 액션 진행률"
          />
          {multiActionProgress.state === 'running' && (
            <button
              type="button"
              onClick={() =>
                void window.api.multiAction.cancel({ itemId: multiActionProgress.itemId })
              }
            >
              취소
            </button>
          )}
        </div>
      )}
      {showFooter && (
        <Footer
          root={config.root}
          path={location.path}
          page={location.page}
          pageCount={pageCount}
          onNavigate={(depth) => setLocation({ path: location.path.slice(0, depth), page: 0 })}
          onPageChange={changePage}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
      {error && <div className="panel-error">{error}</div>}
      <Toast />
    </main>
  );
}
