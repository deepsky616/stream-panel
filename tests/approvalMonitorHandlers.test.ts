import { describe, expect, it } from 'vitest';
import { createApprovalMonitorHandlerActions } from '../src/main/ipc/approvalMonitorHandlers';
import {
  assertApprovalMonitorCheckInput,
  assertApprovalMonitorStatusInput,
} from '../src/main/security/inputValidation';
import type { ApprovalMonitorService } from '../src/main/services/approvalMonitor';
import { IPC_CHANNELS, RENDERER_EVENTS } from '../src/shared/ipcChannels';

describe('approval monitor IPC actions', () => {
  it('uses fixed request channels and an allowed renderer event', () => {
    expect(IPC_CHANNELS.WEB_APPROVAL_STATUS).toBe('web-approval:status');
    expect(IPC_CHANNELS.WEB_APPROVAL_CHECK).toBe('web-approval:check');
    expect(IPC_CHANNELS.WEB_APPROVAL_CHANGED).toBe('web-approval:changed');
    expect(RENDERER_EVENTS.has('web-approval:changed')).toBe(true);
  });

  it('returns status and checks only an optional known system', async () => {
    const calls: unknown[] = [];
    const statuses = [
      { system: 'neis' as const, state: 'ready' as const, pendingCount: 3 },
      { system: 'edufine' as const, state: 'disabled' as const },
    ];
    const service = {
      getStatuses: () => statuses,
      check: async (input: unknown) => { calls.push(input); return statuses; },
    } as unknown as ApprovalMonitorService;
    const actions = createApprovalMonitorHandlerActions(service);

    expect(actions.status()).toEqual(statuses);
    await expect(actions.check({ system: 'neis' })).resolves.toEqual(statuses);
    await expect(actions.check({})).resolves.toEqual(statuses);
    expect(calls).toEqual([{ system: 'neis' }, {}]);
  });

  it('rejects extra fields and unknown systems before a handler uses them', () => {
    expect(() => assertApprovalMonitorStatusInput({})).not.toThrow();
    expect(() => assertApprovalMonitorStatusInput({ refresh: true })).toThrow(/상태/);
    expect(() => assertApprovalMonitorCheckInput({})).not.toThrow();
    expect(() => assertApprovalMonitorCheckInput({ system: 'edufine' })).not.toThrow();
    expect(() => assertApprovalMonitorCheckInput({ system: 'other' })).toThrow(/업무 시스템/);
    expect(() => assertApprovalMonitorCheckInput({ system: 'neis', script: 'run()' })).toThrow(/확인 요청/);
  });
});
