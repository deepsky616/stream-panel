import { describe, expect, it } from 'vitest';
import {
  findFirstEmptyPosition,
  getPageCount,
  getPageSlots,
  normalizePositions,
  positionToSlot,
  slotToPosition,
} from '../src/shared/layout';
import type { DeckItem, GridConfig } from '../src/shared/types';

const grid: GridConfig = { cols: 3, rows: 2, buttonSize: 88, gap: 8 };

function item(id: string, position: number): DeckItem {
  return {
    id,
    kind: 'action',
    type: 'url',
    target: 'https://example.com',
    args: [],
    label: id,
    icon: { kind: 'auto' },
    color: '#5B8CFF',
    position,
  };
}

describe('layout', () => {
  it('maps root slots directly to global positions', () => {
    expect(slotToPosition(1, 2, 6, false)).toBe(8);
    expect(positionToSlot(8, 6, false)).toEqual({ page: 1, slot: 2 });
  });

  it('reserves the first folder slot and applies the offset on later pages', () => {
    expect(slotToPosition(0, 0, 6, true)).toBeNull();
    expect(slotToPosition(0, 1, 6, true)).toBe(0);
    expect(slotToPosition(1, 0, 6, true)).toBe(5);
    expect(positionToSlot(5, 6, true)).toEqual({ page: 1, slot: 0 });
  });

  it('keeps empty slots and removes a fully empty trailing page', () => {
    const items = [item('첫째', 0), item('간격', 7)];
    expect(getPageCount(items, grid, false)).toBe(2);
    expect(getPageSlots(items, grid, 0, false)[1]).toMatchObject({ kind: 'empty', position: 1 });
    expect(getPageCount(items.slice(0, 1), grid, false)).toBe(1);
  });

  it('calculates folder pages with the back slot capacity reduction', () => {
    expect(getPageCount(Array.from({ length: 5 }, (_, index) => item(String(index), index)), grid, true)).toBe(1);
    expect(getPageCount(Array.from({ length: 6 }, (_, index) => item(String(index), index)), grid, true)).toBe(2);
  });

  it('finds the next empty position without compacting gaps', () => {
    expect(findFirstEmptyPosition([item('a', 0), item('b', 2)])).toBe(1);
    expect(findFirstEmptyPosition([item('a', 0), item('b', 2)], 2)).toBe(3);
  });

  it('normalizes duplicated and negative positions from the front', () => {
    const normalized = normalizePositions([item('뒤', 4), item('중복', 4), item('음수', -1)]);
    expect(normalized.map(({ position }) => position)).toEqual([0, 1, 2]);
    expect(normalized.map(({ id }) => id)).toEqual(['뒤', '중복', '음수']);
  });
});
