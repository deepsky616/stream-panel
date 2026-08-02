import { useEffect, useState } from 'react';
import type { DeckItem } from '../../../shared/types';

interface KeyTileProps {
  item: DeckItem;
  buttonSize: number;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick?: () => void;
  failed?: boolean;
  hint?: string;
  hintMuted?: boolean;
}

function iconText(item: DeckItem): string {
  if (item.icon.kind === 'emoji' || item.icon.kind === 'letter') return item.icon.value;
  if (item.kind === 'folder') return '🗂️';
  if (item.type === 'url') return '🔗';
  if (item.type === 'folder') return '📁';
  if (item.type === 'file') return '📄';
  return '🖥️';
}

export function KeyTile({
  item,
  buttonSize,
  onClick,
  onDoubleClick,
  failed = false,
  hint,
  hintMuted = false,
}: KeyTileProps) {
  const requestType =
    item.icon.kind === 'file'
      ? ('file' as const)
      : item.icon.kind === 'auto' && item.kind === 'action' && item.target
        ? item.type
        : null;
  const requestTarget =
    item.icon.kind === 'file'
      ? `icon-file:${item.icon.path}`
      : item.icon.kind === 'auto' && item.kind === 'action'
        ? item.target
        : '';
  const requestKey = requestType ? `${requestType}:${requestTarget}` : '';
  const [iconResult, setIconResult] = useState<{ key: string; data: string | null } | null>(null);
  const resolvedIcon = iconResult?.key === requestKey ? iconResult.data : null;
  useEffect(() => {
    let active = true;
    if (!requestType || !requestTarget) return;
    void window.api.icon
      .resolve({ type: requestType, target: requestTarget })
      .then((data) => active && setIconResult({ key: requestKey, data }));
    return () => {
      active = false;
    };
  }, [requestKey, requestTarget, requestType]);
  return (
    <button
      className={`key-tile ${item.kind === 'folder' ? 'folder-tile' : ''} ${failed ? 'launch-failed' : ''}`}
      style={{
        width: buttonSize,
        height: buttonSize,
        '--item-color': item.color,
        '--button-size': `${buttonSize}px`,
      } as React.CSSProperties}
      type="button"
      title={item.kind === 'action' ? `${item.label}\nShift+클릭: 패널 유지` : item.label}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-label={item.kind === 'folder' ? `${item.label} 폴더 열기` : `${item.label} 실행`}
    >
      {hint && <span className={`key-hint ${hintMuted ? 'muted' : ''}`}>{hint}</span>}
      <span className="key-icon" aria-hidden="true">
        {resolvedIcon ? <img src={resolvedIcon} alt="" /> : iconText(item)}
      </span>
      <span className="key-label">{item.label}</span>
      {item.kind === 'folder' && <span className="folder-badge">▸</span>}
    </button>
  );
}
