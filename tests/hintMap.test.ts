import { describe, expect, it } from 'vitest';
import { getPageSlots } from '../src/shared/layout';
import {
  assignHints,
  DEFAULT_HINT_KEYS,
  findHintByCode,
  getHintCode,
  normalizeHintKeys,
  validateHintKeys,
} from '../src/shared/hintMap';
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

describe('hint map', () => {
  it('skips empty slots and assigns hints in visible position order', () => {
    const slots = getPageSlots([item('first', 0), item('second', 3), item('third', 5)], grid, 0, false);
    const hints = assignHints(slots);

    expect(hints.map(({ itemId, hint }) => [itemId, hint])).toEqual([
      ['first', '1'],
      ['second', '2'],
      ['third', '3'],
    ]);
  });

  it('starts from the first hint again after page and folder changes', () => {
    const pageOne = getPageSlots([item('root-page-two', 6)], grid, 1, false);
    const folderPage = getPageSlots([item('folder-child', 0)], grid, 0, true);

    expect(assignHints(pageOne)[0]).toMatchObject({ itemId: 'root-page-two', hint: '1' });
    expect(assignHints(folderPage)).toHaveLength(1);
    expect(assignHints(folderPage)[0]).toMatchObject({ itemId: 'folder-child', hint: '1' });
  });

  it('never assigns a hint to the reserved back slot', () => {
    const slots = getPageSlots([], grid, 0, true);
    expect(slots[0].kind).toBe('back');
    expect(assignHints(slots)).toEqual([]);
  });

  it('limits a page to forty one-key hints', () => {
    const largeGrid: GridConfig = { cols: 8, rows: 6, buttonSize: 88, gap: 8 };
    const items = Array.from({ length: 48 }, (_, position) => item(String(position), position));
    const hints = assignHints(getPageSlots(items, largeGrid, 0, false));

    expect(DEFAULT_HINT_KEYS).toHaveLength(40);
    expect(hints).toHaveLength(40);
    expect(hints.at(-1)?.itemId).toBe('39');
  });

  it('rejects empty or duplicated custom hint characters and falls back to defaults', () => {
    expect(validateHintKeys('')).toBe(false);
    expect(validateHintKeys('1123')).toBe(false);
    expect(validateHintKeys('123qwe')).toBe(true);
    expect(normalizeHintKeys('1123')).toBe(DEFAULT_HINT_KEYS);
    expect(normalizeHintKeys('123qwe')).toBe('123qwe');
  });

  it('maps hint characters to physical keyboard codes', () => {
    expect(getHintCode('1')).toBe('Digit1');
    expect(getHintCode('q')).toBe('KeyQ');
    expect(getHintCode(';')).toBe('Semicolon');
    expect(getHintCode('/')).toBe('Slash');
    const slots = getPageSlots([item('target', 0)], grid, 0, false);
    expect(findHintByCode(assignHints(slots), 'Digit1')?.itemId).toBe('target');
    expect(findHintByCode(assignHints(slots), 'Numpad1')).toBeUndefined();
  });
});
