import { describe, expect, it } from 'vitest';
import {
  createApprovalMonitorHandlerActions,
} from '../src/main/ipc/approvalMonitorHandlers';
import * as approvalHandlerModule from '../src/main/ipc/approvalMonitorHandlers';
import {
  assertApprovalMonitorCheckInput,
  assertApprovalMonitorStatusInput,
  assertConfigPatch,
} from '../src/main/security/inputValidation';
import { createDefaultConfig } from '../src/shared/defaults';
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
      check: async (input: unknown, options: unknown) => {
        calls.push([input, options]);
        return statuses;
      },
    } as unknown as ApprovalMonitorService;
    const actions = createApprovalMonitorHandlerActions(service);

    expect(actions.status()).toEqual(statuses);
    await expect(actions.check({ system: 'neis' })).resolves.toEqual(statuses);
    await expect(actions.check({})).resolves.toEqual(statuses);
    expect(calls).toEqual([
      [{ system: 'neis' }, { interactive: true }],
      [{}, { interactive: true }],
    ]);
  });

  it('allows checks only from the editor main frame and forwards every manual request', async () => {
    const assertApprovalMonitorCheckSender = (
      approvalHandlerModule as unknown as {
        assertApprovalMonitorCheckSender?: (
          event: { sender: { mainFrame: unknown }; senderFrame: unknown },
          editor: { isDestroyed(): boolean; webContents: unknown } | null,
        ) => void;
      }
    ).assertApprovalMonitorCheckSender;
    expect(assertApprovalMonitorCheckSender).toBeTypeOf('function');
    const mainFrame = {};
    const editorWebContents = { mainFrame };
    const editor = { isDestroyed: () => false, webContents: editorWebContents };
    expect(() => assertApprovalMonitorCheckSender!({
      sender: editorWebContents,
      senderFrame: mainFrame,
    }, editor)).not.toThrow();
    expect(() => assertApprovalMonitorCheckSender!({
      sender: { mainFrame },
      senderFrame: mainFrame,
    }, editor)).toThrow(/설정 창/);
    expect(() => assertApprovalMonitorCheckSender!({
      sender: editorWebContents,
      senderFrame: {},
    }, editor)).toThrow(/최상위/);

    const calls: unknown[] = [];
    const statuses = [{ system: 'neis' as const, state: 'idle' as const }];
    const service = {
      getStatuses: () => statuses,
      check: async (input: unknown, options: unknown) => {
        calls.push([input, options]);
        return statuses;
      },
    } as unknown as ApprovalMonitorService;
    const actions = createApprovalMonitorHandlerActions(service);

    await actions.check({ system: 'neis' });
    await actions.check({ system: 'neis' });

    expect(calls).toEqual([
      [{ system: 'neis' }, { interactive: true }],
      [{ system: 'neis' }, { interactive: true }],
    ]);
  });

  it('rejects extra fields and unknown systems before a handler uses them', () => {
    expect(() => assertApprovalMonitorStatusInput({})).not.toThrow();
    expect(() => assertApprovalMonitorStatusInput({ refresh: true })).toThrow(/상태/);
    expect(() => assertApprovalMonitorCheckInput({})).not.toThrow();
    expect(() => assertApprovalMonitorCheckInput({ system: 'edufine' })).not.toThrow();
    expect(() => assertApprovalMonitorCheckInput({ system: 'other' })).toThrow(/업무 시스템/);
    expect(() => assertApprovalMonitorCheckInput({ system: 'neis', script: 'run()' })).toThrow(/확인 요청/);
  });

  it('allows only the documented nested approval settings in the first config input check', () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      (() => { let id = 0; return () => `id-${id++}`; })(),
      'win32',
    );
    expect(() => assertConfigPatch({
      approvalMonitor: config.approvalMonitor,
    })).not.toThrow();
    expect(() => assertConfigPatch({
      approvalMonitor: {
        ...config.approvalMonitor,
        script: 'run()',
      },
    })).toThrow(/결재 대기 알림/);
    expect(() => assertConfigPatch({
      approvalMonitor: {
        ...config.approvalMonitor,
        sources: {
          ...config.approvalMonitor.sources,
          neis: {
            ...config.approvalMonitor.sources.neis,
            selector: '#approval',
          },
        },
      },
    })).toThrow(/결재 대기 알림/);
  });
});
