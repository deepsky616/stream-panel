import { getPageSlots } from '../../../shared/layout';
import type { AppConfig, DeckItem } from '../../../shared/types';
import { BackTile } from '../common/BackTile';
import { EmptyTile } from '../common/EmptyTile';
import { KeyTile } from '../common/KeyTile';

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
}: KeyGridProps) {
  const slots = getPageSlots(items, config.grid, page, path.length > 0);
  return (
    <div
      className="editor-grid"
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
            <div
              key={slot.position}
              className={selectedPosition === slot.position ? 'grid-selection' : ''}
            >
              <EmptyTile
                buttonSize={size}
                locked={false}
                onClick={() => onSelectEmpty(slot.position)}
              />
            </div>
          );
        }
        return (
          <div
            key={slot.item.id}
            className={selectedId === slot.item.id ? 'grid-selection' : ''}
          >
            <KeyTile
              item={slot.item}
              buttonSize={size}
              onClick={() => onSelectItem(slot.item.id, slot.position)}
              onDoubleClick={() => slot.item.kind === 'folder' && onEnterFolder(slot.item.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
