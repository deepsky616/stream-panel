import { findFirstEmptyPosition } from './layout';
import type { DeckItem, FolderItem } from './types';

export type TreeErrorCode = 'PATH_NOT_FOUND' | 'ITEM_NOT_FOUND' | 'CYCLE' | 'MAX_DEPTH';

export class TreeError extends Error {
  constructor(
    public readonly code: TreeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TreeError';
  }
}

export interface ItemReference {
  path: string[];
  id: string;
}

export interface ItemDestination {
  path: string[];
  position: number;
}

export function getItemsAtPath(root: readonly DeckItem[], path: readonly string[]): DeckItem[] {
  let items = root as readonly DeckItem[];
  for (const folderId of path) {
    const folder = items.find(
      (item): item is FolderItem => item.id === folderId && item.kind === 'folder',
    );
    if (!folder) throw new TreeError('PATH_NOT_FOUND', 'Folder path was not found');
    items = folder.children;
  }
  return items as DeckItem[];
}

export function findItemAtPath(
  root: readonly DeckItem[],
  path: readonly string[],
  id: string,
): DeckItem | undefined {
  return getItemsAtPath(root, path).find((item) => item.id === id);
}

export function shouldAdoptCurrentPlatform(
  previous: DeckItem | undefined,
  next: DeckItem,
): boolean {
  if (next.kind !== 'action' || next.target.length === 0) return false;
  return previous?.kind !== 'action' || previous.target !== next.target;
}

export function getFolderDepth(item: DeckItem): number {
  if (item.kind !== 'folder') return 0;
  return 1 + Math.max(0, ...item.children.map(getFolderDepth));
}

export function countDeckItems(items: readonly DeckItem[]): number {
  return items.reduce(
    (count, item) => count + 1 + (item.kind === 'folder' ? countDeckItems(item.children) : 0),
    0,
  );
}

function cloneRoot(root: readonly DeckItem[]): DeckItem[] {
  return structuredClone(root) as DeckItem[];
}

export function upsertItem(
  root: readonly DeckItem[],
  path: readonly string[],
  item: DeckItem,
): DeckItem[] {
  const cloned = cloneRoot(root);
  const items = getItemsAtPath(cloned, path);
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) items[index] = structuredClone(item) as DeckItem;
  else items.push(structuredClone(item) as DeckItem);
  return cloned;
}

export function removeItem(
  root: readonly DeckItem[],
  path: readonly string[],
  id: string,
): DeckItem[] {
  const cloned = cloneRoot(root);
  const items = getItemsAtPath(cloned, path);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new TreeError('ITEM_NOT_FOUND', 'Item was not found');
  items.splice(index, 1);
  return cloned;
}

export function moveItem(
  root: readonly DeckItem[],
  from: ItemReference,
  to: ItemDestination,
  maxDepth = 5,
): DeckItem[] {
  const source = findItemAtPath(root, from.path, from.id);
  if (!source) throw new TreeError('ITEM_NOT_FOUND', 'Item was not found');
  getItemsAtPath(root, to.path);

  if (source.kind === 'folder' && to.path.includes(source.id)) {
    throw new TreeError('CYCLE', 'A folder cannot be moved into itself');
  }
  if (to.path.length + getFolderDepth(source) > maxDepth) {
    throw new TreeError('MAX_DEPTH', 'Folder nesting limit exceeded');
  }

  const cloned = cloneRoot(root);
  const sourceItems = getItemsAtPath(cloned, from.path);
  const sourceIndex = sourceItems.findIndex((item) => item.id === from.id);
  const sourceItem = sourceItems[sourceIndex];
  const sourcePosition = sourceItem.position;
  const samePath = from.path.length === to.path.length && from.path.every((id, i) => id === to.path[i]);
  const destinationItems = samePath ? sourceItems : getItemsAtPath(cloned, to.path);
  const destinationItem = destinationItems.find(
    (item) => item.position === to.position && item.id !== sourceItem.id,
  );

  if (samePath) {
    sourceItem.position = to.position;
    if (destinationItem) destinationItem.position = sourcePosition;
    return cloned;
  }

  sourceItems.splice(sourceIndex, 1);
  if (destinationItem) {
    const destinationIndex = destinationItems.findIndex((item) => item.id === destinationItem.id);
    destinationItems.splice(destinationIndex, 1);
    destinationItem.position = sourcePosition;
    sourceItems.push(destinationItem);
  }
  sourceItem.position = to.position;
  destinationItems.push(sourceItem);
  return cloned;
}

export function moveItemIntoFolder(
  root: readonly DeckItem[],
  from: ItemReference,
  folderPath: readonly string[],
  folderId: string,
  maxDepth = 5,
): DeckItem[] {
  const children = getItemsAtPath(root, [...folderPath, folderId]);
  return moveItem(
    root,
    from,
    { path: [...folderPath, folderId], position: findFirstEmptyPosition(children) },
    maxDepth,
  );
}

export function cloneItemWithNewIds(
  item: DeckItem,
  createId: () => string = () => crypto.randomUUID(),
): DeckItem {
  if (item.kind === 'action') return { ...structuredClone(item), id: createId() };
  return {
    ...structuredClone(item),
    id: createId(),
    children: item.children.map((child) => cloneItemWithNewIds(child, createId)),
  };
}

export function duplicateItem(
  root: readonly DeckItem[],
  path: readonly string[],
  id: string,
  createId: () => string = () => crypto.randomUUID(),
): DeckItem[] {
  const source = findItemAtPath(root, path, id);
  if (!source) throw new TreeError('ITEM_NOT_FOUND', 'Item was not found');
  const items = getItemsAtPath(root, path);
  const duplicate = cloneItemWithNewIds(source, createId);
  duplicate.position = findFirstEmptyPosition(items, source.position + 1);
  return upsertItem(root, path, duplicate);
}
