import { DEFAULT_HINT_KEYS } from './hintMap';
import type { AppConfig, DeckItem } from './types';

export interface DefaultPaths {
  downloads: string;
  documents: string;
}

export const EDUFINE_PURCHASE_HISTORY_GENERATOR_URL =
  'https://deepsky616.github.io/school-quote-review/';

export const EDUFINE_PURCHASE_HISTORY_GENERATOR_LABEL = '에듀파인 품의내역 생성기';

export const DEFAULT_GRID = {
  cols: 5,
  rows: 3,
  buttonSize: 88,
  gap: 8,
} as const;

export const DEFAULT_WINDOW = {
  x: null,
  y: null,
  alwaysOnTop: true,
  opacity: 1,
  locked: false,
  hideOnLaunch: false,
} as const;

export const DEFAULT_BEHAVIOR = {
  hideAfterLaunch: true,
  hideAfterLaunchDelayMs: 180,
  edgePeek: true,
  peekEdge: 'auto',
  peekThickness: 6,
  peekDelayMs: 220,
  idleFade: false,
  idleFadeAfterMs: 4_000,
  idleOpacity: 0.25,
} as const;

export const DEFAULT_KEYBOARD = {
  quickHints: 'on-focus',
  hintKeys: DEFAULT_HINT_KEYS,
  hideAfterHotkeyLaunch: true,
  globalNumberHotkeys: true,
  globalNumberModifier: 'Alt+Shift',
  quickLauncher: true,
  quickLauncherHotkey: 'CommandOrControl+Alt+Space',
} as const;

export const DEFAULT_APPROVAL_MONITOR = {
  sources: {
    neis: { enabled: true, browserId: 'edge' },
    edufine: { enabled: true, browserId: 'edge' },
  },
  intervalMinutes: 10,
  notifyOnlyOnIncrease: true,
  workHours: { enabled: true, start: '08:00', end: '18:00' },
} as const;

export const DEFAULT_WEB_CONNECTION = {
  autoConnectAfterPortalLogin: true,
  autoConnectTarget: 'both',
  sessionKeepAlive: {
    neis: true,
    edufine: true,
  },
} as const;

function getRuntimePlatform(): string {
  return (globalThis as { process?: { platform?: string } }).process?.platform ?? 'win32';
}

export function resolveConfigPlatform(platform: string = getRuntimePlatform()): AppConfig['platform'] {
  return platform === 'darwin' ? 'darwin' : 'win32';
}

export function createDefaultItems(
  paths: DefaultPaths,
  createId: () => string = () => crypto.randomUUID(),
  includePurchaseHistoryGenerator = false,
): DeckItem[] {
  const items: DeckItem[] = [
    {
      id: createId(),
      kind: 'action',
      label: '구글',
      type: 'url',
      target: 'https://www.google.com',
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
    },
    {
      id: createId(),
      kind: 'action',
      label: '다운로드',
      type: 'folder',
      target: paths.downloads,
      args: [],
      icon: { kind: 'emoji', value: '📁' },
      color: '#5B8CFF',
      position: 1,
    },
    {
      id: createId(),
      kind: 'action',
      label: '문서',
      type: 'folder',
      target: paths.documents,
      args: [],
      icon: { kind: 'emoji', value: '📄' },
      color: '#5B8CFF',
      position: 2,
    },
  ];
  if (includePurchaseHistoryGenerator) {
    items.push(createEdufinePurchaseHistoryGeneratorItem(createId(), 3));
  }
  return items;
}

function createEdufinePurchaseHistoryGeneratorItem(id: string, position: number): DeckItem {
  return {
    id,
    kind: 'action',
    label: EDUFINE_PURCHASE_HISTORY_GENERATOR_LABEL,
    type: 'url',
    target: EDUFINE_PURCHASE_HISTORY_GENERATOR_URL,
    args: [],
    icon: { kind: 'emoji', value: '📊' },
    color: '#5B8CFF',
    position,
  };
}

function isPurchaseHistoryGenerator(item: DeckItem): boolean {
  return item.kind === 'action'
    && item.type === 'url'
    && item.target.replace(/\/+$/, '') === EDUFINE_PURCHASE_HISTORY_GENERATOR_URL.replace(/\/+$/, '');
}

function hasPurchaseHistoryGenerator(items: readonly DeckItem[]): boolean {
  return items.some((item) => (
    isPurchaseHistoryGenerator(item)
    || (item.kind === 'folder' && hasPurchaseHistoryGenerator(item.children))
  ));
}

function insertGeneratorAfterPurchase(
  items: readonly DeckItem[],
  createId: () => string,
): { items: DeckItem[]; inserted: boolean } {
  const purchaseIndex = items.findIndex((item) => (
    item.kind === 'action' && item.webWorkflow?.id === 'edufine-purchase'
  ));
  if (purchaseIndex >= 0) {
    const position = items[purchaseIndex].position + 1;
    const shifted = items.map((item) => (
      item.position >= position ? { ...item, position: item.position + 1 } : { ...item }
    ));
    shifted.splice(
      purchaseIndex + 1,
      0,
      createEdufinePurchaseHistoryGeneratorItem(createId(), position),
    );
    return { items: shifted, inserted: true };
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'folder') continue;
    const nested = insertGeneratorAfterPurchase(item.children, createId);
    if (!nested.inserted) continue;
    return {
      items: items.map((candidate, candidateIndex) => (
        candidateIndex === index ? { ...item, children: nested.items } : { ...candidate }
      )),
      inserted: true,
    };
  }

  return { items: items.map((item) => ({ ...item })), inserted: false };
}

export function ensureEdufinePurchaseHistoryGenerator(
  items: readonly DeckItem[],
  createId: () => string = () => crypto.randomUUID(),
): DeckItem[] {
  if (hasPurchaseHistoryGenerator(items)) return structuredClone(items) as DeckItem[];
  const adjacent = insertGeneratorAfterPurchase(items, createId);
  if (adjacent.inserted) return adjacent.items;
  const position = items.length === 0
    ? 0
    : Math.max(...items.map((item) => item.position)) + 1;
  return [
    ...items.map((item) => ({ ...item })),
    createEdufinePurchaseHistoryGeneratorItem(createId(), position),
  ];
}

export function createDefaultConfig(
  paths: DefaultPaths,
  createId: () => string = () => crypto.randomUUID(),
  platform: string = getRuntimePlatform(),
): AppConfig {
  const configPlatform = resolveConfigPlatform(platform);
  return {
    version: 4,
    platform: configPlatform,
    educationOfficeCode: 'goe',
    root: createDefaultItems(paths, createId, configPlatform === 'win32'),
    grid: { ...DEFAULT_GRID },
    window: { ...DEFAULT_WINDOW },
    behavior: { ...DEFAULT_BEHAVIOR },
    keyboard: {
      ...DEFAULT_KEYBOARD,
      globalNumberModifier: configPlatform === 'darwin' ? 'Control+Alt' : 'Alt+Shift',
    },
    webConnection: structuredClone(DEFAULT_WEB_CONNECTION),
    approvalMonitor: structuredClone(DEFAULT_APPROVAL_MONITOR),
    theme: 'system',
    hotkey: 'CommandOrControl+Alt+D',
    launchAtLogin: false,
    autoUpdate: configPlatform === 'win32',
  };
}
