import { createNeisHomeStep, type ManagedWorkflowDefinition } from './common';

const COMMON_CHECKS = {
  // Keep the same 10-second tolerance while detecting stable menus twice as fast.
  maxChecks: 40,
  checkDelayMs: 250,
  skipWhenSatisfied: true,
};

export const NEIS_WORKFLOWS = {
  'neis-leave': {
    id: 'neis-leave',
    label: '나이스 복무',
    finalState: 'leave-request-form',
    steps: [
      createNeisHomeStep(['복무']),
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
        selection: 'first-available',
        // Prefer the already opened lower work tab. The adapter falls back to
        // the unique management entry on the first visit before a tab exists.
        interaction: 'neis-management-tab',
        postcondition: {
          kind: 'active-view-any',
          labels: ['개인근무상황관리', '개인근무상황'],
        },
        ...COMMON_CHECKS,
        // Both leave and trip screens expose a generic 신청 label. Wait for
        // the requested manager to become the selected view before clicking it.
        skipWhenSatisfied: false,
      },
      {
        id: 'open-leave-form',
        candidateLabels: ['신청(새 창 열기)', '신청'],
        selection: 'first-available',
        interaction: 'dom-click',
        allowActionText: true,
        postcondition: {
          kind: 'new-page-any',
          labels: ['근무상황신청', '개인근무상황신청'],
        },
        ...COMMON_CHECKS,
        skipWhenSatisfied: false,
      },
    ],
  },
  'neis-trip': {
    id: 'neis-trip',
    label: '나이스 출장',
    finalState: 'trip-request-form',
    steps: [
      createNeisHomeStep(['복무']),
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
        selection: 'first-available',
        interaction: 'neis-management-tab',
        postcondition: {
          kind: 'active-view-any',
          labels: ['개인출장관리', '출장관리'],
        },
        ...COMMON_CHECKS,
        // A leave screen also exposes 신청. Do not advance until the trip
        // manager itself is selected or rendered as the active page heading.
        skipWhenSatisfied: false,
      },
      {
        id: 'open-trip-form',
        candidateLabels: ['신청(새 창 열기)', '신청'],
        selection: 'first-available',
        interaction: 'dom-click',
        allowActionText: true,
        postcondition: { kind: 'new-page-any', labels: ['출장신청'] },
        ...COMMON_CHECKS,
        skipWhenSatisfied: false,
      },
    ],
  },
} as const satisfies Record<'neis-leave' | 'neis-trip', ManagedWorkflowDefinition>;
