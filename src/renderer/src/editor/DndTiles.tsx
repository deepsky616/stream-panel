import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { DeckItem } from '../../../shared/types';
import { EmptyTile } from '../common/EmptyTile';
import { KeyTile } from '../common/KeyTile';
import type { DragData, DropData } from './dndTypes';

interface DraggableDeckTileProps {
  item: DeckItem;
  path: string[];
  size: number;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onEnterFolder: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

export function DraggableDeckTile({
  item,
  path,
  size,
  selected,
  highlighted,
  onSelect,
  onEnterFolder,
  onContextMenu,
}: DraggableDeckTileProps) {
  const dragData: DragData = { source: 'grid', path, item };
  const dropData: DropData =
    item.kind === 'folder'
      ? { target: 'folder', path, id: item.id }
      : { target: 'slot', path, position: item.position, occupiedId: item.id };
  const draggable = useDraggable({ id: `grid:${item.id}`, data: dragData });
  const droppable = useDroppable({ id: `target:${item.id}`, data: dropData });
  const setNodeRef = (node: HTMLElement | null) => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  return (
    <div
      ref={setNodeRef}
      className={`${selected ? 'grid-selection' : ''} ${highlighted ? 'folder-drop-ready' : ''}`}
      style={{ opacity: draggable.isDragging ? 0.35 : 1 }}
      data-item-id={item.id}
      data-position={item.position}
      onContextMenu={onContextMenu}
      {...draggable.attributes}
      {...draggable.listeners}
    >
      <KeyTile
        item={item}
        buttonSize={size}
        onClick={onSelect}
        onDoubleClick={() => item.kind === 'folder' && onEnterFolder()}
      />
    </div>
  );
}

interface DroppableEmptyTileProps {
  path: string[];
  position: number;
  size: number;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

export function DroppableEmptyTile({
  path,
  position,
  size,
  selected,
  onSelect,
  onContextMenu,
}: DroppableEmptyTileProps) {
  const data: DropData = { target: 'slot', path, position };
  const { setNodeRef, isOver } = useDroppable({ id: `empty:${path.join('/')}:${position}`, data });
  return (
    <div
      ref={setNodeRef}
      className={`${selected ? 'grid-selection' : ''} ${isOver ? 'slot-drop-ready' : ''}`}
      data-position={position}
      onContextMenu={onContextMenu}
    >
      <EmptyTile buttonSize={size} locked={false} onClick={onSelect} />
    </div>
  );
}
