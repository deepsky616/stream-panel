import { describe, expect, it } from 'vitest';
import type { ActionItem, DeckItem, FolderItem } from '../src/shared/types';
import {
  cloneItemWithNewIds,
  duplicateItem,
  findItemAtPath,
  getItemsAtPath,
  moveItem,
  moveItemIntoFolder,
  shouldAdoptCurrentPlatform,
} from '../src/shared/tree';

function action(id: string, position: number): ActionItem {
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

function folder(id: string, position: number, children: DeckItem[] = []): FolderItem {
  return {
    id,
    kind: 'folder',
    label: id,
    icon: { kind: 'emoji', value: '📁' },
    color: '#5B8CFF',
    position,
    children,
  };
}

describe('tree', () => {
  it('finds nested paths and items', () => {
    const root = [folder('a', 0, [action('leaf', 0)])];
    expect(getItemsAtPath(root, ['a']).map(({ id }) => id)).toEqual(['leaf']);
    expect(findItemAtPath(root, ['a'], 'leaf')?.id).toBe('leaf');
  });

  it('moves to an empty slot and swaps occupied slots without mutating input', () => {
    const root = [action('a', 0), action('b', 2)];
    const moved = moveItem(root, { path: [], id: 'a' }, { path: [], position: 1 });
    expect(findItemAtPath(moved, [], 'a')?.position).toBe(1);
    expect(root[0].position).toBe(0);

    const swapped = moveItem(root, { path: [], id: 'a' }, { path: [], position: 2 });
    expect(findItemAtPath(swapped, [], 'a')?.position).toBe(2);
    expect(findItemAtPath(swapped, [], 'b')?.position).toBe(0);
  });

  it('moves an item into the first empty folder slot', () => {
    const root = [action('source', 0), folder('target', 1, [action('inside', 0)])];
    const moved = moveItemIntoFolder(root, { path: [], id: 'source' }, [], 'target');
    expect(findItemAtPath(moved, ['target'], 'source')?.position).toBe(1);
    expect(findItemAtPath(moved, [], 'source')).toBeUndefined();
  });

  it('rejects a folder moving into its own descendant', () => {
    const root = [folder('parent', 0, [folder('child', 0)])];
    expect(() =>
      moveItem(root, { path: [], id: 'parent' }, { path: ['parent', 'child'], position: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'CYCLE' }));
  });

  it('rejects nesting deeper than five folders', () => {
    const root = [
      folder('a', 0, [folder('b', 0, [folder('c', 0, [folder('d', 0)])])]),
      folder('moving', 1, [folder('nested', 0)]),
    ];
    expect(() =>
      moveItem(root, { path: [], id: 'moving' }, { path: ['a', 'b', 'c', 'd'], position: 0 }),
    ).toThrowError(expect.objectContaining({ code: 'MAX_DEPTH' }));
  });

  it('deep-copies folders and assigns every descendant a new id', () => {
    const source = folder('folder', 0, [action('child', 0), folder('nested', 1)]);
    const ids = ['new-folder', 'new-child', 'new-nested'];
    const copy = cloneItemWithNewIds(source, () => ids.shift()!);
    expect(copy.id).toBe('new-folder');
    expect(copy.kind === 'folder' ? copy.children.map(({ id }) => id) : []).toEqual([
      'new-child',
      'new-nested',
    ]);

    const duplicated = duplicateItem([source], [], source.id, () => 'duplicate');
    expect(duplicated).toHaveLength(2);
    expect(duplicated[1].position).toBe(1);
  });

  it('assigns new step ids when cloning a multi action', () => {
    const source = action('multi', 0);
    source.type = 'multi';
    source.target = '';
    source.multiAction = {
      steps: [
        { id: 'action-step', kind: 'action', actionId: 'target' },
        { id: 'delay-step', kind: 'delay', delayMs: 500 },
      ],
    };
    const ids = ['new-item', 'new-action-step', 'new-delay-step'];

    const copy = cloneItemWithNewIds(source, () => ids.shift()!);

    expect(copy.id).toBe('new-item');
    expect(copy.kind === 'action' ? copy.multiAction?.steps : []).toEqual([
      { id: 'new-action-step', kind: 'action', actionId: 'target' },
      { id: 'new-delay-step', kind: 'delay', delayMs: 500 },
    ]);
  });

  it('adopts the current platform only when an action target is newly selected or changed', () => {
    const previous = action('item', 0);
    expect(shouldAdoptCurrentPlatform(previous, { ...previous, label: '새 이름' })).toBe(false);
    expect(
      shouldAdoptCurrentPlatform(previous, { ...previous, target: 'https://changed.example.com' }),
    ).toBe(true);
    expect(shouldAdoptCurrentPlatform(undefined, { ...previous, target: '' })).toBe(false);
    expect(shouldAdoptCurrentPlatform(undefined, previous)).toBe(true);
    expect(shouldAdoptCurrentPlatform(previous, folder('folder', 0))).toBe(false);
  });
});
