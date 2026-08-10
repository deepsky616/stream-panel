import type {
  BuiltInWebWorkflowId,
  CustomWebWorkflowDefinition,
  DeckItem,
  EducationOfficeCode,
  LibraryEntry,
  WebConnectorBrowserId,
  WebWorkflowSpec,
  WebWorkflowSystem,
} from './types';
import {
  EDUCATION_OFFICES,
  getEducationOffice,
  isEducationOfficeCode,
} from './educationOffices';

export interface WebWorkflowDefinition {
  id: BuiltInWebWorkflowId;
  label: string;
  defaultTarget: string;
  system: WebWorkflowSystem;
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

export const APPROVAL_INBOX_WORKFLOW_DEFINITIONS: readonly WebWorkflowDefinition[] = [
  {
    id: 'neis-approval-inbox',
    label: '나이스 결재함',
    defaultTarget: 'https://goe.neis.go.kr/',
    system: 'neis',
  },
  {
    id: 'edufine-approval-inbox',
    label: '에듀파인 결재함',
    defaultTarget: 'https://klef.goe.go.kr/',
    system: 'edufine',
  },
] as const;

const ALL_WEB_WORKFLOW_DEFINITIONS = [
  ...WEB_WORKFLOW_DEFINITIONS,
  ...APPROVAL_INBOX_WORKFLOW_DEFINITIONS,
] as const;

const WORKFLOW_IDS = new Set<BuiltInWebWorkflowId>(
  ALL_WEB_WORKFLOW_DEFINITIONS.map((definition) => definition.id),
);
const BROWSER_IDS = new Set<WebConnectorBrowserId>(['chrome', 'edge']);
const CUSTOM_CONFIRMATION_ACTION_TOKENS = [
  '저장',
  '제출',
  '상신',
  '승인',
  '결재',
  '등록',
  '신청',
  '확인',
  '인증 입력',
] as const;
const CUSTOM_FORBIDDEN_ACTION_TOKENS = [
  '확정',
  '삭제',
  '취소',
  '지급',
  '송금',
  '이체',
  '발송',
  '인증서',
  '비밀번호',
  '암호',
  '요청',
  '완료',
  '반려',
  '서명',
  '동의',
  '전송',
  '처리',
] as const;

function normalizeWorkflowText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function customWorkflowStepRequiresConfirmation(value: unknown): boolean {
  const label = normalizeWorkflowText(value);
  return CUSTOM_CONFIRMATION_ACTION_TOKENS.some((token) => label.includes(token));
}

export function isForbiddenCustomWorkflowLabel(value: unknown): boolean {
  const label = normalizeWorkflowText(value);
  return CUSTOM_FORBIDDEN_ACTION_TOKENS.some((token) => label.includes(token));
}

function isCustomWebWorkflowDefinition(value: unknown): value is CustomWebWorkflowDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const name = normalizeWorkflowText(record.name);
  const finalText = normalizeWorkflowText(record.finalText);
  if (
    Object.keys(record).some((key) => !['name', 'system', 'steps', 'finalText'].includes(key)) ||
    (record.system !== 'neis' && record.system !== 'edufine') ||
    record.name !== name ||
    name.length < 1 ||
    Array.from(name).length > 24 ||
    record.finalText !== finalText ||
    finalText.length < 1 ||
    Array.from(finalText).length > 60 ||
    !Array.isArray(record.steps) ||
    record.steps.length < 1 ||
    record.steps.length > 8
  ) return false;
  return record.steps.every((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return false;
    const candidate = step as Record<string, unknown>;
    const label = normalizeWorkflowText(candidate.label);
    return (
      Object.keys(candidate).every((key) => key === 'id' || key === 'label') &&
      candidate.id === `step-${index + 1}` &&
      candidate.label === label &&
      label.length > 0 &&
      Array.from(label).length <= 40 &&
      !isForbiddenCustomWorkflowLabel(label)
    );
  });
}

export function isWebConnectorSupportedPlatform(
  platform: string | null,
): platform is 'win32' {
  return platform === 'win32';
}

export function isWebWorkflowId(value: unknown): value is BuiltInWebWorkflowId {
  return typeof value === 'string' && WORKFLOW_IDS.has(value as BuiltInWebWorkflowId);
}

export function isWebConnectorBrowserId(value: unknown): value is WebConnectorBrowserId {
  return typeof value === 'string' && BROWSER_IDS.has(value as WebConnectorBrowserId);
}

export function isWebWorkflowSpec(value: unknown): value is WebWorkflowSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.id === 'custom') {
    return (
      Object.keys(record).every((key) => (
        key === 'id' || key === 'browserId' || key === 'officeCode' || key === 'custom'
      )) &&
      isWebConnectorBrowserId(record.browserId) &&
      (record.officeCode === undefined || isEducationOfficeCode(record.officeCode)) &&
      isCustomWebWorkflowDefinition(record.custom)
    );
  }
  return (
    Object.keys(record).every((key) => (
      key === 'id' || key === 'browserId' || key === 'officeCode'
    )) &&
    isWebWorkflowId(record.id) &&
    isWebConnectorBrowserId(record.browserId) &&
    (record.officeCode === undefined || isEducationOfficeCode(record.officeCode))
  );
}

export function getWebWorkflowDefinition(id: BuiltInWebWorkflowId): WebWorkflowDefinition {
  return ALL_WEB_WORKFLOW_DEFINITIONS.find((definition) => definition.id === id)!;
}

function targetForSystem(
  system: WebWorkflowSystem,
  officeCode: EducationOfficeCode,
): string {
  const office = getEducationOffice(officeCode);
  return system === 'neis' ? office.neisUrl : office.edufineUrl;
}

export function getWebWorkflowTarget(
  id: BuiltInWebWorkflowId,
  officeCode: EducationOfficeCode,
): string {
  return targetForSystem(getWebWorkflowDefinition(id).system, officeCode);
}

export function getWebWorkflowSystem(spec: WebWorkflowSpec): WebWorkflowSystem {
  return spec.id === 'custom'
    ? spec.custom.system
    : getWebWorkflowDefinition(spec.id).system;
}

export function getWebWorkflowTargetForSpec(
  spec: WebWorkflowSpec,
  officeCode: EducationOfficeCode,
): string {
  return targetForSystem(getWebWorkflowSystem(spec), officeCode);
}

export function inferWebWorkflowOfficeCode(
  spec: WebWorkflowSpec,
  target: string,
): EducationOfficeCode | null {
  return EDUCATION_OFFICES.find((office) => (
    isAllowedWebWorkflowSpecTarget(spec, target, office.code)
  ))?.code ?? null;
}

export function resolveWebWorkflowOfficeCode(
  spec: WebWorkflowSpec,
  target: string,
  fallback: EducationOfficeCode = 'goe',
): EducationOfficeCode {
  return spec.officeCode ?? inferWebWorkflowOfficeCode(spec, target) ?? fallback;
}

export function isAllowedWebWorkflowTarget(
  id: BuiltInWebWorkflowId,
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

export function isAllowedWebWorkflowSpecTarget(
  spec: WebWorkflowSpec,
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
  const system = getWebWorkflowSystem(spec);
  const offices = officeCode
    ? [getEducationOffice(officeCode)]
    : EDUCATION_OFFICES;
  return offices.some((office) => {
    const expected = new URL(system === 'neis' ? office.neisUrl : office.edufineUrl);
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

const WORKFLOW_EMOJI: Record<BuiltInWebWorkflowId, string> = {
  'neis-leave': '🗓️',
  'neis-trip': '🧳',
  'neis-approval-inbox': '🔔',
  'edufine-draft': '✍️',
  'edufine-purchase': '🧾',
  'edufine-approval-inbox': '🔔',
};

export function createWebWorkflowTemplate(
  id: BuiltInWebWorkflowId,
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
    webWorkflow: { id, browserId, officeCode },
  };
}

export function createApprovalInboxTemplate(
  system: WebWorkflowSystem,
  browserId: WebConnectorBrowserId,
  officeCode: EducationOfficeCode = 'goe',
): Extract<LibraryEntry, { kind: 'action-template' }> {
  return createWebWorkflowTemplate(
    system === 'neis' ? 'neis-approval-inbox' : 'edufine-approval-inbox',
    browserId,
    officeCode,
  );
}

export interface CreateCustomWebWorkflowInput {
  name: string;
  system: WebWorkflowSystem;
  browserId: WebConnectorBrowserId;
  stepLabels: string[];
  finalText: string;
  officeCode?: EducationOfficeCode;
}

export function createCustomWebWorkflowTemplate({
  name,
  system,
  browserId,
  stepLabels,
  finalText,
  officeCode = 'goe',
}: CreateCustomWebWorkflowInput): Extract<LibraryEntry, { kind: 'action-template' }> {
  const normalizedName = normalizeWorkflowText(name);
  const normalizedSteps = stepLabels.map(normalizeWorkflowText);
  const normalizedFinalText = normalizeWorkflowText(finalText);
  if (Array.from(normalizedName).length < 1 || Array.from(normalizedName).length > 24) {
    throw new Error('업무 이름은 한 글자부터 스물네 글자까지 입력해 주세요.');
  }
  if (normalizedSteps.length < 1) {
    throw new Error('자동으로 누를 메뉴를 한 단계 이상 추가해 주세요.');
  }
  if (normalizedSteps.length > 8) {
    throw new Error('자동 이동 단계는 여덟 단계까지 추가할 수 있습니다.');
  }
  for (const label of normalizedSteps) {
    if (Array.from(label).length < 1 || Array.from(label).length > 40) {
      throw new Error('각 메뉴 이름은 한 글자부터 마흔 글자까지 입력해 주세요.');
    }
    if (isForbiddenCustomWorkflowLabel(label)) {
      throw new Error(`'${label}' 동작은 안전을 위해 자동으로 누를 수 없습니다. 해당 단계는 사용자가 직접 진행해 주세요.`);
    }
  }
  if (Array.from(normalizedFinalText).length < 1 || Array.from(normalizedFinalText).length > 60) {
    throw new Error('도착 화면 확인 문구는 한 글자부터 예순 글자까지 입력해 주세요.');
  }
  return {
    kind: 'action-template',
    type: 'url',
    label: normalizedName,
    emoji: '🧭',
    target: targetForSystem(system, officeCode),
    webWorkflow: {
      id: 'custom',
      browserId,
      officeCode,
      custom: {
        name: normalizedName,
        system,
        steps: normalizedSteps.map((label, index) => ({ id: `step-${index + 1}`, label })),
        finalText: normalizedFinalText,
      },
    },
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
    if (!item.webWorkflow) {
      const legacyDefinition = item.type === 'url'
        ? ALL_WEB_WORKFLOW_DEFINITIONS.find((definition) => (
            item.label === definition.label &&
            isAllowedWebWorkflowTarget(definition.id, item.target)
          ))
        : undefined;
      if (!legacyDefinition) return item;
      const migrated = { ...item };
      delete migrated.browser;
      return {
        ...migrated,
        target: getWebWorkflowTarget(legacyDefinition.id, officeCode),
        webWorkflow: {
          id: legacyDefinition.id,
          browserId: item.browser ? browserIdFromPath(item.browser.path) ?? 'edge' : 'edge',
          officeCode,
        },
      };
    }
    return {
      ...item,
      target: getWebWorkflowTargetForSpec(item.webWorkflow, officeCode),
      webWorkflow: { ...item.webWorkflow, officeCode },
    };
  });
}
