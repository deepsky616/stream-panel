import { getCapacity } from './layout';
import type { ActionItem, DeckItem, GridConfig, LauncherResult } from './types';

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const HANGUL_INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const HANGUL_INITIAL_PATTERN = /[ㄱ-ㅎ]/;

interface SearchEntry {
  item: ActionItem;
  breadcrumb: string;
  depth: number;
  traversalOrder: number;
}

interface TermMatch {
  rank: number;
  ranges: [number, number][];
}

interface RankedEntry {
  entry: SearchEntry;
  rank: number;
  rankTotal: number;
  ranges: [number, number][];
}

interface HangulInitialUnit {
  initial: string;
  start: number;
  end: number;
  completeSyllable: boolean;
}

function getHangulInitialUnits(value: string): HangulInitialUnit[] {
  const units: HangulInitialUnit[] = [];
  let offset = 0;
  for (const character of value) {
    const code = character.charCodeAt(0);
    const completeSyllable = code >= HANGUL_START && code <= HANGUL_END;
    units.push({
      initial: completeSyllable
        ? (HANGUL_INITIALS[Math.floor((code - HANGUL_START) / 588)] ?? character)
        : character.toLocaleLowerCase(),
      start: offset,
      end: offset + character.length,
      completeSyllable,
    });
    offset += character.length;
  }
  return units;
}

export function getHangulInitials(value: string): string {
  return getHangulInitialUnits(value).map(({ initial }) => initial).join('');
}

function flattenActions(
  items: readonly DeckItem[],
  labels: readonly string[] = [],
  output: SearchEntry[] = [],
): SearchEntry[] {
  const sorted = [...items].sort((left, right) => left.position - right.position);
  for (const item of sorted) {
    if (item.kind === 'action') {
      output.push({
        item,
        breadcrumb: labels.join(' › '),
        depth: labels.length,
        traversalOrder: output.length,
      });
    } else {
      flattenActions(item.children, [...labels, item.label], output);
    }
  }
  return output;
}

export function findActionPath(
  items: readonly DeckItem[],
  id: string,
  path: readonly string[] = [],
): string[] | null {
  for (const item of items) {
    if (item.kind === 'action' && item.id === id) return [...path];
    if (item.kind === 'folder') {
      const found = findActionPath(item.children, id, [...path, item.id]);
      if (found) return found;
    }
  }
  return null;
}

function toResult(
  entry: SearchEntry,
  hint: string,
  matchRanges: [number, number][],
): LauncherResult {
  return {
    id: entry.item.id,
    label: entry.item.label,
    type: entry.item.type,
    breadcrumb: entry.breadcrumb,
    hint,
    matchRanges,
  };
}

function numberHint(position: number): string {
  return position === 9 ? '0' : String(position + 1);
}

function isWordStart(value: string, index: number): boolean {
  return index === 0 || !/[\p{L}\p{N}]/u.test(value[index - 1] ?? '');
}

function initialsMatch(label: string, term: string): [number, number][] | null {
  const words = Array.from(label.matchAll(/[A-Za-z0-9]+/g));
  const initials = words.map((match) => match[0][0].toLocaleLowerCase()).join('');
  const start = initials.indexOf(term);
  if (start < 0) return null;
  return words.slice(start, start + term.length).map((match) => {
    const index = match.index ?? 0;
    return [index, index + 1];
  });
}

function targetSearchText(target: string): string {
  try {
    const url = new URL(target);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname;
    if (url.protocol === 'mailto:') return url.pathname;
  } catch {
    // File and app paths are handled below.
  }
  return target.split(/[\\/]/).filter(Boolean).at(-1) ?? target;
}

function findHangulInitialMatch(label: string, term: string): [number, number][] | null {
  const units = getHangulInitialUnits(label);
  const query = Array.from(term);
  for (let start = 0; start <= units.length - query.length; start += 1) {
    const matched = units.slice(start, start + query.length);
    if (
      matched.every(
        (unit, index) => unit.completeSyllable && unit.initial === query[index],
      )
    ) {
      return matched.map(({ start: rangeStart, end }) => [rangeStart, end]);
    }
  }
  return null;
}

function matchTerm(entry: SearchEntry, term: string): TermMatch | null {
  const label = entry.item.label.toLocaleLowerCase();
  const directIndex = label.indexOf(term);
  if (directIndex === 0) {
    return { rank: 1, ranges: [[0, term.length]] };
  }
  if (directIndex > 0 && isWordStart(label, directIndex)) {
    return { rank: 2, ranges: [[directIndex, directIndex + term.length]] };
  }

  if (HANGUL_INITIAL_PATTERN.test(term)) {
    const ranges = findHangulInitialMatch(entry.item.label, term);
    if (ranges) return { rank: 3, ranges };
  }

  if (/^[a-z0-9]+$/.test(term)) {
    const ranges = initialsMatch(entry.item.label, term);
    if (ranges) return { rank: 4, ranges };
  }
  if (directIndex >= 0) {
    return { rank: 5, ranges: [[directIndex, directIndex + term.length]] };
  }
  if (entry.breadcrumb.toLocaleLowerCase().includes(term)) {
    return { rank: 6, ranges: [] };
  }
  if (targetSearchText(entry.item.target).toLocaleLowerCase().includes(term)) {
    return { rank: 7, ranges: [] };
  }
  return null;
}

function mergeRanges(ranges: readonly [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: [number, number][] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range[0] > previous[1]) {
      merged.push([...range]);
    } else {
      previous[1] = Math.max(previous[1], range[1]);
    }
  }
  return merged;
}

function rankEntry(entry: SearchEntry, terms: readonly string[]): RankedEntry | null {
  const matches = terms.map((term) => matchTerm(entry, term));
  if (matches.some((match) => match === null)) return null;
  const present = matches as TermMatch[];
  return {
    entry,
    rank: Math.max(...present.map(({ rank }) => rank)),
    rankTotal: present.reduce((total, { rank }) => total + rank, 0),
    ranges: mergeRanges(present.flatMap(({ ranges }) => ranges)),
  };
}

export function searchDeckItems(
  root: readonly DeckItem[],
  text: string,
  grid: Pick<GridConfig, 'cols' | 'rows'>,
): LauncherResult[] {
  const terms = text
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) {
    const limit = Math.min(10, getCapacity(grid));
    return root
      .filter(
        (item): item is ActionItem =>
          item.kind === 'action' && item.position >= 0 && item.position < limit,
      )
      .sort((left, right) => left.position - right.position)
      .map((item) =>
        toResult(
          { item, breadcrumb: '', depth: 0, traversalOrder: item.position },
          numberHint(item.position),
          [],
        ),
      );
  }

  return flattenActions(root)
    .map((entry) => rankEntry(entry, terms))
    .filter((entry): entry is RankedEntry => entry !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.rankTotal - right.rankTotal ||
        left.entry.depth - right.entry.depth ||
        left.entry.item.position - right.entry.item.position ||
        left.entry.traversalOrder - right.entry.traversalOrder,
    )
    .slice(0, 8)
    .map(({ entry, ranges }, index) => toResult(entry, String(index + 1), ranges));
}
