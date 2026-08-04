import type {
  DeckItem,
  EducationOfficeCode,
  LibraryEntry,
  WebConnectorBrowserId,
  WebWorkflowId,
  WebWorkflowSpec,
} from './types';
import { EDUCATION_OFFICES, getEducationOffice } from './educationOffices';

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
    defaultTarget: 'https://goe.neis.go.kr/',
    system: 'neis',
  },
  {
    id: 'neis-trip',
    label: '나이스 출장',
    defaultTarget: 'https://goe.neis.go.kr/',
    system: 'neis',
  },
  {
    id: 'edufine-draft',
    label: '에듀파인 기안',
    defaultTarget: 'https://klef.goe.go.kr/',
    system: 'edufine',
  },
  {
    id: 'edufine-purchase',
    label: '에듀파인 품의',
    defaultTarget: 'https://klef.goe.go.kr/',
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

function targetForSystem(
  system: WebWorkflowDefinition['system'],
  officeCode: EducationOfficeCode,
): string {
  const office = getEducationOffice(officeCode);
  return system === 'neis' ? office.neisUrl : office.edufineUrl;
}

export function getWebWorkflowTarget(
  id: WebWorkflowId,
  officeCode: EducationOfficeCode,
): string {
  return targetForSystem(getWebWorkflowDefinition(id).system, officeCode);
}

export function isAllowedWebWorkflowTarget(
  id: WebWorkflowId,
  target: string,
  officeCode?: EducationOfficeCode,
): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const definition = getWebWorkflowDefinition(id);
  const offices = officeCode
    ? [getEducationOffice(officeCode)]
    : EDUCATION_OFFICES;
  return offices.some((office) => {
    const expected = new URL(
      definition.system === 'neis' ? office.neisUrl : office.edufineUrl,
    );
    return (
      url.hostname.toLowerCase() === expected.hostname &&
      url.port === '' &&
      url.username === '' &&
      url.password === ''
    );
  });
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
  officeCode: EducationOfficeCode = 'goe',
): Extract<LibraryEntry, { kind: 'action-template' }> {
  const definition = getWebWorkflowDefinition(id);
  return {
    kind: 'action-template',
    type: 'url',
    label: definition.label,
    emoji: WORKFLOW_EMOJI[id],
    target: getWebWorkflowTarget(id, officeCode),
    webWorkflow: { id, browserId },
  };
}

export function createWebWorkflowTemplatesForPlatform(
  platform: string | null,
  officeCode: EducationOfficeCode = 'goe',
): Extract<LibraryEntry, { kind: 'action-template' }>[] {
  if (!isWebConnectorSupportedPlatform(platform)) return [];
  return WEB_WORKFLOW_DEFINITIONS.map((definition) =>
    createWebWorkflowTemplate(definition.id, 'edge', officeCode),
  );
}

export function retargetWebWorkflowItems(
  items: readonly DeckItem[],
  officeCode: EducationOfficeCode,
): DeckItem[] {
  return items.map((item): DeckItem => {
    if (item.kind === 'folder') {
      return { ...item, children: retargetWebWorkflowItems(item.children, officeCode) };
    }
    if (!item.webWorkflow) return item;
    return {
      ...item,
      target: getWebWorkflowTarget(item.webWorkflow.id, officeCode),
    };
  });
}

export function getBrowserExtensionManagementUrl(
  browserId: WebConnectorBrowserId,
): 'chrome://extensions/' | 'edge://extensions/' {
  return browserId === 'edge' ? 'edge://extensions/' : 'chrome://extensions/';
}
