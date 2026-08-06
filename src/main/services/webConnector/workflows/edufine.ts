import type { ManagedWorkflowDefinition, WorkflowPostcondition } from './common';

const COMMON_CHECKS = {
  maxChecks: 60,
  checkDelayMs: 500,
  skipWhenSatisfied: true,
};

const PURCHASE_FORM_READY: WorkflowPostcondition = {
  kind: 'visible-groups',
  groups: [
    ['품의등록', '품의 등록'],
    ['기본정보', '제목', '개요', '예산내역', '품목내역'],
  ],
};

const BUSINESS_PURCHASE_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'edufine-purchase',
  label: '에듀파인 품의',
  finalState: 'purchase-registration-form',
  steps: [
    {
      id: 'select-school-accounting',
      candidateLabels: ['학교회계'],
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['사업담당', '사업관리'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-business-owner',
      candidateLabels: ['사업담당', '사업관리'],
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['품의/정산', '품의·정산'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-purchase-section',
      candidateLabels: ['품의/정산', '품의·정산'],
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['품의등록', '품의 등록'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-purchase-registration',
      candidateLabels: ['품의등록', '품의 등록'],
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: PURCHASE_FORM_READY,
      ...COMMON_CHECKS,
    },
  ],
};

const EXPENDITURE_PURCHASE_WORKFLOW: ManagedWorkflowDefinition = {
  id: 'edufine-purchase',
  label: '에듀파인 품의',
  finalState: 'purchase-registration-form',
  steps: [
    {
      id: 'select-school-accounting',
      candidateLabels: ['학교회계'],
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['지출관리'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-expenditure-management',
      candidateLabels: ['지출관리'],
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['지출처리'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-expenditure-processing',
      candidateLabels: ['지출처리'],
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['지출품의', '품의등록', '품의 등록'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-expenditure-proposal',
      candidateLabels: ['지출품의', '품의등록', '품의 등록'],
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: { kind: 'visible-any', labels: ['품의등록', '품의 등록'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-purchase-registration',
      candidateLabels: ['품의등록', '품의 등록'],
      selection: 'first-available',
      interaction: 'mouse',
      postcondition: PURCHASE_FORM_READY,
      ...COMMON_CHECKS,
    },
  ],
};

export const EDUFINE_PURCHASE_WORKFLOW_ROUTES = [
  BUSINESS_PURCHASE_WORKFLOW,
  EXPENDITURE_PURCHASE_WORKFLOW,
] as const;

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
        postcondition: { kind: 'visible-any', labels: ['기안'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-draft-menu',
        candidateLabels: ['기안'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['공용서식', '공용 서식'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-public-forms',
        candidateLabels: ['공용서식', '공용 서식'],
        selection: 'first-available',
        interaction: 'mouse',
        postcondition: {
          kind: 'visible-any',
          labels: [
            '표준서식(결재4인,협조4인)',
            '표준서식(결재 4인, 협조 4인)',
            '표준서식(결재4인, 협조4인)',
          ],
        },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-standard-form',
        candidateLabels: [
          '표준서식(결재4인,협조4인)',
          '표준서식(결재 4인, 협조 4인)',
          '표준서식(결재4인, 협조4인)',
        ],
        selection: 'first-available',
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
  'edufine-purchase': BUSINESS_PURCHASE_WORKFLOW,
} as const satisfies Record<'edufine-draft' | 'edufine-purchase', ManagedWorkflowDefinition>;
