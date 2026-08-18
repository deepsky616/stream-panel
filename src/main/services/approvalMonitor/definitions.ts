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
  /** Show the connected system tab when a user-triggered check needs attention. */
  interactive?: boolean;
}

const COMMON_CHECKS = {
  maxChecks: 134 as const,
  checkDelayMs: 150,
  skipWhenSatisfied: true,
};
const NEIS_PENDING_COOPERATION_LABELS = ['미결/협조함', '미결 / 협조함'] as const;
const EDUFINE_WAITING_LABELS = ['결재대기', '결재 대기', '결재대기함', '결재 대기함'] as const;
const NEIS_TOTAL_LABELS = ['Total', 'TOTAL', 'total'] as const;
const NEIS_EMPTY_OR_LIST_LABELS = [
  ...NEIS_TOTAL_LABELS,
  '문서번호',
  '기안일자',
  '기안자',
  '조회 결과가 없습니다',
  '조회된 자료가 없습니다',
  '조회된 내역이 없습니다',
] as const;

const NEIS_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'neis-approval-inbox',
  label: '나이스 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    {
      id: 'open-pending-cooperation-inbox',
      candidateLabels: NEIS_PENDING_COOPERATION_LABELS,
      selection: 'first-available',
      interaction: 'frame-exact-text',
      postcondition: { kind: 'visible-any', labels: NEIS_EMPTY_OR_LIST_LABELS },
      ...COMMON_CHECKS,
      skipWhenSatisfied: false,
    },
  ],
};

const EDUFINE_DOCUMENT_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'edufine-approval-inbox',
  label: '에듀파인 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    {
      id: 'select-business-management-job',
      candidateLabels: ['업무관리'],
      selection: 'first-available',
      interaction: 'edufine-job',
      postcondition: { kind: 'visible-any', labels: ['결재', '결재(긴급)', '결재 (긴급)'] },
      ...COMMON_CHECKS,
      // Always switch cboJobList to 업무관리. A stale 결재 label can remain in
      // another frame even while 학교회계 is the active job.
      skipWhenSatisfied: false,
    },
    {
      id: 'open-document-approval-menu',
      candidateLabels: ['결재', '결재(긴급)', '결재 (긴급)'],
      selection: 'first-available',
      // In current K-Edufine layouts this launcher is in the right quick-menu,
      // not TopFrame. The matcher still accepts an explicitly named right frame.
      interaction: 'edufine-right-menu',
      allowActionText: true,
      postcondition: { kind: 'edufine-mega-menu-any', labels: EDUFINE_WAITING_LABELS },
      ...COMMON_CHECKS,
      // `결재대기` can remain visible as a breadcrumb or an already opened tab.
      // Always open the real Nexacro top menu so the next step can only select
      // an item from the newly displayed mega menu.
      skipWhenSatisfied: false,
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
