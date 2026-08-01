import type { DeckItem } from '../../../shared/types';

export interface DeckClipboard {
  item: DeckItem;
  path: string[];
  cut: boolean;
}

let clipboard: DeckClipboard | null = null;
const STORAGE_KEY = 'stream-panel-internal-clipboard';

export function setDeckClipboard(item: DeckItem, path: string[], cut: boolean): void {
  clipboard = { item: structuredClone(item), path: [...path], cut };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clipboard));
  } catch {
    // The in-memory fallback remains available when storage is disabled.
  }
}

export function getDeckClipboard(): DeckClipboard | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) clipboard = JSON.parse(stored) as DeckClipboard;
  } catch {
    // Ignore malformed or unavailable storage and use the in-memory value.
  }
  return clipboard ? structuredClone(clipboard) : null;
}

export function clearDeckClipboard(): void {
  clipboard = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage cleanup is best effort.
  }
}
