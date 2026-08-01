import type { DeckItem, LibraryEntry } from '../../../shared/types';

export interface LibraryDragData {
  source: 'library';
  entry: LibraryEntry;
}

export interface GridDragData {
  source: 'grid';
  path: string[];
  item: DeckItem;
}

export type DragData = LibraryDragData | GridDragData;

export type DropData =
  | { target: 'slot'; path: string[]; position: number; occupiedId?: string }
  | { target: 'folder'; path: string[]; id: string }
  | { target: 'trash' };

export function isDragData(value: unknown): value is DragData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DragData>;
  return candidate.source === 'library' || candidate.source === 'grid';
}

export function isDropData(value: unknown): value is DropData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DropData>;
  return candidate.target === 'slot' || candidate.target === 'folder' || candidate.target === 'trash';
}
