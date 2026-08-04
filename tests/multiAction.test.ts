import { describe, expect, it, vi } from 'vitest';
import type { ActionItem, MultiActionStep } from '../src/shared/types';

const multiActionModule = await import('../src/main/services/multiAction/core').catch(() => null);

function action(id: string, label = id): ActionItem {
  return {
    id,
    kind: 'action' as const,
    type: 'url' as const,
    target: `https://example.com/${id}`,
    args: [],
    label,
    icon: { kind: 'auto' as const },
    color: '#5B8CFF',
    position: 0,
  };
}

function multi(steps: MultiActionStep[]): ActionItem {
  return {
    id: 'multi',
    kind: 'action' as const,
    type: 'multi' as const,
    target: '',
    args: [],
    label: '아침 준비',
    icon: { kind: 'emoji' as const, value: '⏩' },
    color: '#5B8CFF',
    position: 2,
    multiAction: { steps },
  };
}

describe('multi action runner', () => {
  it('runs referenced actions and delays in their saved order', async () => {
    expect(multiActionModule?.MultiActionRunner).toBeTypeOf('function');
    const events: string[] = [];
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const runner = new multiActionModule!.MultiActionRunner({
      createRunId: () => 'run-1',
      wait: async (milliseconds: number) => { events.push(`wait:${milliseconds}`); },
      onProgress: (progress: { state: string }) => {
        if (progress.state === 'completed') finish();
      },
    });
    const first = action('first');
    const second = action('second');
    const item = multi([
      { id: 'step-1', kind: 'action', actionId: 'first' },
      { id: 'step-2', kind: 'delay', delayMs: 500 },
      { id: 'step-3', kind: 'action', actionId: 'second' },
    ]);

    expect(runner.start(item, [first, second, item], async (target: { id: string }) => {
      events.push(`launch:${target.id}`);
      return { ok: true };
    })).toEqual({ ok: true });
    await finished;

    expect(events).toEqual(['launch:first', 'wait:500', 'launch:second']);
  });

  it('stops immediately when a referenced action fails', async () => {
    expect(multiActionModule?.MultiActionRunner).toBeTypeOf('function');
    const launched: string[] = [];
    let finalProgress: { state: string; currentStep: number; message?: string } | undefined;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const runner = new multiActionModule!.MultiActionRunner({
      onProgress: (progress: typeof finalProgress) => {
        if (progress?.state === 'failed') {
          finalProgress = progress;
          finish();
        }
      },
    });
    const first = action('first', '첫 작업');
    const second = action('second', '둘째 작업');
    const item = multi([
      { id: 'step-1', kind: 'action', actionId: 'first' },
      { id: 'step-2', kind: 'action', actionId: 'second' },
    ]);

    runner.start(item, [first, second, item], async (target: { id: string }) => {
      launched.push(target.id);
      return { ok: false, code: 'FAILED', message: '대상을 찾지 못했습니다.' };
    });
    await finished;

    expect(launched).toEqual(['first']);
    expect(finalProgress).toMatchObject({ state: 'failed', currentStep: 1 });
    expect(finalProgress?.message).toMatch(/첫 작업.*대상을 찾지 못했습니다/);
  });

  it('rejects a duplicate run and cancellation makes the runner reusable', async () => {
    expect(multiActionModule?.MultiActionRunner).toBeTypeOf('function');
    let finish!: () => void;
    const cancelled = new Promise<void>((resolve) => { finish = resolve; });
    const wait = vi.fn((_milliseconds: number, signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), {
          once: true,
        });
      }),
    );
    const runner = new multiActionModule!.MultiActionRunner({
      wait,
      onProgress: (progress: { state: string }) => {
        if (progress.state === 'cancelled') finish();
      },
    });
    const item = multi([{ id: 'step-1', kind: 'delay', delayMs: 1_000 }]);

    expect(runner.start(item, [item], async () => ({ ok: true }))).toEqual({ ok: true });
    expect(runner.start(item, [item], async () => ({ ok: true }))).toMatchObject({
      ok: false,
      code: 'FAILED',
    });
    expect(runner.cancel('multi')).toEqual({ ok: true });
    await cancelled;
    expect(runner.start(item, [item], async () => ({ ok: true }))).toEqual({ ok: true });
    expect(runner.cancel('multi')).toEqual({ ok: true });
  });

  it('rejects missing and nested action references before starting', () => {
    expect(multiActionModule?.MultiActionRunner).toBeTypeOf('function');
    const runner = new multiActionModule!.MultiActionRunner();
    const nested = multi([{ id: 'step-1', kind: 'action', actionId: 'other-multi' }]);
    const otherMulti = { ...multi([]), id: 'other-multi' };

    expect(runner.start(nested, [nested, otherMulti], async () => ({ ok: true }))).toMatchObject({
      ok: false,
      code: 'BLOCKED',
    });
    const missing = multi([{ id: 'step-1', kind: 'action', actionId: 'missing' }]);
    expect(runner.start(missing, [missing], async () => ({ ok: true }))).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});
