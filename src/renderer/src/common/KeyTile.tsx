import type { DeckItem } from '../../../shared/types';

interface KeyTileProps {
  item: DeckItem;
  buttonSize: number;
  onClick: () => void;
  onDoubleClick?: () => void;
}

function iconText(item: DeckItem): string {
  if (item.icon.kind === 'emoji' || item.icon.kind === 'letter') return item.icon.value;
  if (item.kind === 'folder') return '🗂️';
  if (item.type === 'url') return '🔗';
  if (item.type === 'folder') return '📁';
  if (item.type === 'file') return '📄';
  return '🖥️';
}

export function KeyTile({ item, buttonSize, onClick, onDoubleClick }: KeyTileProps) {
  return (
    <button
      className={`key-tile ${item.kind === 'folder' ? 'folder-tile' : ''}`}
      style={{
        width: buttonSize,
        height: buttonSize,
        '--item-color': item.color,
        '--button-size': `${buttonSize}px`,
      } as React.CSSProperties}
      type="button"
      title={item.label}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-label={item.kind === 'folder' ? `${item.label} 폴더 열기` : `${item.label} 실행`}
    >
      <span className="key-icon" aria-hidden="true">
        {iconText(item)}
      </span>
      <span className="key-label">{item.label}</span>
      {item.kind === 'folder' && <span className="folder-badge">▸</span>}
    </button>
  );
}
