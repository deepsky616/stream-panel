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

const COMMON_CHECKS = { maxChecks: 60 as const, checkDelayMs: 500 };
const APPROVAL_LABELS = ['결재함', '내 결재함', '결재문서함'] as const;
const APPROVAL_READY_LABELS = [
  '대기문서',
  '미결문서',
  '결재할 문서',
  '결재 대기',
  '결재대기',
] as const;

const NEIS_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'neis-approval-inbox',
  label: '나이스 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    {
      id: 'open-approval-inbox',
      candidateLabels: APPROVAL_LABELS,
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: APPROVAL_READY_LABELS },
      ...COMMON_CHECKS,
    },
  ],
};

const EDUFINE_DIRECT_APPROVAL_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'edufine-approval-inbox',
  label: '에듀파인 결재함',
  finalState: 'approval-inbox-ready',
  steps: [
    {
      id: 'open-work-management',
      candidateLabels: ['업무관리'],
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: APPROVAL_LABELS },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-approval-inbox',
      candidateLabels: APPROVAL_LABELS,
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: APPROVAL_READY_LABELS },
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
      id: 'open-work-management',
      candidateLabels: ['업무관리'],
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['문서관리'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-document-management',
      candidateLabels: ['문서관리'],
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: APPROVAL_LABELS },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-approval-inbox',
      candidateLabels: APPROVAL_LABELS,
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: APPROVAL_READY_LABELS },
      ...COMMON_CHECKS,
    },
  ],
};

export const APPROVAL_INBOX_WORKFLOW_ROUTES: Record<
  WebWorkflowSystem,
  readonly ManagedWorkflowDefinition[]
> = {
  neis: [NEIS_APPROVAL_WORKFLOW],
  edufine: [EDUFINE_DIRECT_APPROVAL_WORKFLOW, EDUFINE_DOCUMENT_APPROVAL_WORKFLOW],
};

export const APPROVAL_INBOX_WORKFLOWS: Record<WebWorkflowSystem, ManagedWorkflowDefinition> = {
  neis: NEIS_APPROVAL_WORKFLOW,
  edufine: EDUFINE_DIRECT_APPROVAL_WORKFLOW,
};
