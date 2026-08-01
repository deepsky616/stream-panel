import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      x: Math.max(6, Math.min(x, window.innerWidth - rect.width - 6)),
      y: Math.max(6, Math.min(y, window.innerHeight - rect.height - 6)),
    });
  }, [x, y]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: position.x, top: position.y }}>
      {items.map((item, index) =>
        item.separator ? (
          <hr key={index} />
        ) : (
          <button
            key={`${item.label}-${index}`}
            className={item.danger ? 'danger' : ''}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => { item.onSelect?.(); onClose(); }}
          >
            <span>{item.label}</span>
            {item.shortcut && <small>{item.shortcut}</small>}
          </button>
        ),
      )}
    </div>
  );
}
