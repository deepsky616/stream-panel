import type {
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebWorkflowSystem,
} from '../../../shared/types';
import type { ManagedWorkflowDefinition } from '../webConnector/workflows/common';

export interface ApprovalScanInput {
  system: WebWorkflowSystem;
  officeCode: EducationOfficeCode;
  browserId: WebConnectorBrowserId;
}

const COMMON_CHECKS = {
  maxChecks: 80 as const,
  checkDelayMs: 250,
  skipWhenSatisfied: true,
};
const NEIS_PENDING_COOPERATION_LABELS = ['미결/협조함', '미결 / 협조함'] as const;
const EDUFINE_WAITING_LABELS = ['결재대기', '결재 대기'] as const;

const NEIS_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'neis-approval-inbox',
  label: '나이스 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    {
      id: 'open-pending-cooperation-inbox',
      candidateLabels: NEIS_PENDING_COOPERATION_LABELS,
      selection: 'first-available',
      interaction: 'mouse',
      menuOnly: true,
      contextLabels: ['승인사항'],
      postcondition: { kind: 'tab-selected-any', labels: NEIS_PENDING_COOPERATION_LABELS },
      ...COMMON_CHECKS,
    },
  ],
};

const EDUFINE_DOCUMENT_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'edufine-approval-inbox',
  label: '에듀파인 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    {
      id: 'open-document-approval-menu',
      candidateLabels: ['결재'],
      interaction: 'edufine-top-menu',
      allowActionText: true,
      postcondition: { kind: 'visible-any', labels: EDUFINE_WAITING_LABELS },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-waiting-approval-inbox',
      candidateLabels: EDUFINE_WAITING_LABELS,
      selection: 'first-available',
      interaction: 'edufine-mega-menu',
      postcondition: {
        kind: 'visible-groups',
        groups: [
          EDUFINE_WAITING_LABELS,
          ['결재할 문서', '문서번호', '제목', '기안자', '총', '전체'],
        ],
      },
      ...COMMON_CHECKS,
    },
  ],
};

export const APPROVAL_INBOX_WORKFLOW_ROUTES: Record<
  WebWorkflowSystem,
  readonly ManagedWorkflowDefinition[]
> = {
  neis: [NEIS_APPROVAL_WORKFLOW],
  edufine: [EDUFINE_DOCUMENT_APPROVAL_WORKFLOW],
};

export const APPROVAL_INBOX_WORKFLOWS: Record<WebWorkflowSystem, ManagedWorkflowDefinition> = {
  neis: NEIS_APPROVAL_WORKFLOW,
  edufine: EDUFINE_DOCUMENT_APPROVAL_WORKFLOW,
};
