import { getPageSlots } from '../../../shared/layout';
import type { AppConfig, DeckItem } from '../../../shared/types';
import { BackTile } from '../common/BackTile';
import { DraggableDeckTile, DroppableEmptyTile } from './DndTiles';

interface KeyGridProps {
  config: AppConfig;
  items: DeckItem[];
  path: string[];
  page: number;
  selectedId: string | null;
  selectedPosition: number | null;
  onSelectItem: (id: string, position: number) => void;
  onSelectEmpty: (position: number) => void;
  onEnterFolder: (id: string) => void;
  onBack: () => void;
  highlightedFolderId: string | null;
  onOsDrop: (event: React.DragEvent<HTMLDivElement>) => void;
}

export function KeyGrid({
  config,
  items,
  path,
  page,
  selectedId,
  selectedPosition,
  onSelectItem,
  onSelectEmpty,
  onEnterFolder,
  onBack,
  highlightedFolderId,
  onOsDrop,
}: KeyGridProps) {
  const slots = getPageSlots(items, config.grid, page, path.length > 0);
  return (
    <div
      className="editor-grid"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onOsDrop(event);
      }}
      style={{
        gridTemplateColumns: `repeat(${config.grid.cols}, minmax(48px, ${config.grid.buttonSize}px))`,
        gap: config.grid.gap,
      }}
    >
      {slots.map((slot) => {
        const size = Math.min(config.grid.buttonSize, 96);
        if (slot.kind === 'back') return <BackTile key="back" buttonSize={size} onClick={onBack} />;
        if (slot.kind === 'empty') {
          return (
            <DroppableEmptyTile
              key={slot.position}
              path={path}
              position={slot.position}
              size={size}
              selected={selectedPosition === slot.position}
              onSelect={() => onSelectEmpty(slot.position)}
            />
          );
        }
        return (
          <DraggableDeckTile
            key={slot.item.id}
            item={slot.item}
            path={path}
            size={size}
            selected={selectedId === slot.item.id}
            highlighted={highlightedFolderId === slot.item.id}
            onSelect={() => onSelectItem(slot.item.id, slot.position)}
            onEnterFolder={() => onEnterFolder(slot.item.id)}
          />
        );
      })}
    </div>
  );
}
