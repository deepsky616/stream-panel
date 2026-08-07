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

export function getLibraryDragId(entry: LibraryEntry): string {
  if (entry.kind === 'installed-app') {
    return `installed:${entry.app.type}:${entry.app.target}`;
  }
  if (entry.kind === 'folder-template') {
    return `library:folder:${entry.label}`;
  }
  if (!entry.webWorkflow) {
    return `library:action:${entry.type}:${entry.label}`;
  }
  const workflow = entry.webWorkflow;
  const customName = workflow.id === 'custom' ? workflow.custom.name : '';
  return [
    'library:web-work',
    workflow.id,
    workflow.browserId,
    workflow.officeCode ?? '',
    customName,
  ].join(':');
}

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
