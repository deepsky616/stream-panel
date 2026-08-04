import type { ManagedWorkflowDefinition } from './common';

const COMMON_CHECKS = { maxChecks: 3 as const, checkDelayMs: 250 };

export const NEIS_WORKFLOWS = {
  'neis-leave': {
    id: 'neis-leave',
    label: '나이스 복무',
    finalState: 'leave-request-form',
    steps: [
      {
        id: 'open-duty-section',
        candidateLabels: ['복무'],
        interaction: 'mouse',
        postcondition: {
          kind: 'visible-any',
          labels: ['개인근무상황관리', '개인근무상황', '개인출장관리', '출장관리'],
        },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-leave-management',
        candidateLabels: ['개인근무상황관리', '개인근무상황'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['신청'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-leave-form',
        candidateLabels: ['신청'],
        interaction: 'dom-click',
        postcondition: { kind: 'dialog-title-any', labels: ['근무상황신청'] },
        ...COMMON_CHECKS,
      },
    ],
  },
  'neis-trip': {
    id: 'neis-trip',
    label: '나이스 출장',
    finalState: 'trip-request-form',
    steps: [
      {
        id: 'open-duty-section',
        candidateLabels: ['복무'],
        interaction: 'mouse',
        postcondition: {
          kind: 'visible-any',
          labels: ['개인근무상황관리', '개인근무상황', '개인출장관리', '출장관리'],
        },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-trip-management',
        candidateLabels: ['개인출장관리', '출장관리'],
        interaction: 'mouse',
        postcondition: { kind: 'visible-any', labels: ['신청'] },
        ...COMMON_CHECKS,
      },
      {
        id: 'open-trip-form',
        candidateLabels: ['신청'],
        interaction: 'dom-click',
        postcondition: { kind: 'dialog-title-any', labels: ['출장신청'] },
        ...COMMON_CHECKS,
      },
    ],
  },
} as const satisfies Record<'neis-leave' | 'neis-trip', ManagedWorkflowDefinition>;
