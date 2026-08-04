import { randomUUID } from 'node:crypto';
import type {
  ActionItem,
  DeckItem,
  LaunchResult,
  MultiActionProgress,
  MultiActionStep,
} from '../../../shared/types';

export interface MultiActionRunnerOptions {
  createRunId?: () => string;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onProgress?: (progress: MultiActionProgress) => void;
}

type LaunchAction = (item: ActionItem) => Promise<LaunchResult>;

interface ActiveRun {
  itemId: string;
  controller: AbortController;
}

function findAction(items: readonly DeckItem[], id: string): ActionItem | null {
  for (const item of items) {
    if (item.id === id) return item.kind === 'action' ? item : null;
    if (item.kind === 'folder') {
      const found = findAction(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('cancelled', 'AbortError'));
    }, { once: true });
  });
}

function failure(code: 'NOT_FOUND' | 'BLOCKED' | 'FAILED', message: string): LaunchResult {
  return { ok: false, code, message };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export class MultiActionRunner {
  private readonly createRunId: () => string;
  private readonly wait: NonNullable<MultiActionRunnerOptions['wait']>;
  private readonly onProgress: NonNullable<MultiActionRunnerOptions['onProgress']>;
  private active: ActiveRun | null = null;

  constructor({
    createRunId = randomUUID,
    wait = defaultWait,
    onProgress = () => undefined,
  }: MultiActionRunnerOptions = {}) {
    this.createRunId = createRunId;
    this.wait = wait;
    this.onProgress = onProgress;
  }

  start(
    item: ActionItem,
    root: readonly DeckItem[],
    launch: LaunchAction,
  ): LaunchResult {
    if (this.active) {
      return failure(
        'FAILED',
        `이미 '${this.active.itemId === item.id ? item.label : '다른 멀티 액션'}'을 실행하고 있습니다. 진행 중인 작업을 취소한 뒤 다시 시도해 주세요.`,
      );
    }
    if (item.type !== 'multi' || !item.multiAction || item.multiAction.steps.length === 0) {
      return failure('BLOCKED', '멀티 액션 단계가 없습니다. 편집기에서 실행 단계를 추가해 주세요.');
    }
    const resolved = new Map<string, ActionItem>();
    for (const step of item.multiAction.steps) {
      if (step.kind !== 'action') continue;
      const target = findAction(root, step.actionId);
      if (!target) {
        return failure('NOT_FOUND', `멀티 액션이 참조하는 키를 찾을 수 없습니다: ${step.actionId}`);
      }
      if (target.type === 'multi') {
        return failure('BLOCKED', '멀티 액션 안에는 다른 멀티 액션을 넣을 수 없습니다.');
      }
      resolved.set(step.id, target);
    }

    const controller = new AbortController();
    this.active = { itemId: item.id, controller };
    const runId = this.createRunId();
    void this.execute(item, item.multiAction.steps, resolved, runId, controller, launch);
    return { ok: true };
  }

  cancel(itemId: string): { ok: true } | { ok: false; message: string } {
    if (!this.active || this.active.itemId !== itemId) {
      return { ok: false, message: '실행 중인 멀티 액션을 찾을 수 없습니다.' };
    }
    this.active.controller.abort();
    return { ok: true };
  }

  private async execute(
    item: ActionItem,
    steps: readonly MultiActionStep[],
    resolved: ReadonlyMap<string, ActionItem>,
    runId: string,
    controller: AbortController,
    launch: LaunchAction,
  ): Promise<void> {
    let currentStep = 0;
    try {
      for (const [index, step] of steps.entries()) {
        if (controller.signal.aborted) throw new DOMException('cancelled', 'AbortError');
        currentStep = index + 1;
        this.onProgress({
          runId,
          itemId: item.id,
          label: item.label,
          currentStep,
          totalSteps: steps.length,
          state: 'running',
        });
        if (step.kind === 'delay') {
          await this.wait(step.delayMs, controller.signal);
          continue;
        }
        const target = resolved.get(step.id)!;
        const result = await launch(target);
        if (!result.ok) {
          this.onProgress({
            runId,
            itemId: item.id,
            label: item.label,
            currentStep,
            totalSteps: steps.length,
            state: 'failed',
            message: `'${target.label}' 단계에서 멈췄습니다. ${result.message}`,
          });
          return;
        }
      }
      this.onProgress({
        runId,
        itemId: item.id,
        label: item.label,
        currentStep: steps.length,
        totalSteps: steps.length,
        state: 'completed',
        message: `'${item.label}' 멀티 액션을 마쳤습니다.`,
      });
    } catch (error) {
      const cancelled = controller.signal.aborted || isAbortError(error);
      this.onProgress({
        runId,
        itemId: item.id,
        label: item.label,
        currentStep,
        totalSteps: steps.length,
        state: cancelled ? 'cancelled' : 'failed',
        message: cancelled
          ? `'${item.label}' 멀티 액션을 취소했습니다.`
          : `'${item.label}' 멀티 액션을 계속할 수 없습니다. 다시 시도해 주세요.`,
      });
    } finally {
      if (this.active?.controller === controller) this.active = null;
    }
  }
}
