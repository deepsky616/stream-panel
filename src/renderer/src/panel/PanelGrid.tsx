import { getPageSlots } from '../../../shared/layout';
import type { AppConfig, DeckItem } from '../../../shared/types';
import { BackTile } from '../common/BackTile';
import { EmptyTile } from '../common/EmptyTile';
import { KeyTile } from '../common/KeyTile';

interface PanelGridProps {
  config: AppConfig;
  items: DeckItem[];
  path: string[];
  page: number;
  onEnterFolder: (id: string) => void;
  onBack: () => void;
}

export function PanelGrid({ config, items, path, page, onEnterFolder, onBack }: PanelGridProps) {
  const slots = getPageSlots(items, config.grid, page, path.length > 0);
  return (
    <div
      className="panel-grid"
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
            <EmptyTile
              key={slot.position}
              buttonSize={config.grid.buttonSize}
              locked={config.window.locked}
              onClick={() => void window.api.editor.open({ path, slot: slot.position })}
            />
          );
        }
        const onClick = () => {
          if (slot.item.kind === 'folder') onEnterFolder(slot.item.id);
          else void window.api.button.launch({ path, id: slot.item.id });
        };
        return (
          <KeyTile
            key={slot.item.id}
            item={slot.item}
            buttonSize={config.grid.buttonSize}
            onClick={onClick}
          />
        );
      })}
    </div>
  );
}
