import { useCallback, useEffect, useMemo, useState } from 'react';
import { findFirstEmptyPosition, getPageCount } from '../../../shared/layout';
import { cloneItemWithNewIds, countDeckItems, getItemsAtPath } from '../../../shared/tree';
import type { DeckItem } from '../../../shared/types';
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

export function PanelApp() {
  const config = useConfig();
  const location = useDeckStore((state) => state.location);
  const setLocation = useDeckStore((state) => state.setLocation);
  const error = useDeckStore((state) => state.error);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const items = useMemo(
    () => (config ? getItemsAtPath(config.root, location.path) : []),
    [config, location.path],
  );
  const pageCount = config ? getPageCount(items, config.grid, location.path.length > 0) : 1;
  const showFooter = location.path.length > 0 || pageCount > 1;
  const closeMenu = useCallback(() => setMenu(null), []);

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
    document.title = showFooter ? 'Stream Panel [footer]' : 'Stream Panel';
    void window.api.window.relayout();
  }, [showFooter]);
  useEffect(() => {
    if (location.page >= pageCount) setLocation({ ...location, page: pageCount - 1 });
  }, [location, pageCount, setLocation]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [config, items, location, pageCount, pasteAt, removeItem, setLocation]);

  if (!config) return <main className="panel loading">패널을 불러오는 중입니다...</main>;

  const changePage = (page: number) => setLocation({ ...location, page });
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
          disabled: menu.item.kind === 'folder' || menu.item.type === 'url' || menu.item.type === 'uwp',
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
      />
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
