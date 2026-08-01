import { useCallback, useEffect, useMemo, useState } from 'react';
import { findFirstEmptyPosition, getPageCount } from '../../../shared/layout';
import { findItemAtPath, getItemsAtPath } from '../../../shared/tree';
import type { DeckItem, LibraryEntry } from '../../../shared/types';
import { Breadcrumb } from '../common/Breadcrumb';
import { PageDots } from '../common/PageDots';
import { Toast } from '../common/Toast';
import { useConfig } from '../hooks/useConfig';
import { useDeckStore } from '../store/deckStore';
import { ActionLibrary } from './ActionLibrary';
import { KeyGrid } from './KeyGrid';
import { PropertiesPanel } from './PropertiesPanel';

interface FocusSlotPayload {
  path?: string[];
  slot?: number;
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

export function EditorApp() {
  const config = useConfig();
  const location = useDeckStore((state) => state.location);
  const setLocation = useDeckStore((state) => state.setLocation);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<number | null>(null);
  const [focusField, setFocusField] = useState<'label' | 'target' | null>(null);
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

  const addEntry = async (entry: LibraryEntry) => {
    if (!config) return;
    const position = selectedId ? findFirstEmptyPosition(items) : (selectedPosition ?? findFirstEmptyPosition(items));
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
        target: '',
        args: [],
        icon: { kind: 'emoji', value: entry.emoji },
        color: '#5B8CFF',
        position,
      };
    } else {
      return;
    }
    await window.api.deck.upsert({ path: location.path, item });
    setSelectedId(item.id);
    setSelectedPosition(item.position);
    setFocusField(item.kind === 'folder' ? 'label' : item.type === 'url' ? 'target' : null);

    if (item.kind === 'action' && ['folder', 'file', 'app'].includes(item.type)) {
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
      if (updated !== item) await window.api.deck.upsert({ path: location.path, item: updated });
    }
  };

  const selectItem = (id: string, position: number) => {
    setSelectedId(id);
    setSelectedPosition(position);
    setFocusField(null);
  };
  const saved = useCallback((item: DeckItem) => setSelectedId(item.id), []);

  if (!config) return <main className="editor-app loading">편집기를 불러오는 중입니다...</main>;

  return (
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
          <p className="editor-hint">빈 키를 선택한 뒤 오른쪽 액션을 누르면 추가됩니다.</p>
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
      <button className="settings-button" type="button" disabled>
        설정
      </button>
      <Toast />
    </main>
  );
}
