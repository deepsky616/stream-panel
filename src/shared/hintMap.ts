import type { DeckSlot } from './layout';

export const DEFAULT_HINT_KEYS = '1234567890qwertyuiopasdfghjkl;zxcvbnm,./';

export interface HintAssignment {
  itemId: string;
  hint: string;
  code: string | null;
  position: number;
  slot: number;
}

const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  ';': 'Semicolon',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  "'": 'Quote',
};

export function getHintCode(hint: string): string | null {
  if (/^[0-9]$/.test(hint)) return `Digit${hint}`;
  if (/^[a-z]$/i.test(hint)) return `Key${hint.toUpperCase()}`;
  return PUNCTUATION_CODES[hint] ?? null;
}

export function validateHintKeys(hintKeys: string): boolean {
  const characters = [...hintKeys];
  return characters.length > 0 && new Set(characters).size === characters.length;
}

export function normalizeHintKeys(hintKeys: string): string {
  return validateHintKeys(hintKeys) ? hintKeys : DEFAULT_HINT_KEYS;
}

export function assignHints(
  slots: readonly DeckSlot[],
  hintKeys = DEFAULT_HINT_KEYS,
): HintAssignment[] {
  const characters = [...normalizeHintKeys(hintKeys)];
  return slots
    .filter((slot): slot is Extract<DeckSlot, { kind: 'item' }> => slot.kind === 'item')
    .sort((left, right) => left.position - right.position)
    .slice(0, characters.length)
    .map(({ item, position, slot }, index) => ({
      itemId: item.id,
      hint: characters[index],
      code: getHintCode(characters[index]),
      position,
      slot,
    }));
}
