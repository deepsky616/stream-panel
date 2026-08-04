import type { ManagedWorkflowDefinition } from './common';

const COMMON_CHECKS = { maxChecks: 3 as const, checkDelayMs: 250 };

export const EDUFINE_WORKFLOWS = {
  'edufine-draft': {
    id: 'edufine-draft',
    label: '에듀파인 기안',
    finalState: 'standard-form-editor',
    steps: [
      {
        id: 'select-business-management',
        candidateLabels: ['업무관리'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['문서관리'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-document-management',
        candidateLabels: ['문서관리'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['공용서식'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-public-forms',
        candidateLabels: ['공용서식'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['표준서식(결재4인,협조4인)'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-standard-form',
        candidateLabels: ['표준서식(결재4인,협조4인)'],
        interaction: 'dom-click',
        postcondition: {
          kind: 'new-window',
          processName: 'WXSClient',
          titleIncludes: '표준서식',
        },
        ...COMMON_CHECKS,
      },
    ],
  },
  'edufine-purchase': {
    id: 'edufine-purchase',
    label: '에듀파인 품의',
    finalState: 'purchase-registration-form',
    steps: [
      {
        id: 'select-school-accounting',
        candidateLabels: ['학교회계'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['사업관리'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-project-management',
        candidateLabels: ['사업관리'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['품의등록'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-purchase-registration',
        candidateLabels: ['품의등록'],
        interaction: 'mouse',
        postcondition: {
          kind: 'visible-all',
          labels: ['품의등록', '예산내역', '품목내역', '결재요청'],
        },
        ...COMMON_CHECKS,
      },
    ],
  },
} as const satisfies Record<'edufine-draft' | 'edufine-purchase', ManagedWorkflowDefinition>;
