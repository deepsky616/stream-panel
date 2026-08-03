import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findFirstEmptyPosition,
  getPageCount,
  positionToSlot,
} from '../../../shared/layout';
import {
  cloneItemWithNewIds,
  countDeckItems,
  findItemAtPath,
  getItemsAtPath,
} from '../../../shared/tree';
import type { ActionItem, DeckItem, LibraryEntry } from '../../../shared/types';
import { Breadcrumb } from '../common/Breadcrumb';
import { PageDots } from '../common/PageDots';
import { Toast } from '../common/Toast';
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { useConfig } from '../hooks/useConfig';
import {
  clearDeckClipboard,
  getDeckClipboard,
  setDeckClipboard,
} from '../hooks/useClipboard';
import { useDeckStore } from '../store/deckStore';
import { ActionLibrary } from './ActionLibrary';
import { isDragData, isDropData, type DragData } from './dndTypes';
import { KeyGrid } from './KeyGrid';
import { PropertiesPanel } from './PropertiesPanel';
import { TrashZone } from './TrashZone';
import { SettingsModal } from './SettingsModal';

interface FocusSlotPayload {
  path?: string[];
  slot?: number;
}

interface MenuState {
  x: number;
  y: number;
  item: DeckItem | null;
  position: number;
}

function isFocusSlot(payload: unknown): payload is FocusSlotPayload {
  if (!payload || typeof payload !== 'object') return false;
  const value = payload as FocusSlotPayload;
  return (
    (value.path === undefined ||
      (Array.isArray(value.path) && value.path.every((id) => typeof id === 'string'))) &&
    (value.slot === undefined || (Number.isInteger(value.slot) && Number(value.slot) >= 0))
  );
}

function userError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const marker = raw.lastIndexOf('Error: ');
  return marker >= 0 ? raw.slice(marker + 7) : raw;
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|ico|bmp|webp)$/i.test(path);
}

function DragPreview({ data }: { data: DragData }) {
  if (data.source === 'library') {
    const label = data.entry.kind === 'installed-app' ? data.entry.app.name : data.entry.label;
    const icon = data.entry.kind === 'installed-app' ? '🖥️' : data.entry.emoji;
    return <div className="drag-preview"><span>{icon}</span>{label}</div>;
  }
  return <div className="drag-preview"><span>◈</span>{data.item.label}</div>;
}

export function EditorApp() {
  const config = useConfig();
  const location = useDeckStore((state) => state.location);
  const setLocation = useDeckStore((state) => state.setLocation);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [focusField, setFocusField] = useState<'label' | 'target' | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [highlightedFolderId, setHighlightedFolderId] = useState<string | null>(null);
  const [dndMessage, setDndMessage] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const folderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredFolderKey = useRef<string | null>(null);
  const springDestination = useRef<string[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }));

  const items = useMemo(() => {
    if (!config) return [];
    try {
      return getItemsAtPath(config.root, location.path);
    } catch {
      return config.root;
    }
  }, [config, location.path]);
  const pageCount = config ? getPageCount(items, config.grid, location.path.length > 0) : 1;
  const selectedItem =
    config && selectedId ? (findItemAtPath(config.root, location.path, selectedId) ?? null) : null;

  const clearFolderHover = useCallback((clearDestination = false) => {
    if (folderTimer.current) clearTimeout(folderTimer.current);
    folderTimer.current = null;
    hoveredFolderKey.current = null;
    setHighlightedFolderId(null);
    if (clearDestination) springDestination.current = null;
  }, []);

  useEffect(() => () => clearFolderHover(true), [clearFolderHover]);
  useEffect(() => {
    const openSettingsFromHash = () => {
      if (window.location.hash !== '#settings') return;
      setSettingsOpen(true);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    openSettingsFromHash();
    window.addEventListener('hashchange', openSettingsFromHash);
    return () => window.removeEventListener('hashchange', openSettingsFromHash);
  }, []);
  useEffect(() => {
    return window.api.on('editor:focus-slot', (payload) => {
      if (!isFocusSlot(payload)) return;
      const path = payload.path ?? [];
      setLocation({ path, page: 0 });
      setSelectedId(null);
      setSelectedPosition(payload.slot ?? null);
    });
  }, [setLocation]);
  useEffect(() => {
    if (location.page >= pageCount) setLocation({ ...location, page: pageCount - 1 });
  }, [location, pageCount, setLocation]);

  const addEntry = async (entry: LibraryEntry, forcedPosition?: number, forcedPath?: string[]) => {
    if (!config) return;
    const targetPath = forcedPath ?? location.path;
    const targetItems = getItemsAtPath(config.root, targetPath);
    const position =
      forcedPosition ??
      (selectedId ? findFirstEmptyPosition(targetItems) : (selectedPosition ?? findFirstEmptyPosition(targetItems)));
    const id = crypto.randomUUID();
    let item: DeckItem;
    if (entry.kind === 'folder-template') {
      item = {
        id,
        kind: 'folder',
        label: '새 폴더',
        icon: { kind: 'emoji', value: entry.emoji },
        color: '#5B8CFF',
        position,
        children: [],
      };
    } else if (entry.kind === 'action-template') {
      item = {
        id,
        kind: 'action',
        type: entry.type,
        label: entry.label,
        target: entry.target ?? '',
        args: [],
        icon: { kind: 'emoji', value: entry.emoji },
        color: '#5B8CFF',
        position,
        webWorkflow: entry.webWorkflow,
      };
    } else {
      const app = entry.app;
      item = {
        id,
        kind: 'action',
        type: app.type,
        label: app.name.slice(0, 24),
        target: app.target,
        args: app.args,
        workingDir: app.workingDir,
        icon: { kind: 'auto' },
        color: '#5B8CFF',
        position,
      };
    }
    await window.api.deck.upsert({ path: targetPath, item });
    if (entry.kind === 'action-template' && entry.webWorkflow && item.kind === 'action') {
      const detected = await window.api.browsers.list();
      const browser =
        detected.find((candidate) => candidate.id === entry.webWorkflow?.browserId) ??
        detected.find((candidate) => candidate.id === 'edge' || candidate.id === 'chrome');
      if (browser && (browser.id === 'edge' || browser.id === 'chrome')) {
        item = {
          ...item,
          browser: { path: browser.path, appMode: false },
          webWorkflow: { ...entry.webWorkflow, browserId: browser.id },
        };
        await window.api.deck.upsert({ path: targetPath, item });
      }
    }
    setLocation({
      path: targetPath,
      page: positionToSlot(position, config.grid.cols * config.grid.rows, targetPath.length > 0).page,
    });
    setSelectedId(item.id);
    setSelectedPosition(item.position);
    setFocusField(
      item.kind === 'folder'
        ? 'label'
        : item.type === 'url' && !item.webWorkflow
          ? 'target'
          : null,
    );

    if (
      entry.kind === 'action-template' &&
      item.kind === 'action' &&
      ['folder', 'file', 'app'].includes(item.type)
    ) {
      let updated: DeckItem = item;
      if (item.type === 'folder') {
        const target = await window.api.picker.folder();
        if (target) updated = { ...item, target };
      } else if (item.type === 'file') {
        const target = await window.api.picker.file();
        if (target) updated = { ...item, target };
      } else {
        const selected = await window.api.picker.executable();
        if (selected) updated = { ...item, ...selected, label: selected.name };
      }
      if (updated !== item) await window.api.deck.upsert({ path: targetPath, item: updated });
    }
  };

  const moveGridItem = async (source: Extract<DragData, { source: 'grid' }>, path: string[], position: number) => {
    try {
      await window.api.deck.move({
        from: { path: source.path, id: source.item.id },
        to: { path, position },
      });
      setLocation({ path, page: 0 });
      setSelectedId(source.item.id);
      setSelectedPosition(position);
      setDndMessage(null);
    } catch (error) {
      setDndMessage(userError(error));
    }
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current;
    if (isDragData(data)) setActiveDrag(data);
    springDestination.current = null;
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    const source = active.data.current;
    const target = over?.data.current;
    if (!isDragData(source) || source.source !== 'grid' || !isDropData(target) || target.target !== 'folder') {
      clearFolderHover(false);
      return;
    }
    if (source.item.id === target.id) return;
    const key = `${target.path.join('/')}:${target.id}`;
    if (hoveredFolderKey.current === key) return;
    clearFolderHover(false);
    hoveredFolderKey.current = key;
    setHighlightedFolderId(target.id);
    folderTimer.current = setTimeout(() => {
      const destination = [...target.path, target.id];
      springDestination.current = destination;
      setLocation({ path: destination, page: 0 });
      setSelectedId(null);
      setSelectedPosition(null);
    }, 500);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    const eventSource = active.data.current;
    const source = isDragData(eventSource) ? eventSource : activeDrag;
    const target = over?.data.current;
    const enteredPath = springDestination.current;
    clearFolderHover(true);
    setActiveDrag(null);
    if (!source) return;

    if (source.source === 'library') {
      if (isDropData(target) && target.target === 'slot' && !target.occupiedId) {
        try {
          await addEntry(source.entry, target.position, target.path);
        } catch (error) {
          setDndMessage(userError(error));
        }
      }
      return;
    }

    if (isDropData(target) && target.target === 'trash') {
      const childCount = source.item.kind === 'folder' ? countDeckItems(source.item.children) : 0;
      if (
        source.item.kind === 'folder' &&
        !window.confirm(`이 폴더와 하위 ${childCount}개 항목을 함께 삭제할까요?`)
      ) {
        return;
      }
      try {
        await window.api.deck.remove({ path: source.path, id: source.item.id });
        setSelectedId(null);
        setSelectedPosition(null);
      } catch (error) {
        setDndMessage(userError(error));
      }
      return;
    }

    if (enteredPath && config) {
      try {
        const destinationItems = getItemsAtPath(config.root, enteredPath);
        await moveGridItem(source, enteredPath, findFirstEmptyPosition(destinationItems));
      } catch (error) {
        setDndMessage(userError(error));
      }
      return;
    }

    if (isDropData(target) && target.target === 'slot') {
      await moveGridItem(source, target.path, target.position);
    }
  };

  const handleDragCancel = async () => {
    const source = activeDrag;
    const enteredPath = springDestination.current;
    clearFolderHover(true);
    setActiveDrag(null);
    if (!config || !enteredPath || source?.source !== 'grid') return;
    try {
      const destinationItems = getItemsAtPath(config.root, enteredPath);
      await moveGridItem(source, enteredPath, findFirstEmptyPosition(destinationItems));
    } catch (error) {
      setDndMessage(userError(error));
    }
  };

  const handleOsDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!config) return;
    const targetElement = (event.target as Element).closest<HTMLElement>('[data-position]');
    const startPosition = targetElement
      ? Number(targetElement.dataset.position)
      : findFirstEmptyPosition(items);
    const targetItemId = targetElement?.dataset.itemId;
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => {
        try {
          return window.api.drop.getPathForFile(file);
        } catch {
          return '';
        }
      })
      .filter(Boolean);

    if (paths.length === 1 && targetItemId && isImagePath(paths[0])) {
      const item = items.find((candidate) => candidate.id === targetItemId);
      const relativePath = await window.api.icon.importPath(paths[0]);
      if (item && relativePath) {
        await window.api.deck.upsert({
          path: location.path,
          item: { ...item, icon: { kind: 'file', path: relativePath } },
        });
        setSelectedId(item.id);
        setDndMessage(null);
      } else {
        setDndMessage('이미지를 아이콘으로 가져오지 못했습니다. 파일 형식과 크기를 확인해 주세요.');
      }
      return;
    }

    const uriText = event.dataTransfer.getData('text/uri-list');
    const plainText = event.dataTransfer.getData('text/plain');
    try {
      const classified = await window.api.drop.classify({
        paths,
        text: uriText || plainText || undefined,
      });
      const occupied = new Set(items.map((item) => item.position));
      let position = Number.isInteger(startPosition) ? startPosition : findFirstEmptyPosition(items);
      let firstItem: ActionItem | null = null;
      for (const partial of classified) {
        if (!partial.type || !partial.target || !partial.label) continue;
        while (occupied.has(position)) position += 1;
        const item: ActionItem = {
          id: crypto.randomUUID(),
          kind: 'action',
          type: partial.type,
          target: partial.target,
          label: partial.label.slice(0, 24),
          args: partial.args ?? [],
          workingDir: partial.workingDir,
          icon: { kind: 'auto' },
          color: '#5B8CFF',
          position,
        };
        await window.api.deck.upsert({ path: location.path, item });
        firstItem ??= item;
        occupied.add(position);
        position += 1;
      }
      if (firstItem) {
        setSelectedId(firstItem.id);
        setSelectedPosition(firstItem.position);
        setLocation({
          path: location.path,
          page: positionToSlot(
            firstItem.position,
            config.grid.cols * config.grid.rows,
            location.path.length > 0,
          ).page,
        });
      }
      setDndMessage(null);
    } catch (error) {
      setDndMessage(userError(error));
    }
  };

  const selectItem = (id: string, position: number) => {
    setSelectedId(id);
    setSelectedPosition(position);
    setFocusField(null);
  };
  const saved = useCallback((item: DeckItem) => setSelectedId(item.id), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const removeDeckItem = useCallback(async (item: DeckItem, path = location.path) => {
    if (
      item.kind === 'folder' &&
      !window.confirm(`이 폴더와 하위 ${countDeckItems(item.children)}개 항목을 함께 삭제할까요?`)
    ) {
      return;
    }
    try {
      await window.api.deck.remove({ path, id: item.id });
      setSelectedId(null);
      setSelectedPosition(null);
    } catch (error) {
      setDndMessage(userError(error));
    }
  }, [location.path]);

  const pasteAt = useCallback(async (position: number) => {
    const clipboard = getDeckClipboard();
    if (!clipboard) return;
    try {
      if (clipboard.cut) {
        await window.api.deck.move({
          from: { path: clipboard.path, id: clipboard.item.id },
          to: { path: location.path, position },
        });
        clearDeckClipboard();
        setSelectedId(clipboard.item.id);
      } else {
        const copy = cloneItemWithNewIds(clipboard.item);
        copy.position = position;
        await window.api.deck.upsert({ path: location.path, item: copy });
        setSelectedId(copy.id);
      }
      setSelectedPosition(position);
    } catch (error) {
      setDndMessage(userError(error));
    }
  }, [location.path]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (settingsOpen || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const command = event.ctrlKey || event.metaKey;
      const item = selectedId ? items.find((candidate) => candidate.id === selectedId) : null;
      if (command && event.key.toLowerCase() === 'c' && item) {
        event.preventDefault();
        setDeckClipboard(item, location.path, false);
      } else if (command && event.key.toLowerCase() === 'x' && item) {
        event.preventDefault();
        setDeckClipboard(item, location.path, true);
      } else if (command && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        const position = selectedId
          ? findFirstEmptyPosition(items)
          : (selectedPosition ?? findFirstEmptyPosition(items));
        void pasteAt(position);
      } else if (event.key === 'Delete' && item) {
        event.preventDefault();
        void removeDeckItem(item);
      } else if (event.key === 'F2' && item) {
        event.preventDefault();
        setFocusField(null);
        requestAnimationFrame(() => setFocusField('label'));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, location.path, pasteAt, removeDeckItem, selectedId, selectedPosition, settingsOpen]);

  if (!config) return <main className="editor-app loading">편집기를 불러오는 중입니다...</main>;

  const menuItems: ContextMenuItem[] = menu?.item
    ? [
        {
          label: '편집',
          onSelect: () => {
            selectItem(menu.item!.id, menu.position);
            setFocusField('label');
          },
        },
        { label: '복사', shortcut: 'Ctrl+C', onSelect: () => setDeckClipboard(menu.item!, location.path, false) },
        { label: '잘라내기', shortcut: 'Ctrl+X', onSelect: () => setDeckClipboard(menu.item!, location.path, true) },
        { label: '복제', onSelect: () => void window.api.deck.duplicate({ path: location.path, id: menu.item!.id }) },
        { label: '아이콘 변경', onSelect: () => selectItem(menu.item!.id, menu.position) },
        {
          label: '위치 열기',
          disabled: menu.item.kind === 'folder' || menu.item.type === 'url' || menu.item.type === 'uwp',
          onSelect: () => menu.item?.kind === 'action' && void window.api.shell.reveal(menu.item.target),
        },
        { separator: true },
        { label: '삭제', shortcut: 'Delete', danger: true, onSelect: () => void removeDeckItem(menu.item!) },
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
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragCancel={() => void handleDragCancel()}
    >
      <main className={`editor-app theme-${config.theme}`}>
        <section className="editor-workspace">
          <div className="deck-editor">
            <header className="editor-location">
              <Breadcrumb
                root={config.root}
                path={location.path}
                onNavigate={(depth) => {
                  setLocation({ path: location.path.slice(0, depth), page: 0 });
                  setSelectedId(null);
                }}
              />
              <PageDots
                count={pageCount}
                page={location.page}
                onChange={(page) => setLocation({ ...location, page })}
              />
            </header>
            <KeyGrid
              config={config}
              items={items}
              path={location.path}
              page={location.page}
              selectedId={selectedId}
              selectedPosition={selectedPosition}
              highlightedFolderId={highlightedFolderId}
              onOsDrop={(event) => void handleOsDrop(event)}
              onContextItem={(event, item) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, item, position: item.position });
              }}
              onContextEmpty={(event, position) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, item: null, position });
              }}
              onSelectItem={selectItem}
              onSelectEmpty={(position) => {
                setSelectedId(null);
                setSelectedPosition(position);
              }}
              onEnterFolder={(id) => {
                setLocation({ path: [...location.path, id], page: 0 });
                setSelectedId(null);
                setSelectedPosition(null);
              }}
              onBack={() => {
                setLocation({ path: location.path.slice(0, -1), page: 0 });
                setSelectedId(null);
              }}
            />
            <TrashZone visible={activeDrag?.source === 'grid'} />
            <p className="editor-hint">빈 키를 선택하거나 오른쪽 액션을 끌어다 놓으세요.</p>
          </div>
          <ActionLibrary onAdd={(entry) => void addEntry(entry)} />
        </section>
        <PropertiesPanel
          key={selectedItem?.id ?? 'no-selection'}
          item={selectedItem}
          path={location.path}
          focusField={focusField}
          onSaved={saved}
          onDelete={() => {
            if (!selectedId) return;
            void window.api.deck.remove({ path: location.path, id: selectedId }).then(() => {
              setSelectedId(null);
              setSelectedPosition(null);
            });
          }}
          onDuplicate={() => {
            if (selectedId) void window.api.deck.duplicate({ path: location.path, id: selectedId });
          }}
        />
        <button className="settings-button" type="button" onClick={() => setSettingsOpen(true)}>
          설정
        </button>
        <SettingsModal open={settingsOpen} config={config} onClose={() => setSettingsOpen(false)} />
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}
        {dndMessage && (
          <div className="dnd-message" role="status">
            <span>{dndMessage}</span>
            <button type="button" onClick={() => setDndMessage(null)} aria-label="알림 닫기">✕</button>
          </div>
        )}
        <Toast />
      </main>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
        {activeDrag ? <DragPreview data={activeDrag} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
