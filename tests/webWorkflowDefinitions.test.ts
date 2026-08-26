import { describe, expect, it } from 'vitest';
import type { BuiltInWebWorkflowId } from '../src/shared/types';
import {
  EDUFINE_DRAFT_WORKFLOW_ROUTES,
  EDUFINE_WORKFLOWS,
} from '../src/main/services/webConnector/workflows/edufine';
import { NEIS_WORKFLOWS } from '../src/main/services/webConnector/workflows/neis';
import {
  isForbiddenActionText,
  NEIS_OFFICE_HOME_LABELS,
} from '../src/main/services/webConnector/workflows/common';
import * as workflowCommon from '../src/main/services/webConnector/workflows/common';
import type { WebWorkflowSpec } from '../src/shared/types';
import {
  APPROVAL_INBOX_WORKFLOW_ROUTES,
  APPROVAL_INBOX_WORKFLOWS,
} from '../src/main/services/approvalMonitor/definitions';

const definitions = { ...NEIS_WORKFLOWS, ...EDUFINE_WORKFLOWS };
const allDefinitions = { ...definitions, ...APPROVAL_INBOX_WORKFLOWS };

describe('managed web workflow definitions', () => {
  it('turns a custom path into checked navigation steps ending at the requested screen text', () => {
    const createCustomManagedWorkflowDefinition = (
      workflowCommon as unknown as {
        createCustomManagedWorkflowDefinition?: (spec: WebWorkflowSpec) => unknown;
      }
    ).createCustomManagedWorkflowDefinition;
    expect(createCustomManagedWorkflowDefinition).toBeTypeOf('function');
    expect(createCustomManagedWorkflowDefinition!({
      id: 'custom',
      browserId: 'edge',
      custom: {
        name: '에듀파인 문서함',
        system: 'edufine',
        steps: [
          { id: 'step-1', label: '업무관리' },
          { id: 'step-2', label: '문서관리' },
          { id: 'step-3', label: '내 문서함' },
        ],
        finalText: '내 문서함 목록',
      },
    })).toEqual({
      id: 'custom',
      label: '에듀파인 문서함',
      finalState: 'custom-target-ready',
      steps: [
        expect.objectContaining({
          id: 'step-1',
          candidateLabels: ['업무관리'],
          interaction: 'frame-exact-text',
          selection: 'first-available',
          navigationOnly: false,
          skipWhenSatisfied: true,
          postcondition: { kind: 'visible-any', labels: ['문서관리'] },
        }),
        expect.objectContaining({
          id: 'step-2',
          candidateLabels: ['문서관리'],
          interaction: 'frame-exact-text',
          selection: 'first-available',
          navigationOnly: false,
          skipWhenSatisfied: true,
          postcondition: { kind: 'visible-any', labels: ['내 문서함'] },
        }),
        expect.objectContaining({
          id: 'step-3',
          candidateLabels: ['내 문서함'],
          interaction: 'frame-exact-text',
          selection: 'first-available',
          navigationOnly: false,
          skipWhenSatisfied: true,
          postcondition: { kind: 'visible-any', labels: ['내 문서함 목록'] },
        }),
      ],
    });
  });

  it('marks configured important custom steps for per-run confirmation', () => {
    const createCustomManagedWorkflowDefinition = (
      workflowCommon as unknown as {
        createCustomManagedWorkflowDefinition(spec: WebWorkflowSpec): {
          steps: Array<Record<string, unknown>>;
        };
      }
    ).createCustomManagedWorkflowDefinition;
    const definition = createCustomManagedWorkflowDefinition({
      id: 'custom',
      browserId: 'edge',
      custom: {
        name: '확인 후 저장',
        system: 'edufine',
        steps: [{ id: 'step-1', label: '저장' }],
        finalText: '저장 완료',
      },
    });

    expect(definition.steps[0]).toEqual(expect.objectContaining({
      candidateLabels: ['저장'],
      navigationOnly: false,
      interaction: 'frame-exact-text',
      requiresConfirmation: true,
    }));
  });

  it('uses the selected Nexacro adapters for a structured custom Edufine route', () => {
    const createCustomManagedWorkflowDefinition = (
      workflowCommon as unknown as {
        createCustomManagedWorkflowDefinition(spec: WebWorkflowSpec): {
          steps: Array<Record<string, unknown>>;
        };
      }
    ).createCustomManagedWorkflowDefinition;
    const definition = createCustomManagedWorkflowDefinition({
      id: 'custom',
      browserId: 'edge',
      custom: {
        name: '사용자 품의 업무',
        system: 'edufine',
        steps: [
          { id: 'step-1', label: '학교회계', kind: 'edufine-job' },
          { id: 'step-2', label: '사업담당', kind: 'edufine-top-menu' },
          { id: 'step-3', label: '품의등록', kind: 'edufine-mega-menu' },
        ],
        finalText: '품의 등록 화면',
      },
    });

    expect(definition.steps.map(({ interaction }) => interaction)).toEqual([
      'edufine-job',
      'edufine-top-menu',
      'edufine-mega-menu',
    ]);
    expect(definition.steps[1]).toEqual(expect.objectContaining({
      skipWhenSatisfied: false,
      postcondition: { kind: 'edufine-mega-menu-any', labels: ['품의등록'] },
    }));
    expect(definition.steps[2]).toEqual(expect.objectContaining({
      allowActionText: true,
      postcondition: { kind: 'visible-any', labels: ['품의 등록 화면'] },
    }));
    expect(definition.steps[2]).not.toHaveProperty('requiresConfirmation');
  });

  it('supports the full custom NEIS route including management tabs and new request pages', () => {
    const definition = workflowCommon.createCustomManagedWorkflowDefinition({
      id: 'custom',
      browserId: 'edge',
      custom: {
        name: '사용자 출장 신청',
        system: 'neis',
        steps: [
          { id: 'step-1', label: '개인출장관리', kind: 'neis-management-tab' },
          { id: 'step-2', label: '신청', kind: 'neis-new-page' },
        ],
        finalText: '출장신청',
      },
    });

    expect(definition.steps.map(({ interaction }) => interaction)).toEqual([
      'neis-home',
      'neis-management-tab',
      'frame-exact-text',
    ]);
    expect(definition.steps[0].postcondition).toEqual({
      kind: 'visible-any',
      labels: ['개인출장관리'],
    });
    expect(definition.steps[1].postcondition).toEqual({
      kind: 'active-view-any',
      labels: ['신청'],
    });
    expect(definition.steps[2]).toEqual(expect.objectContaining({
      requiresConfirmation: true,
      skipWhenSatisfied: false,
      postcondition: { kind: 'new-page-any', labels: ['출장신청'] },
    }));
  });

  it('supports scoped Edufine menus and an exact standard-form WXSClient launch', () => {
    const definition = workflowCommon.createCustomManagedWorkflowDefinition({
      id: 'custom',
      browserId: 'edge',
      custom: {
        name: '사용자 표준 기안',
        system: 'edufine',
        steps: [
          { id: 'step-1', label: '업무관리', kind: 'edufine-job' },
          { id: 'step-2', label: '기안', kind: 'edufine-left-menu' },
          { id: 'step-3', label: '공용서식', kind: 'edufine-submenu' },
          {
            id: 'step-4',
            label: '표준서식(결재4인,협조4인)',
            kind: 'edufine-wxs-form',
          },
        ],
        finalText: '표준서식',
      },
    });

    expect(definition.steps.map(({ interaction }) => interaction)).toEqual([
      'edufine-job',
      'edufine-left-menu',
      'edufine-submenu',
      'frame-exact-text',
    ]);
    expect(definition.steps[3]).toEqual(expect.objectContaining({
      allowActionText: true,
      skipWhenSatisfied: false,
      postcondition: {
        kind: 'new-window',
        processName: 'WXSClient',
        titleIncludes: '표준서식',
      },
    }));
    expect(definition.steps[3]).not.toHaveProperty('requiresConfirmation');
  });

  it.each(['상신', '승인'])('allows %s as a confirmed custom step', (label) => {
    const createCustomManagedWorkflowDefinition = (
      workflowCommon as unknown as {
        createCustomManagedWorkflowDefinition(spec: WebWorkflowSpec): {
          steps: Array<Record<string, unknown>>;
        };
      }
    ).createCustomManagedWorkflowDefinition;
    const definition = createCustomManagedWorkflowDefinition({
      id: 'custom',
      browserId: 'edge',
      custom: {
        name: `${label} 업무`,
        system: 'edufine',
        steps: [{ id: 'step-1', label }],
        finalText: `${label} 화면`,
      },
    });

    expect(definition.steps[0]).toEqual(expect.objectContaining({
      candidateLabels: [label],
      requiresConfirmation: true,
    }));
  });

  it('defines only the four approved workflows and their final user-input states', () => {
    expect(Object.keys(definitions).sort()).toEqual([
      'edufine-draft',
      'edufine-purchase',
      'neis-leave',
      'neis-trip',
    ]);
    expect(definitions['neis-leave'].finalState).toBe('leave-request-form');
    expect(definitions['neis-trip'].finalState).toBe('trip-request-form');
    expect(definitions['edufine-draft'].finalState).toBe('standard-form-editor');
    expect(definitions['edufine-purchase'].finalState).toBe('purchase-registration-form');
  });

  it('uses fixed navigation labels and explicit postconditions for every step', () => {
    expect(definitions['neis-leave'].steps.map(({ candidateLabels }) => candidateLabels)).toEqual([
      NEIS_OFFICE_HOME_LABELS,
      ['복무'],
      ['개인근무상황관리', '개인근무상황'],
      ['신청(새 창 열기)', '신청'],
    ]);
    expect(definitions['neis-trip'].steps.map(({ candidateLabels }) => candidateLabels)).toEqual([
      NEIS_OFFICE_HOME_LABELS,
      ['복무'],
      ['개인출장관리', '출장관리'],
      ['신청(새 창 열기)', '신청'],
    ]);
    expect(definitions['edufine-draft'].steps.map(({ candidateLabels }) => candidateLabels)).toEqual([
      ['업무관리'],
      ['기안'],
      ['공용서식', '공용 서식', '공통서식', '공통 서식'],
      [
        '표준서식(결재4인,협조4인)',
        '표준서식(결재 4인, 협조 4인)',
        '표준서식(결재4인, 협조4인)',
        '표준서식(결재 4인,협조 4인)',
      ],
    ]);
    expect(definitions['edufine-draft'].steps.map(
      ({ interaction }) => interaction,
    )).toEqual([
      'edufine-job',
      'edufine-left-menu',
      'edufine-submenu',
      'frame-exact-text',
    ]);
    expect(definitions['edufine-draft'].steps[0].postcondition).toEqual({
      kind: 'visible-any',
      labels: ['기안'],
    });
    expect(definitions['edufine-draft'].steps.at(-1)?.postcondition).toEqual({
      kind: 'new-window',
      processName: 'WXSClient',
      titleIncludes: '표준서식',
    });
    expect(definitions['edufine-purchase'].steps.map(({ candidateLabels }) => candidateLabels)).toEqual([
      ['학교회계'],
      ['사업관리', '사업 관리', '사업담당', '사업 담당'],
      ['품의/정산', '품의 / 정산'],
      ['품의등록', '품의 등록'],
    ]);
    expect(definitions['edufine-purchase'].steps.map(({ interaction }) => interaction)).toEqual([
      'edufine-job',
      'edufine-top-menu',
      'edufine-mega-menu',
      'edufine-mega-menu',
    ]);
    expect(definitions['edufine-purchase'].steps.at(-1)?.postcondition).toEqual({
      kind: 'visible-groups',
      groups: [
        ['품의등록', '품의 등록'],
        ['기본정보', '제목', '개요', '예산내역', '품목내역'],
      ],
    });
    expect(definitions['edufine-purchase'].steps.at(-1)).toEqual(expect.objectContaining({
      allowActionText: true,
      skipWhenSatisfied: false,
    }));
    expect(definitions['neis-leave'].steps.at(-1)?.postcondition).toEqual({
      kind: 'new-page-any',
      labels: ['근무상황신청', '개인근무상황신청'],
    });
    expect(definitions['neis-trip'].steps.at(-1)?.postcondition).toEqual({
      kind: 'new-page-any',
      labels: ['출장신청'],
    });
    expect(definitions['neis-leave'].steps[2].postcondition).toEqual({
      kind: 'active-view-any',
      labels: ['개인근무상황관리', '개인근무상황'],
    });
    expect(definitions['neis-trip'].steps[2].postcondition).toEqual({
      kind: 'active-view-any',
      labels: ['개인출장관리', '출장관리'],
    });
    expect(definitions['neis-leave'].steps[0]).toEqual(expect.objectContaining({
      interaction: 'neis-home',
      skipWhenSatisfied: false,
      postcondition: { kind: 'visible-any', labels: ['복무'] },
    }));
    expect(definitions['neis-trip'].steps[0]).toEqual(expect.objectContaining({
      interaction: 'neis-home',
      skipWhenSatisfied: false,
      postcondition: { kind: 'visible-any', labels: ['복무'] },
    }));
    expect(definitions['neis-leave'].steps[2].interaction).toBe('neis-management-tab');
    expect(definitions['neis-trip'].steps[2].interaction).toBe('neis-management-tab');
    expect(definitions['neis-leave'].steps.at(-1)?.skipWhenSatisfied).toBe(false);
    expect(definitions['neis-trip'].steps.at(-1)?.skipWhenSatisfied).toBe(false);
    expect(definitions['neis-leave'].steps[2].skipWhenSatisfied).toBe(false);
    expect(definitions['neis-trip'].steps[2].skipWhenSatisfied).toBe(false);
    expect(definitions['edufine-draft'].steps.slice(1).map(
      ({ skipWhenSatisfied }) => skipWhenSatisfied,
    )).toEqual([false, false, false]);
    expect(EDUFINE_DRAFT_WORKFLOW_ROUTES).toHaveLength(2);
    expect(EDUFINE_DRAFT_WORKFLOW_ROUTES[1].steps.map(
      ({ interaction }) => interaction,
    )).toEqual(['edufine-job', 'edufine-document-menu', 'frame-exact-text']);
    expect(Object.values(definitions).flatMap(({ steps }) => steps).filter(
      ({ id }) => ![
        'open-neis-home',
        'open-leave-management',
        'open-trip-management',
        'open-leave-form',
        'open-trip-form',
        'open-purchase-registration',
        'select-school-accounting-job',
        'select-business-management-job',
        'open-left-draft-menu',
        'open-public-forms-from-draft',
        'open-public-forms',
        'open-standard-form',
        'open-business-menu',
      ].includes(id),
    ).every(({ skipWhenSatisfied }) => skipWhenSatisfied === true)).toBe(true);
  });

  it('never places forbidden action text in a clickable candidate label', () => {
    for (const definition of Object.values(allDefinitions)) {
      for (const step of definition.steps) {
        expect(step.candidateLabels.length).toBeGreaterThan(0);
        const isNeisNavigation = definition.id === 'neis-leave' || definition.id === 'neis-trip';
        const isFastEdufineApprovalMenu = definition.id === 'edufine-approval-inbox' &&
          (step.id === 'open-left-approval-menu' || step.id === 'open-top-approval-menu');
        expect(step.maxChecks).toBe(isNeisNavigation ? 40 : isFastEdufineApprovalMenu ? 50 : 134);
        expect(step.checkDelayMs).toBe(isNeisNavigation ? 250 : isFastEdufineApprovalMenu ? 100 : 150);
        for (const label of step.candidateLabels) {
          expect(
            isForbiddenActionText(label) && !(
              'allowActionText' in step && step.allowActionText
            ),
            `${definition.id}:${step.id}:${label}`,
          ).toBe(false);
        }
      }
    }
  });

  it('never accepts the clicked approval menu itself as proof that navigation succeeded', () => {
    for (const definition of Object.values(APPROVAL_INBOX_WORKFLOWS)) {
      for (const step of definition.steps) {
        if (!('labels' in step.postcondition)) continue;
        if (step.postcondition.kind === 'tab-selected-any') continue;
        const clickedLabels = new Set(step.candidateLabels);
        expect(
          step.postcondition.labels.some((label) => clickedLabels.has(label)),
          `${definition.id}:${step.id}`,
        ).toBe(false);
      }
    }
  });

  it('treats NEIS approval and Edufine document management as section labels, not buttons', () => {
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.neis[0].steps.map((step) => (
      step.candidateLabels
    ))).toEqual([
      NEIS_OFFICE_HOME_LABELS,
      ['미결/협조함', '미결 / 협조함'],
    ]);
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.neis[0].steps[0]).toEqual(expect.objectContaining({
      interaction: 'neis-home',
      skipWhenSatisfied: false,
      postcondition: {
        kind: 'visible-any',
        labels: ['미결/협조함', '미결 / 협조함'],
      },
    }));
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.neis[0].steps[1]).toEqual(expect.objectContaining({
      interaction: 'frame-exact-text',
      postcondition: { kind: 'visible-any', labels: [
        'Total',
        'TOTAL',
        'total',
        '문서번호',
        '기안일자',
        '기안자',
        '조회 결과가 없습니다',
        '조회된 자료가 없습니다',
        '조회된 내역이 없습니다',
      ] },
      skipWhenSatisfied: false,
    }));

    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.edufine).toHaveLength(3);
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.edufine[0].steps.map((step) => (
      step.candidateLabels
    ))).toEqual([
      ['업무관리'],
      ['결재'],
      ['결재대기', '결재 대기', '결재대기함', '결재 대기함'],
    ]);
    const clickedLabels = APPROVAL_INBOX_WORKFLOW_ROUTES.edufine.flatMap((route) => (
      route.steps.flatMap((step) => step.candidateLabels)
    ));
    expect(clickedLabels).not.toContain('문서관리');
    expect(clickedLabels).not.toContain('결재(긴급)');
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.edufine[0].steps.map(
      ({ interaction }) => interaction,
    )).toEqual(['edufine-job', 'edufine-left-menu', 'edufine-submenu']);
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.edufine[1].steps.map(
      ({ interaction }) => interaction,
    )).toEqual(['edufine-job', 'edufine-top-menu', 'edufine-submenu']);
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.edufine[2].steps.map(
      ({ interaction }) => interaction,
    )).toEqual(['edufine-job', 'edufine-document-menu', 'edufine-submenu']);
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.edufine[0].steps[0].postcondition).toEqual({
      kind: 'visible-any',
      labels: ['문서관리', '문서 관리'],
    });
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.edufine[0].steps.map(
      ({ skipWhenSatisfied }) => skipWhenSatisfied,
    )).toEqual([false, false, false]);
    expect(APPROVAL_INBOX_WORKFLOW_ROUTES.neis.flatMap((route) => (
      route.steps.flatMap((step) => step.candidateLabels)
    ))).not.toContain('승인사항');
  });

  it('does not expose a definition for an arbitrary workflow identifier', () => {
    expect((definitions as Partial<Record<BuiltInWebWorkflowId, unknown>>)[
      'run-script' as BuiltInWebWorkflowId
    ]).toBeUndefined();
  });
});
