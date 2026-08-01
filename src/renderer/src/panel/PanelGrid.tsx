import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import { getPageSlots } from '../../../shared/layout';
import { assignHints } from '../../../shared/hintMap';
import type { AppConfig, DeckItem } from '../../../shared/types';
import { BackTile } from '../common/BackTile';
import { EmptyTile } from '../common/EmptyTile';
import { KeyTile } from '../common/KeyTile';
import { useKeyboardGrid } from '../hooks/useKeyboardGrid';

interface PanelGridProps {
  config: AppConfig;
  items: DeckItem[];
  path: string[];
  page: number;
  onEnterFolder: (id: string) => void;
  onBack: () => void;
  onContextItem: (event: React.MouseEvent, item: DeckItem) => void;
  onContextEmpty: (event: React.MouseEvent, position: number) => void;
  showHints: boolean;
}

function PanelItem({
  item,
  size,
  locked,
  failed,
  hint,
  onClick,
  onContextMenu,
}: {
  item: DeckItem;
  size: number;
  locked: boolean;
  failed: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  hint?: string;
}) {
  const drag = useDraggable({ id: `panel-item:${item.id}`, data: { id: item.id }, disabled: locked });
  const drop = useDroppable({ id: `panel-target:${item.id}`, data: { position: item.position }, disabled: locked });
  const setNodeRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  return (
    <div
      ref={setNodeRef}
      data-item-id={item.id}
      data-position={item.position}
      style={{ opacity: drag.isDragging ? 0.35 : 1 }}
      onContextMenu={onContextMenu}
      {...drag.attributes}
      {...drag.listeners}
    >
      <KeyTile item={item} buttonSize={size} onClick={onClick} failed={failed} hint={hint} />
    </div>
  );
}

function PanelEmpty({
  position,
  size,
  locked,
  onClick,
  onContextMenu,
}: {
  position: number;
  size: number;
  locked: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `panel-empty:${position}`,
    data: { position },
    disabled: locked,
  });
  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'panel-drop-ready' : ''}
      data-position={position}
      onContextMenu={onContextMenu}
    >
      <EmptyTile buttonSize={size} locked={locked} onClick={onClick} />
    </div>
  );
}

export function PanelGrid({
  config,
  items,
  path,
  page,
  onEnterFolder,
  onBack,
  onContextItem,
  onContextEmpty,
  showHints,
}: PanelGridProps) {
  const slots = getPageSlots(items, config.grid, page, path.length > 0);
  const hints = new Map(
    assignHints(slots, config.keyboard.hintKeys).map((assignment) => [
      assignment.itemId,
      assignment.hint,
    ]),
  );
  const signature = slots.map((slot) => slot.kind === 'item' ? slot.item.id : `${slot.kind}:${slot.slot}`).join('|');
  const { ref: gridRef, onKeyDown: handleGridKeyDown } = useKeyboardGrid(config.grid.cols, signature);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }));
  const [failedId, setFailedId] = useState<string | null>(null);
  useEffect(() => {
    if (!failedId) return;
    const timer = setTimeout(() => setFailedId(null), 560);
    return () => clearTimeout(timer);
  }, [failedId]);

  const move = ({ active, over }: DragEndEvent) => {
    if (config.window.locked || !over) return;
    const id = active.data.current?.id;
    const position = over.data.current?.position;
    if (typeof id !== 'string' || !Number.isInteger(position)) return;
    void window.api.deck.move({ from: { path, id }, to: { path, position: Number(position) } });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={move}>
      <div
        ref={gridRef}
        className="panel-grid"
        onKeyDown={handleGridKeyDown}
        style={{
          gridTemplateColumns: `repeat(${config.grid.cols}, ${config.grid.buttonSize}px)`,
          gap: config.grid.gap,
          padding: config.grid.gap,
        }}
      >
        {slots.map((slot) => {
          if (slot.kind === 'back') {
            return <BackTile key="back" buttonSize={config.grid.buttonSize} onClick={onBack} />;
          }
          if (slot.kind === 'empty') {
            return (
              <PanelEmpty
                key={slot.position}
                position={slot.position}
                size={config.grid.buttonSize}
                locked={config.window.locked}
                onClick={() => void window.api.editor.open({ path, slot: slot.position })}
                onContextMenu={(event) => onContextEmpty(event, slot.position)}
              />
            );
          }
          const onClick = async (keepOpen: boolean) => {
            if (slot.item.kind === 'folder') onEnterFolder(slot.item.id);
            else {
              const result = await window.api.button.launch({
                path,
                id: slot.item.id,
                ...(keepOpen ? { keepOpen: true } : {}),
              });
              if (!result.ok) setFailedId(slot.item.id);
            }
          };
          return (
            <PanelItem
              key={slot.item.id}
              item={slot.item}
              size={config.grid.buttonSize}
              locked={config.window.locked}
              failed={failedId === slot.item.id}
              hint={showHints ? hints.get(slot.item.id) : undefined}
              onClick={(event) => void onClick(event.shiftKey)}
              onContextMenu={(event) => onContextItem(event, slot.item)}
            />
          );
        })}
      </div>
    </DndContext>
  );
}
