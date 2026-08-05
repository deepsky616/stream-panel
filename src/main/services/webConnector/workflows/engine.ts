import type {
  CandidateSummary,
  ManagedWorkflowDefinition,
  WorkflowStep,
} from './common';
import { selectSafeCandidate } from './common';

export interface WorkflowPageAdapter {
  inspectCandidates(step: WorkflowStep): Promise<readonly CandidateSummary[]>;
  pressCandidate(candidate: CandidateSummary, step: WorkflowStep): Promise<void>;
  checkPostcondition(step: WorkflowStep): Promise<boolean>;
  wait(delayMs: number): Promise<void>;
}

export interface WorkflowRunOptions {
  signal?: AbortSignal;
}

export interface WorkflowRunResult {
  workflowId: ManagedWorkflowDefinition['id'];
  finalState: string;
}

function ensureActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('웹 업무 이동이 취소되었습니다. 필요하면 키를 다시 눌러 주세요.');
  }
}

async function findCandidate(
  step: WorkflowStep,
  adapter: WorkflowPageAdapter,
  signal: AbortSignal | undefined,
): Promise<CandidateSummary> {
  let stableCandidateKey = '';
  for (let check = 1; check <= step.maxChecks; check += 1) {
    ensureActive(signal);
    const selected = selectSafeCandidate(
      await adapter.inspectCandidates(step),
      step.candidateLabels,
      step.navigationOnly,
    );
    if (selected) {
      const candidateKey = `${selected.index}:${selected.text}`;
      if (step.maxChecks === 1 || candidateKey === stableCandidateKey) return selected;
      stableCandidateKey = candidateKey;
    } else {
      stableCandidateKey = '';
    }
    if (check < step.maxChecks) await adapter.wait(step.checkDelayMs);
  }
  throw new Error(
    `'${step.candidateLabels.join(' 또는 ')}' 메뉴를 찾지 못했습니다. 화면 구성이 바뀌었거나 업무 권한이 없을 수 있으니 업무용 브라우저에서 직접 확인해 주세요.`,
  );
}

async function waitForPostcondition(
  step: WorkflowStep,
  adapter: WorkflowPageAdapter,
  signal: AbortSignal | undefined,
): Promise<void> {
  for (let check = 1; check <= step.maxChecks; check += 1) {
    ensureActive(signal);
    if (await adapter.checkPostcondition(step)) return;
    if (check < step.maxChecks) await adapter.wait(step.checkDelayMs);
  }
  throw new Error(
    `'${step.id}' 단계 뒤 기대한 화면을 확인하지 못했습니다. 화면 구성이 바뀌었을 수 있으니 업무용 브라우저에서 직접 계속해 주세요.`,
  );
}

export async function runWorkflow(
  definition: ManagedWorkflowDefinition,
  adapter: WorkflowPageAdapter,
  { signal }: WorkflowRunOptions = {},
): Promise<WorkflowRunResult> {
  for (const step of definition.steps) {
    const selected = await findCandidate(step, adapter, signal);
    ensureActive(signal);
    await adapter.pressCandidate(selected, step);
    await waitForPostcondition(step, adapter, signal);
  }
  return { workflowId: definition.id, finalState: definition.finalState };
}
