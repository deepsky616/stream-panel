import type { ManagedWorkflowDefinition, WorkflowPostcondition } from './common';

const COMMON_CHECKS = {
  // Edufine frames often appear quickly but can take up to 20 seconds on busy days.
  // Poll sooner without shortening the existing recovery window.
  maxChecks: 134,
  checkDelayMs: 150,
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
      id: 'select-school-accounting-job',
      candidateLabels: ['학교회계'],
      selection: 'first-available',
      interaction: 'edufine-job',
      postcondition: { kind: 'visible-any', labels: ['사업관리', '사업 관리', '사업담당', '사업 담당'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-business-menu',
      candidateLabels: ['사업관리', '사업 관리', '사업담당', '사업 담당'],
      selection: 'first-available',
      interaction: 'edufine-top-menu',
      postcondition: {
        kind: 'edufine-mega-menu-any',
        labels: ['품의/정산', '품의 / 정산', '품의등록', '품의 등록'],
      },
      ...COMMON_CHECKS,
      skipWhenSatisfied: false,
    },
    {
      id: 'open-purchase-settlement',
      candidateLabels: ['품의/정산', '품의 / 정산'],
      selection: 'first-available',
      interaction: 'edufine-mega-menu',
      postcondition: { kind: 'visible-any', labels: ['품의등록', '품의 등록'] },
      ...COMMON_CHECKS,
    },
    {
      id: 'open-purchase-registration',
      candidateLabels: ['품의등록', '품의 등록'],
      selection: 'first-available',
      interaction: 'edufine-mega-menu',
      postcondition: PURCHASE_FORM_READY,
      ...COMMON_CHECKS,
      // '등록' is normally protected as a consequential action. This fixed,
      // exact menu label only opens the registration form; it never saves it.
      allowActionText: true,
      skipWhenSatisfied: false,
    },
  ],
};

export const EDUFINE_PURCHASE_WORKFLOW_ROUTES = [
  BUSINESS_PURCHASE_WORKFLOW,
] as const;

export const EDUFINE_WORKFLOWS = {
  'edufine-draft': {
    id: 'edufine-draft',
    label: '에듀파인 기안',
    finalState: 'standard-form-editor',
    steps: [
      {
        id: 'select-business-management-job',
        candidateLabels: ['업무관리'],
        selection: 'first-available',
        interaction: 'edufine-job',
        postcondition: { kind: 'visible-any', labels: ['문서관리', '문서 관리'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-document-management',
        candidateLabels: ['문서관리', '문서 관리'],
        selection: 'first-available',
        interaction: 'edufine-top-menu',
        postcondition: {
          kind: 'edufine-mega-menu-any',
          labels: ['공용서식', '공용 서식', '공통서식', '공통 서식'],
        },
        ...COMMON_CHECKS,
        skipWhenSatisfied: false,
      },
      {
        id: 'open-public-forms',
        candidateLabels: ['공용서식', '공용 서식', '공통서식', '공통 서식'],
        selection: 'first-available',
        interaction: 'edufine-mega-menu',
        postcondition: {
          kind: 'visible-any',
          labels: [
            '표준서식(결재4인,협조4인)',
            '표준서식(결재 4인, 협조 4인)',
            '표준서식(결재4인, 협조4인)',
            '표준서식(결재 4인,협조 4인)',
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
          '표준서식(결재 4인,협조 4인)',
        ],
        selection: 'first-available',
        interaction: 'frame-exact-text',
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
