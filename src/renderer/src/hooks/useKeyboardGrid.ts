import { useEffect, useRef } from 'react';

export function useKeyboardGrid(columns: number, signature: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('.key-tile');
    buttons?.forEach((button, index) => {
      button.tabIndex = index === 0 ? 0 : -1;
    });
  }, [columns, signature]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('.key-tile') ?? [],
    );
    const current = buttons.findIndex((button) => button === document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    let next = current;
    if (event.key === 'ArrowLeft') next -= 1;
    if (event.key === 'ArrowRight') next += 1;
    if (event.key === 'ArrowUp') next -= columns;
    if (event.key === 'ArrowDown') next += columns;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    next = Math.max(0, Math.min(buttons.length - 1, next));
    buttons.forEach((button, index) => {
      button.tabIndex = index === next ? 0 : -1;
    });
    buttons[next]?.focus();
  };

  return { ref, onKeyDown };
}
