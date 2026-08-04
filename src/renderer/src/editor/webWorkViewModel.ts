import { retargetWebWorkflowItems } from '../../../shared/webWorkflows';
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
