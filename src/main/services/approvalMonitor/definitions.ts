import type { WebWorkflowSystem } from '../../../shared/types';
import type { ManagedWorkflowDefinition } from '../webConnector/workflows/common';

const COMMON_CHECKS = { maxChecks: 3 as const, checkDelayMs: 250 };

export const APPROVAL_INBOX_WORKFLOWS: Record<WebWorkflowSystem, ManagedWorkflowDefinition> = {
  neis: {
    id: 'neis-approval-inbox',
    label: '나이스 결재함',
    finalState: 'approval-inbox-ready',
    steps: [
      {
        id: 'open-approval-inbox',
        candidateLabels: ['결재함'],
        interaction: 'dom-click',
        navigationOnly: true,
        postcondition: {
          kind: 'visible-any',
          labels: ['대기문서', '미결문서', '결재 대기', '결재대기'],
        },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-pending-documents',
        candidateLabels: ['대기문서', '미결문서', '결재 대기', '결재대기'],
        interaction: 'dom-click',
        navigationOnly: true,
        postcondition: {
          kind: 'visible-any',
          labels: ['대기문서', '미결문서', '결재 대기', '결재대기'],
        },
        ...COMMON_CHECKS,
      },
    ],
  },
  edufine: {
    id: 'edufine-approval-inbox',
    label: '에듀파인 결재함',
    finalState: 'approval-inbox-ready',
    steps: [
      {
        id: 'open-work-management',
        candidateLabels: ['업무관리'],
        interaction: 'dom-click',
        navigationOnly: true,
        postcondition: { kind: 'visible-any', labels: ['결재함'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-approval-inbox',
        candidateLabels: ['결재함'],
        interaction: 'dom-click',
        navigationOnly: true,
        postcondition: {
          kind: 'visible-any',
          labels: ['대기문서', '미결문서', '결재할 문서', '결재 대기'],
        },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-pending-documents',
        candidateLabels: ['대기문서', '미결문서', '결재할 문서', '결재 대기'],
        interaction: 'dom-click',
        navigationOnly: true,
        postcondition: {
          kind: 'visible-any',
          labels: ['대기문서', '미결문서', '결재할 문서', '결재 대기'],
        },
        ...COMMON_CHECKS,
      },
    ],
  },
};
