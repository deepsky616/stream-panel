import type {
  LibraryEntry,
  WebConnectorBrowserId,
  WebWorkflowId,
  WebWorkflowSpec,
} from './types';

export interface WebWorkflowDefinition {
  id: WebWorkflowId;
  label: string;
  defaultTarget: string;
  system: 'neis' | 'edufine';
}

export const WEB_WORKFLOW_DEFINITIONS: readonly WebWorkflowDefinition[] = [
  {
    id: 'neis-leave',
    label: '나이스 복무',
    defaultTarget: 'https://goe.neis.go.kr',
    system: 'neis',
  },
  {
    id: 'neis-trip',
    label: '나이스 출장',
    defaultTarget: 'https://goe.neis.go.kr',
    system: 'neis',
  },
  {
    id: 'edufine-draft',
    label: '에듀파인 기안',
    defaultTarget: 'https://klef.goe.go.kr',
    system: 'edufine',
  },
  {
    id: 'edufine-purchase',
    label: '에듀파인 품의',
    defaultTarget: 'https://klef.goe.go.kr',
    system: 'edufine',
  },
] as const;

const WORKFLOW_IDS = new Set<WebWorkflowId>(
  WEB_WORKFLOW_DEFINITIONS.map((definition) => definition.id),
);
const BROWSER_IDS = new Set<WebConnectorBrowserId>(['chrome', 'edge']);

export function isWebConnectorSupportedPlatform(
  platform: string | null,
): platform is 'win32' {
  return platform === 'win32';
}

export function isWebWorkflowId(value: unknown): value is WebWorkflowId {
  return typeof value === 'string' && WORKFLOW_IDS.has(value as WebWorkflowId);
}

export function isWebConnectorBrowserId(value: unknown): value is WebConnectorBrowserId {
  return typeof value === 'string' && BROWSER_IDS.has(value as WebConnectorBrowserId);
}

export function isWebWorkflowSpec(value: unknown): value is WebWorkflowSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => key === 'id' || key === 'browserId') &&
    isWebWorkflowId(record.id) &&
    isWebConnectorBrowserId(record.browserId)
  );
}

export function getWebWorkflowDefinition(id: WebWorkflowId): WebWorkflowDefinition {
  return WEB_WORKFLOW_DEFINITIONS.find((definition) => definition.id === id)!;
}

export function isAllowedWebWorkflowTarget(id: WebWorkflowId, target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  const definition = getWebWorkflowDefinition(id);
  if (definition.system === 'neis') return hostname === 'goe.neis.go.kr';
  return hostname === 'klef.goe.go.kr';
}

export function browserIdFromPath(path: string): WebConnectorBrowserId | null {
  const normalized = path.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
  if (normalized.endsWith('/msedge.exe') || normalized.endsWith('/microsoft edge.app')) {
    return 'edge';
  }
  if (normalized.endsWith('/chrome.exe') || normalized.endsWith('/google chrome.app')) {
    return 'chrome';
  }
  return null;
}

const WORKFLOW_EMOJI: Record<WebWorkflowId, string> = {
  'neis-leave': '🗓️',
  'neis-trip': '🧳',
  'edufine-draft': '✍️',
  'edufine-purchase': '🧾',
};

export function createWebWorkflowTemplate(
  id: WebWorkflowId,
  browserId: WebConnectorBrowserId,
): Extract<LibraryEntry, { kind: 'action-template' }> {
  const definition = getWebWorkflowDefinition(id);
  return {
    kind: 'action-template',
    type: 'url',
    label: definition.label,
    emoji: WORKFLOW_EMOJI[id],
    target: definition.defaultTarget,
    webWorkflow: { id, browserId },
  };
}

export function createWebWorkflowTemplatesForPlatform(
  platform: string | null,
): Extract<LibraryEntry, { kind: 'action-template' }>[] {
  if (!isWebConnectorSupportedPlatform(platform)) return [];
  return WEB_WORKFLOW_DEFINITIONS.map((definition) =>
    createWebWorkflowTemplate(definition.id, 'edge'),
  );
}

export function getBrowserExtensionManagementUrl(
  browserId: WebConnectorBrowserId,
): 'chrome://extensions/' | 'edge://extensions/' {
  return browserId === 'edge' ? 'edge://extensions/' : 'chrome://extensions/';
}

export interface BrowserExtensionStoreUrls {
  chrome: string | null;
  edge: string | null;
}

export const BROWSER_EXTENSION_STORE_URLS: Readonly<BrowserExtensionStoreUrls> = {
  chrome: null,
  edge: null,
};

export type BrowserExtensionInstallTarget =
  | { kind: 'store'; url: string }
  | { kind: 'manual'; url: 'chrome://extensions/' | 'edge://extensions/' };

function isOfficialBrowserExtensionStoreUrl(
  browserId: WebConnectorBrowserId,
  target: string,
): boolean {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:') return false;
    const parts = url.pathname.split('/').filter(Boolean);
    const extensionId = parts.at(-1) ?? '';
    if (!/^[a-p]{32}$/.test(extensionId)) return false;
    if (browserId === 'chrome') {
      return url.hostname === 'chromewebstore.google.com' && parts[0] === 'detail';
    }
    return (
      url.hostname === 'microsoftedge.microsoft.com' &&
      parts[0] === 'addons' &&
      parts[1] === 'detail'
    );
  } catch {
    return false;
  }
}

export function getBrowserExtensionInstallTarget(
  browserId: WebConnectorBrowserId,
  storeUrls: Readonly<BrowserExtensionStoreUrls> = BROWSER_EXTENSION_STORE_URLS,
): BrowserExtensionInstallTarget {
  const storeUrl = storeUrls[browserId];
  return storeUrl && isOfficialBrowserExtensionStoreUrl(browserId, storeUrl)
    ? { kind: 'store', url: storeUrl }
    : { kind: 'manual', url: getBrowserExtensionManagementUrl(browserId) };
}
