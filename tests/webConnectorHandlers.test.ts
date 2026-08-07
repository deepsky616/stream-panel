import { describe, expect, it } from 'vitest';
import {
  createWebConnectorHandlerActions,
} from '../src/main/ipc/webConnectorHandlers';
import type { WebConnectorService } from '../src/main/services/webConnector';

describe('web connector IPC actions', () => {
  it('keeps the existing inputs while routing setup to managed browser actions', async () => {
    const calls: string[] = [];
    const service = {
      getStatuses: () => [{ browserId: 'edge', paired: false, connected: false }],
      test: async (browserId: string) => { calls.push(`test:${browserId}`); return { ok: true }; },
      openSetup: async (browserId: string, target: string) => {
        calls.push(`setup:${browserId}:${target}`);
        return { ok: true };
      },
      openApprovalInbox: (system: string) => {
        calls.push(`approval:${system}`);
        return { queued: true };
      },
      ensureDiagnosticsDirectory: async () => 'C:\\StreamPanel\\web-connector\\diagnostics',
    } as unknown as WebConnectorService;
    const opened: string[] = [];
    const actions = createWebConnectorHandlerActions(service, {
      openDiagnosticsDirectory: async (path) => { opened.push(path); return ''; },
    });

    expect(actions.status()).toEqual([{ browserId: 'edge', paired: false, connected: false }]);
    await expect(actions.test({ browserId: 'edge' })).resolves.toEqual({ ok: true });
    await expect(actions.openSetup({ browserId: 'edge', target: 'pair' })).resolves.toEqual({ ok: true });
    await expect(actions.openSetup({ browserId: 'chrome', target: 'extensions' })).resolves.toEqual({ ok: true });
    await expect(actions.openSetup({ browserId: 'edge', target: 'folder' })).resolves.toEqual({ ok: true });
    expect(actions.openApprovalInbox({ system: 'neis' })).toEqual({ queued: true });

    expect(calls).toEqual([
      'test:edge',
      'setup:edge:pair',
      'setup:chrome:extensions',
      'approval:neis',
    ]);
    expect(opened).toEqual(['C:\\StreamPanel\\web-connector\\diagnostics']);
  });

  it('returns a cause and solution when the diagnostics folder cannot be opened', async () => {
    const service = {
      ensureDiagnosticsDirectory: async () => 'C:\\StreamPanel\\web-connector\\diagnostics',
    } as unknown as WebConnectorService;
    const actions = createWebConnectorHandlerActions(service, {
      openDiagnosticsDirectory: async () => '접근 권한이 없습니다.',
    });

    await expect(actions.openSetup({ browserId: 'edge', target: 'folder' })).resolves.toEqual({
      ok: false,
      message: '문제 해결 폴더를 열지 못했습니다. 폴더 접근 권한을 확인해 주세요: 접근 권한이 없습니다.',
    });
  });
});
