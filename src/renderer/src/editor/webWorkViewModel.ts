import {
  getWebWorkflowDefinition,
  retargetWebWorkflowItems,
} from '../../../shared/webWorkflows';
import type {
  ActionItem,
  AppConfig,
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebConnectorStatus,
} from '../../../shared/types';

export type WebWorkBrowserState = 'ready' | 'running' | 'needs-connection' | 'error';

export interface WebWorkBrowserCard {
  browserId: WebConnectorBrowserId;
  name: string;
  recommended: boolean;
  state: WebWorkBrowserState;
  stateLabel: string;
  lastSeenAt?: number;
}

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
    const state: WebWorkBrowserState = errorBrowserId === browserId
      ? 'error'
      : busyBrowserId === browserId
        ? 'running'
        : status?.paired || status?.connected
          ? 'ready'
          : 'needs-connection';
    const stateLabel = {
      ready: '준비됨',
      running: '실행 중',
      'needs-connection': '연결 필요',
      error: '오류',
    }[state];
    return {
      browserId,
      name: browserId === 'edge' ? '엣지' : '크롬',
      recommended: browserId === 'edge',
      state,
      stateLabel,
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
  showGeneralBrowserSettings: boolean;
} {
  if (!item.webWorkflow) {
    return { managed: false, showGeneralBrowserSettings: true };
  }
  return {
    managed: true,
    browserId: item.webWorkflow.browserId,
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
