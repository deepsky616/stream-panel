import {
  getWebWorkflowTargetForSpec,
  getWebWorkflowDefinition,
  resolveWebWorkflowOfficeCode,
  retargetWebWorkflowItems,
} from '../../../shared/webWorkflows';
import type {
  ActionItem,
  AppConfig,
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebConnectorStatus,
  WebSystemConnectionStatus,
  WebWorkflowSystem,
} from '../../../shared/types';

export type WebWorkBrowserState =
  | 'ready'
  | 'running'
  | 'needs-connection'
  | 'login-required'
  | 'error';

export interface WebWorkSystemState extends WebSystemConnectionStatus {
  label: string;
  stateLabel: string;
}

export interface WebWorkBrowserCard {
  browserId: WebConnectorBrowserId;
  name: string;
  recommended: boolean;
  state: WebWorkBrowserState;
  stateLabel: string;
  lastSeenAt?: number;
  systems: WebWorkSystemState[];
}

const SYSTEM_LABELS: Record<WebWorkflowSystem, string> = {
  neis: '나이스',
  edufine: 'K-에듀파인',
};

const SYSTEM_STATE_LABELS: Record<WebSystemConnectionStatus['state'], string> = {
  idle: '확인 전',
  connecting: '연결 중',
  connected: '연결됨',
  'login-required': '추가 로그인 필요',
  error: '실패',
};

export function shouldShowWebWorkSettings(platform: AppConfig['platform']): boolean {
  return platform === 'win32';
}

export function createWebWorkBrowserCards(
  statuses: readonly WebConnectorStatus[],
  busyBrowserId: WebConnectorBrowserId | null = null,
  errorBrowserId: WebConnectorBrowserId | null = null,
): WebWorkBrowserCard[] {
  return (['edge', 'chrome'] as const).map((browserId) => {
    const status = statuses.find((candidate) => candidate.browserId === browserId);
    const systems = (status?.systems ?? []).map((system): WebWorkSystemState => ({
      ...system,
      label: SYSTEM_LABELS[system.system],
      stateLabel: SYSTEM_STATE_LABELS[system.state],
    }));
    const hasConnecting = systems.some((system) => system.state === 'connecting');
    const state: WebWorkBrowserState = errorBrowserId === browserId
      ? 'error'
      : busyBrowserId === browserId || hasConnecting
        ? 'running'
        : status?.paired || status?.connected
          ? 'ready'
          : 'needs-connection';
    const stateLabel = {
      ready: '준비됨',
      running: '실행 중',
      'needs-connection': '연결 필요',
      'login-required': '추가 로그인 필요',
      error: '오류',
    }[state];
    return {
      browserId,
      name: browserId === 'edge' ? '엣지' : '크롬',
      recommended: browserId === 'edge',
      state,
      stateLabel,
      systems,
      ...(status?.lastSeenAt !== undefined ? { lastSeenAt: status.lastSeenAt } : {}),
    };
  });
}

export function createEducationOfficePatch(
  config: Pick<AppConfig, 'root'>,
  educationOfficeCode: EducationOfficeCode,
): Pick<AppConfig, 'educationOfficeCode' | 'root'> {
  return {
    educationOfficeCode,
    root: retargetWebWorkflowItems(config.root, educationOfficeCode),
  };
}

export function getWebWorkflowEditorModel(item: ActionItem): {
  managed: boolean;
  browserId?: WebConnectorBrowserId;
  officeCode?: EducationOfficeCode;
  showGeneralBrowserSettings: boolean;
} {
  if (!item.webWorkflow) {
    return { managed: false, showGeneralBrowserSettings: true };
  }
  return {
    managed: true,
    browserId: item.webWorkflow.browserId,
    officeCode: resolveWebWorkflowOfficeCode(item.webWorkflow, item.target),
    showGeneralBrowserSettings: false,
  };
}

export function updateWebWorkflowBrowser(
  item: ActionItem,
  browserId: WebConnectorBrowserId,
): ActionItem {
  if (!item.webWorkflow) return item;
  const managedItem = { ...item };
  delete managedItem.browser;
  return {
    ...managedItem,
    webWorkflow: { ...item.webWorkflow, browserId },
  };
}

export function updateWebWorkflowOffice(
  item: ActionItem,
  officeCode: EducationOfficeCode,
): ActionItem {
  if (!item.webWorkflow) return item;
  const webWorkflow = { ...item.webWorkflow, officeCode };
  return {
    ...item,
    target: getWebWorkflowTargetForSpec(webWorkflow, officeCode),
    webWorkflow,
  };
}

export function updateCustomWebWorkflowName(
  item: ActionItem,
  name: string,
): ActionItem {
  if (item.webWorkflow?.id !== 'custom') return { ...item, label: name };
  return {
    ...item,
    label: name,
    webWorkflow: {
      ...item.webWorkflow,
      custom: { ...item.webWorkflow.custom, name },
    },
  };
}

export interface WebWorkflowSummary {
  label: string;
  systemLabel: '나이스' | '에듀파인';
  custom: boolean;
  route: string[];
  finalText?: string;
}

export function getWebWorkflowSummary(item: ActionItem): WebWorkflowSummary | null {
  const spec = item.webWorkflow;
  if (!spec) return null;
  if (spec.id === 'custom') {
    return {
      label: spec.custom.name,
      systemLabel: spec.custom.system === 'neis' ? '나이스' : '에듀파인',
      custom: true,
      route: spec.custom.steps.map((step) => step.label),
      finalText: spec.custom.finalText,
    };
  }
  const definition = getWebWorkflowDefinition(spec.id);
  return {
    label: definition.label,
    systemLabel: definition.system === 'neis' ? '나이스' : '에듀파인',
    custom: false,
    route: [],
  };
}
