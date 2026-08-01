import { useDroppable } from '@dnd-kit/core';
import type { DropData } from './dndTypes';

export function TrashZone({ visible }: { visible: boolean }) {
  const data: DropData = { target: 'trash' };
  const { setNodeRef, isOver } = useDroppable({ id: 'trash-zone', data });
  if (!visible) return null;
  return (
    <div ref={setNodeRef} className={`trash-zone ${isOver ? 'active' : ''}`}>
      <span aria-hidden="true">🗑️</span>
      여기로 끌어 삭제
    </div>
  );
}
