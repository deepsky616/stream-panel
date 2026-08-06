import { describe, expect, it } from 'vitest';
import {
  isForbiddenActionText,
  selectSafeCandidate,
  type CandidateSummary,
  type WorkflowStep,
} from '../src/main/services/webConnector/workflows/common';
import { runWorkflow } from '../src/main/services/webConnector/workflows/engine';

function candidate(
  index: number,
  text: string,
  overrides: Partial<CandidateSummary> = {},
): CandidateSummary {
  return {
    index,
    text,
    visible: true,
    enabled: true,
    width: 120,
    height: 32,
    ...overrides,
  };
}

const step: WorkflowStep = {
  id: 'open-duty',
  candidateLabels: ['복무'],
  interaction: 'mouse',
  postcondition: { kind: 'visible-any', labels: ['개인근무상황관리'] },
  maxChecks: 3,
  checkDelayMs: 10,
};

describe('managed web workflow engine', () => {
  it('selects one exact visible enabled candidate and ignores partial or zero-size matches', () => {
    expect(selectSafeCandidate([
      candidate(0, '즐겨찾기 복무'),
      candidate(1, '복무', { visible: false }),
      candidate(2, '복무', { enabled: false }),
      candidate(3, '복무', { width: 0 }),
      candidate(4, '  복무  '),
    ], ['복무'])).toEqual(candidate(4, '  복무  '));
  });

  it('fails closed when more than one safe candidate has the exact approved label', () => {
    expect(() => selectSafeCandidate([
      candidate(0, '복무'),
      candidate(1, ' 복무 '),
    ], ['복무'])).toThrow(/둘 이상/);
  });

  it('never selects save, submit, approval, payment, or confirmation actions', () => {
    for (const text of ['저장', '제출', '결재', '결재 요청', '상신', '승인', '최종 확정']) {
      expect(isForbiddenActionText(text)).toBe(true);
      expect(() => selectSafeCandidate([candidate(0, text)], [text])).toThrow(/중요 동작/);
    }
    expect(isForbiddenActionText('품의등록')).toBe(false);
  });

  it('ignores only an equivalent ancestor that the page reports as covering the same menu item', () => {
    expect(selectSafeCandidate([
      candidate(0, '복무', { shadowedByEquivalentDescendant: true }),
      candidate(1, '복무'),
    ], ['복무'])).toEqual(candidate(1, '복무'));
  });

  it('runs a configured action step only after an explicit per-run confirmation', async () => {
    const confirmedStep: WorkflowStep = {
      ...step,
      id: 'save-custom-form',
      candidateLabels: ['저장'],
      navigationOnly: false,
      requiresConfirmation: true,
      postcondition: { kind: 'visible-any', labels: ['저장 완료'] },
    };
    let presses = 0;
    const adapter = (confirmed: boolean) => ({
      inspectCandidates: async () => [candidate(0, '저장')],
      confirmStep: async () => confirmed,
      pressCandidate: async () => { presses += 1; },
      checkPostcondition: async () => true,
      wait: async () => undefined,
    });

    await expect(runWorkflow(
      { id: 'custom', label: '사용자 지정 업무', finalState: 'ready', steps: [confirmedStep] },
      adapter(false),
    )).rejects.toThrow(/실행을 취소/);
    expect(presses).toBe(0);

    await expect(runWorkflow(
      { id: 'custom', label: '사용자 지정 업무', finalState: 'ready', steps: [confirmedStep] },
      adapter(true),
    )).resolves.toEqual({ workflowId: 'custom', finalState: 'ready' });
    expect(presses).toBe(1);
  });

  it('rejects a safe label when another visible or accessible name reveals an action', () => {
    expect(() => selectSafeCandidate([
      candidate(0, '결재함', {
        navigation: true,
        safeNavigation: true,
        visibleText: '승인',
        accessibleName: '결재함',
        titleText: '',
        valueText: '',
      } as Partial<CandidateSummary>),
    ], ['결재함'], true)).toThrow(/중요 동작/);

    expect(() => selectSafeCandidate([
      candidate(0, '저장', {
        visibleText: '저장',
        accessibleName: '삭제',
      } as Partial<CandidateSummary>),
    ], ['저장'], false, 'unique-any', [], false, true)).toThrow(/중요 동작/);
  });

  it('presses a safe candidate once and advances only after the postcondition succeeds', async () => {
    const events: string[] = [];
    let postconditionChecks = 0;

    const result = await runWorkflow(
      { id: 'neis-leave', label: '나이스 복무', finalState: 'leave-form', steps: [step] },
      {
        inspectCandidates: async () => [candidate(0, '복무')],
        pressCandidate: async (selected) => { events.push(`press:${selected.index}`); },
        checkPostcondition: async () => {
          postconditionChecks += 1;
          events.push(`check:${postconditionChecks}`);
          return postconditionChecks === 2;
        },
        wait: async () => { events.push('wait'); },
      },
    );

    expect(result).toEqual({ workflowId: 'neis-leave', finalState: 'leave-form' });
    expect(events).toEqual(['wait', 'press:0', 'check:1', 'wait', 'check:2']);
  });

  it('resumes from the first already completed step without clicking its parent menu again', async () => {
    const pressed: string[] = [];
    const steps: WorkflowStep[] = [
      { ...step, skipWhenSatisfied: true },
      {
        ...step,
        id: 'open-management',
        candidateLabels: ['개인근무상황관리'],
        postcondition: { kind: 'visible-any', labels: ['신청'] },
      },
    ];
    let currentStep = '';

    await expect(runWorkflow(
      { id: 'neis-leave', label: '나이스 복무', finalState: 'leave-form', steps },
      {
        inspectCandidates: async (current) => {
          currentStep = current.id;
          return [candidate(0, current.candidateLabels[0])];
        },
        pressCandidate: async (_selected, current) => { pressed.push(current.id); },
        checkCurrentState: async (current) => current.id === 'open-duty',
        checkPostcondition: async (current) => pressed.includes(current.id),
        wait: async () => undefined,
      },
    )).resolves.toEqual({ workflowId: 'neis-leave', finalState: 'leave-form' });
    expect(currentStep).toBe('open-management');
    expect(pressed).toEqual(['open-management']);
  });

  it('does not press the next step when the current postcondition never succeeds', async () => {
    const pressed: string[] = [];
    const second: WorkflowStep = {
      ...step,
      id: 'open-management',
      candidateLabels: ['개인근무상황관리'],
    };

    await expect(runWorkflow(
      {
        id: 'neis-leave',
        label: '나이스 복무',
        finalState: 'leave-form',
        steps: [step, second],
      },
      {
        inspectCandidates: async (current) => [candidate(0, current.candidateLabels[0])],
        pressCandidate: async (_selected, current) => { pressed.push(current.id); },
        checkPostcondition: async () => false,
        wait: async () => undefined,
      },
    )).rejects.toThrow(/화면을 확인하지 못했습니다/);
    expect(pressed).toEqual(['open-duty']);
  });

  it('rechecks a missing candidate three times but stops immediately on ambiguity', async () => {
    let inspections = 0;
    await expect(runWorkflow(
      { id: 'neis-trip', label: '나이스 출장', finalState: 'trip-form', steps: [step] },
      {
        inspectCandidates: async () => {
          inspections += 1;
          return [];
        },
        pressCandidate: async () => undefined,
        checkPostcondition: async () => true,
        wait: async () => undefined,
      },
    )).rejects.toThrow(/찾지 못했습니다/);
    expect(inspections).toBe(3);

    inspections = 0;
    await expect(runWorkflow(
      { id: 'neis-trip', label: '나이스 출장', finalState: 'trip-form', steps: [step] },
      {
        inspectCandidates: async () => {
          inspections += 1;
          return [candidate(0, '복무'), candidate(1, '복무')];
        },
        pressCandidate: async () => undefined,
        checkPostcondition: async () => true,
        wait: async () => undefined,
      },
    )).rejects.toThrow(/둘 이상/);
    expect(inspections).toBe(1);
  });

  it('allows custom steps to press verified navigation elements but not action-like navigation candidates', async () => {
    const navigationStep = {
      ...step,
      navigationOnly: true,
    } as WorkflowStep;
    const adapter = (navigation: boolean, safeNavigation = false) => ({
      inspectCandidates: async () => [candidate(0, '복무', {
        navigation,
        safeNavigation,
      } as Partial<CandidateSummary>)],
      pressCandidate: async () => undefined,
      checkPostcondition: async () => true,
      wait: async () => undefined,
    });

    await expect(runWorkflow(
      { id: 'custom', label: '사용자 지정 업무', finalState: 'ready', steps: [navigationStep] },
      adapter(false),
    )).rejects.toThrow(/찾지 못했습니다/);
    await expect(runWorkflow(
      { id: 'custom', label: '사용자 지정 업무', finalState: 'ready', steps: [navigationStep] },
      adapter(true, false),
    )).rejects.toThrow(/찾지 못했습니다/);
    await expect(runWorkflow(
      { id: 'custom', label: '사용자 지정 업무', finalState: 'ready', steps: [navigationStep] },
      adapter(true, true),
    )).resolves.toEqual({ workflowId: 'custom', finalState: 'ready' });
  });
});
