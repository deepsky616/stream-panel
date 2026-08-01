import type { DeckItem, GridConfig } from './types';

export type DeckSlot =
  | { kind: 'back'; slot: number; position: null }
  | { kind: 'empty'; slot: number; position: number }
  | { kind: 'item'; slot: number; position: number; item: DeckItem };

export function getCapacity(grid: Pick<GridConfig, 'cols' | 'rows'>): number {
  return grid.cols * grid.rows;
}

export function slotToPosition(
  page: number,
  slot: number,
  capacity: number,
  insideFolder: boolean,
): number | null {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(slot) || slot < 0 || slot >= capacity) {
    throw new RangeError('Invalid page or slot');
  }
  if (insideFolder && page === 0 && slot === 0) return null;
  return page * capacity + slot - (insideFolder ? 1 : 0);
}

export function positionToSlot(
  position: number,
  capacity: number,
  insideFolder: boolean,
): { page: number; slot: number } {
  if (!Number.isInteger(position) || position < 0) throw new RangeError('Invalid position');
  const visibleIndex = position + (insideFolder ? 1 : 0);
  return {
    page: Math.floor(visibleIndex / capacity),
    slot: visibleIndex % capacity,
  };
}

export function getPageCount(
  items: readonly Pick<DeckItem, 'position'>[],
  grid: Pick<GridConfig, 'cols' | 'rows'>,
  insideFolder: boolean,
): number {
  if (items.length === 0) return 1;
  const capacity = getCapacity(grid);
  const maxPosition = Math.max(...items.map((item) => item.position));
  if (maxPosition < 0) return 1;
  return positionToSlot(maxPosition, capacity, insideFolder).page + 1;
}

export function getPageSlots(
  items: readonly DeckItem[],
  grid: Pick<GridConfig, 'cols' | 'rows'>,
  page: number,
  insideFolder: boolean,
): DeckSlot[] {
  const capacity = getCapacity(grid);
  const byPosition = new Map(items.map((item) => [item.position, item]));
  return Array.from({ length: capacity }, (_, slot): DeckSlot => {
    const position = slotToPosition(page, slot, capacity, insideFolder);
    if (position === null) return { kind: 'back', slot, position: null };
    const item = byPosition.get(position);
    return item
      ? { kind: 'item', slot, position, item }
      : { kind: 'empty', slot, position };
  });
}

export function findFirstEmptyPosition(
  items: readonly Pick<DeckItem, 'position'>[],
  startPosition = 0,
): number {
  const occupied = new Set(items.map((item) => item.position).filter((position) => position >= 0));
  let position = Math.max(0, startPosition);
  while (occupied.has(position)) position += 1;
  return position;
}

export function hasDamagedPositions(items: readonly Pick<DeckItem, 'position'>[]): boolean {
  const seen = new Set<number>();
  return items.some(({ position }) => {
    const damaged = !Number.isInteger(position) || position < 0 || seen.has(position);
    seen.add(position);
    return damaged;
  });
}

export function normalizePositions<T extends Pick<DeckItem, 'position'>>(items: readonly T[]): T[] {
  if (!hasDamagedPositions(items)) return items.map((item) => ({ ...item }));
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftPosition = left.item.position < 0 ? Number.MAX_SAFE_INTEGER : left.item.position;
      const rightPosition = right.item.position < 0 ? Number.MAX_SAFE_INTEGER : right.item.position;
      return leftPosition - rightPosition || left.index - right.index;
    })
    .map(({ item }, position) => ({ ...item, position }));
}

export function normalizeDeckPositions(items: readonly DeckItem[]): {
  items: DeckItem[];
  repaired: boolean;
} {
  const repairedHere = hasDamagedPositions(items);
  const positioned = normalizePositions(items);
  let repairedBelow = false;
  const normalized = positioned.map((item): DeckItem => {
    if (item.kind !== 'folder') return item;
    const childResult = normalizeDeckPositions(item.children);
    repairedBelow ||= childResult.repaired;
    return { ...item, children: childResult.items };
  });
  return { items: normalized, repaired: repairedHere || repairedBelow };
}
