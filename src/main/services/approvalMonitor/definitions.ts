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
const FAST_TOP_MENU_CHECKS = {
  maxChecks: 50 as const,
  checkDelayMs: 100,
  skipWhenSatisfied: false,
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

const EDUFINE_JOB_STEP = {
  id: 'select-business-management-job',
  candidateLabels: ['업무관리'],
  selection: 'first-available',
  interaction: 'edufine-job',
  postcondition: { kind: 'visible-any', labels: ['문서관리', '문서 관리'] },
  ...COMMON_CHECKS,
  // Always switch cboJobList to 업무관리. A stale 문서관리 heading can
  // remain in another frame even while 학교회계 is the active job.
  skipWhenSatisfied: false,
} as const;

const EDUFINE_WAITING_INBOX_STEP = {
  id: 'open-waiting-approval-inbox',
  candidateLabels: EDUFINE_WAITING_LABELS,
  selection: 'first-available',
  // A few skins place 결재대기 under pdvMegaMenu while others use a generic
  // popup. The popup adapter accepts either surface but still requires one
  // exact, visible menu item.
  interaction: 'edufine-popup-menu',
  postcondition: {
    kind: 'visible-groups',
    groups: [
      EDUFINE_WAITING_LABELS,
      [
        '결재할 문서',
        '문서번호',
        '문서제목',
        '제목',
        '기안자',
        '기안일자',
        '처리기한',
        '조회 결과가 없습니다',
        '조회된 자료가 없습니다',
      ],
    ],
  },
  ...COMMON_CHECKS,
  skipWhenSatisfied: false,
} as const;

const EDUFINE_TOP_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'edufine-approval-inbox',
  label: '에듀파인 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    EDUFINE_JOB_STEP,
    {
      id: 'open-top-approval-menu',
      candidateLabels: ['결재'],
      selection: 'first-available',
      // TopFrame ids are more stable than screen coordinates. Exact matching
      // guarantees that the right-side 결재(긴급) shortcut is never selected.
      interaction: 'edufine-top-menu',
      postcondition: { kind: 'visible-any', labels: EDUFINE_WAITING_LABELS },
      ...FAST_TOP_MENU_CHECKS,
    },
    EDUFINE_WAITING_INBOX_STEP,
  ],
};

const EDUFINE_DOCUMENT_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'edufine-approval-inbox',
  label: '에듀파인 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    EDUFINE_JOB_STEP,
    {
      id: 'open-document-approval-menu',
      candidateLabels: ['결재'],
      selection: 'first-available',
      // Open the exact 결재 menu in the 문서관리 section first. Exact-label
      // matching plus the scoped adapter excludes the right-side 결재(긴급).
      interaction: 'edufine-document-menu',
      postcondition: {
        kind: 'edufine-mega-menu-any',
        labels: EDUFINE_WAITING_LABELS,
      },
      ...COMMON_CHECKS,
      skipWhenSatisfied: false,
    },
    EDUFINE_WAITING_INBOX_STEP,
  ],
};

export const APPROVAL_INBOX_WORKFLOW_ROUTES: Record<
  WebWorkflowSystem,
  readonly ManagedWorkflowDefinition[]
> = {
  neis: [NEIS_APPROVAL_WORKFLOW],
  edufine: [EDUFINE_TOP_APPROVAL_WORKFLOW, EDUFINE_DOCUMENT_APPROVAL_WORKFLOW],
};

export const APPROVAL_INBOX_WORKFLOWS: Record<WebWorkflowSystem, ManagedWorkflowDefinition> = {
  neis: NEIS_APPROVAL_WORKFLOW,
  edufine: EDUFINE_TOP_APPROVAL_WORKFLOW,
};
