import { describe, expect, it } from 'vitest';
import type { BuiltInWebWorkflowId } from '../src/shared/types';
import { EDUFINE_WORKFLOWS } from '../src/main/services/webConnector/workflows/edufine';
import { NEIS_WORKFLOWS } from '../src/main/services/webConnector/workflows/neis';
import { isForbiddenActionText } from '../src/main/services/webConnector/workflows/common';
import * as workflowCommon from '../src/main/services/webConnector/workflows/common';
import type { WebWorkflowSpec } from '../src/shared/types';
import { APPROVAL_INBOX_WORKFLOWS } from '../src/main/services/approvalMonitor/definitions';

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
          interaction: 'mouse',
          navigationOnly: true,
          postcondition: { kind: 'visible-any', labels: ['문서관리'] },
        }),
        expect.objectContaining({
          id: 'step-2',
          candidateLabels: ['문서관리'],
          interaction: 'mouse',
          navigationOnly: true,
          postcondition: { kind: 'visible-any', labels: ['내 문서함'] },
        }),
        expect.objectContaining({
          id: 'step-3',
          candidateLabels: ['내 문서함'],
          interaction: 'mouse',
          navigationOnly: true,
          postcondition: { kind: 'visible-any', labels: ['내 문서함 목록'] },
        }),
      ],
    });
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
      ['복무'],
      ['개인근무상황관리', '개인근무상황'],
      ['신청'],
    ]);
    expect(definitions['neis-trip'].steps.map(({ candidateLabels }) => candidateLabels)).toEqual([
      ['복무'],
      ['개인출장관리', '출장관리'],
      ['신청'],
    ]);
    expect(definitions['edufine-draft'].steps.map(({ candidateLabels }) => candidateLabels)).toEqual([
      ['업무관리'],
      ['문서관리'],
      ['공용서식'],
      ['표준서식(결재4인,협조4인)'],
    ]);
    expect(definitions['edufine-draft'].steps.at(-1)?.postcondition).toEqual({
      kind: 'new-window',
      processName: 'WXSClient',
      titleIncludes: '표준서식',
    });
    expect(definitions['edufine-purchase'].steps.map(({ candidateLabels }) => candidateLabels)).toEqual([
      ['학교회계'],
      ['사업관리'],
      ['품의등록'],
    ]);
    expect(definitions['edufine-purchase'].steps.at(-1)?.postcondition).toEqual({
      kind: 'visible-all',
      labels: ['품의등록', '예산내역', '품목내역', '결재요청'],
    });
  });

  it('never places forbidden action text in a clickable candidate label', () => {
    for (const definition of Object.values(allDefinitions)) {
      for (const step of definition.steps) {
        expect(step.candidateLabels.length).toBeGreaterThan(0);
        expect(step.maxChecks).toBe(3);
        expect(step.checkDelayMs).toBeGreaterThan(0);
        for (const label of step.candidateLabels) {
          expect(isForbiddenActionText(label), `${definition.id}:${step.id}:${label}`).toBe(false);
        }
      }
    }
  });

  it('does not expose a definition for an arbitrary workflow identifier', () => {
    expect((definitions as Partial<Record<BuiltInWebWorkflowId, unknown>>)[
      'run-script' as BuiltInWebWorkflowId
    ]).toBeUndefined();
  });
});
