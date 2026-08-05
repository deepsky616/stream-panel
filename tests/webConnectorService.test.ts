import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import type { ActionItem } from '../src/shared/types';
import {
  createWebConnectorService,
  type WebConnectorSessionController,
} from '../src/main/services/webConnector';
import type { ManagedBrowserSession } from '../src/main/services/webConnector/sessionManager';

function workflowAction(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'leave',
    kind: 'action',
    type: 'url',
    label: '나이스 복무',
    target: 'https://goe.neis.go.kr/',
    args: [],
    icon: { kind: 'auto' },
    color: '#5B8CFF',
    position: 0,
    webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    ...overrides,
  };
}

function createController(): WebConnectorSessionController {
  const sessions = new Map<string, ManagedBrowserSession>();
  return {
    async prepare(officeCode, browserId) {
      const session: ManagedBrowserSession = {
        officeCode,
        browserId,
        isAlive: () => true,
        close: async () => undefined,
      };
      sessions.set(`${officeCode}:${browserId}`, session);
      return session;
    },
    async run() {
      return { workflowId: 'neis-leave', finalState: 'leave-request-form' };
    },
    getSession: (officeCode, browserId) => sessions.get(`${officeCode}:${browserId}`),
    closeOtherOffices: async (officeCode) => {
      for (const [key, session] of sessions) {
        if (session.officeCode !== officeCode) sessions.delete(key);
      }
    },
    closeAll: async () => { sessions.clear(); },
  };
}

describe('managed web connector service', () => {
  it('serializes an approval count read through the current managed office session', async () => {
    const inputs: unknown[] = [];
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      (() => { let id = 0; return () => `id-${id++}`; })(),
      'win32',
    );
    const controller = createController() as WebConnectorSessionController & {
      checkApproval(input: unknown): Promise<number>;
    };
    controller.checkApproval = async (input) => {
      inputs.push(input);
      return 6;
    };
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: controller,
      stateIo: { read: async () => undefined, write: async () => undefined },
      openPortal: async () => undefined,
    });
    await service.start();

    await expect(service.scanApproval({
      system: 'neis',
      officeCode: 'goe',
      browserId: 'edge',
    })).resolves.toBe(6);
    expect(inputs).toEqual([{
      system: 'neis',
      officeCode: 'goe',
      browserId: 'edge',
    }]);
    await expect(service.scanApproval({
      system: 'neis',
      officeCode: 'sen',
      browserId: 'edge',
    })).rejects.toThrow(/교육청/);
  });

  it('loads non-sensitive state without starting a loopback extension server', async () => {
    const writes: string[] = [];
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: createController(),
      stateIo: {
        read: async () => undefined,
        write: async (text) => { writes.push(text); },
      },
      openPortal: async () => undefined,
    });

    await expect(service.start()).resolves.toEqual({ ok: true });
    expect(JSON.parse(writes[0])).toEqual({
      version: 1,
      offices: {},
      legacyExtensionNoticeShown: false,
    });
    expect(writes[0]).not.toMatch(/token|port|websocket|pairings/i);
    await service.stop();
  });

  it('marks the current office browser paired after a handshake and portal check', async () => {
    const writes: string[] = [];
    const opened: string[] = [];
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: createController(),
      stateIo: {
        read: async () => undefined,
        write: async (text) => { writes.push(text); },
      },
      openPortal: async (session) => { opened.push(`${session.officeCode}:${session.browserId}`); },
      now: () => 1_800_000_000_000,
    });
    await service.start();

    await expect(service.test('edge')).resolves.toEqual({ ok: true });

    expect(opened).toEqual(['goe:edge']);
    expect(service.getStatuses()).toEqual([
      {
        browserId: 'edge',
        paired: true,
        connected: true,
        lastSeenAt: 1_800_000_000_000,
      },
      { browserId: 'chrome', paired: false, connected: false },
    ]);
    expect(JSON.parse(writes.at(-1)!)).toEqual({
      version: 1,
      offices: { goe: { edge: { lastSeenAt: 1_800_000_000_000 } } },
      legacyExtensionNoticeShown: false,
    });
  });

  it('accepts a validated workflow immediately and reports its later result through notifications', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const notifications: Array<{ message: string; level: string }> = [];
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const controller = createController();
    controller.run = async () => {
      await gate;
      return { workflowId: 'neis-leave', finalState: 'leave-request-form' };
    };
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: controller,
      stateIo: { read: async () => undefined, write: async () => undefined },
      openPortal: async () => undefined,
      diagnostics: {
        directory: 'C:\\StreamPanel\\web-connector\\diagnostics',
        record: async () => undefined,
      },
      notify: (message, level) => { notifications.push({ message, level }); },
      now: () => 1_800_000_000_000,
    });
    await service.start();

    expect(service.queue(workflowAction())).toEqual({ queued: true });
    expect(notifications).toEqual([]);
    finish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(notifications).toEqual([{
      message: '나이스 복무 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 제출해 주세요.',
      level: 'info',
    }]);
  });

  it('queues a custom Edufine workflow with its validated definition and reports its own name', async () => {
    const requests: unknown[] = [];
    const notifications: Array<{ message: string; level: string }> = [];
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const controller = createController();
    controller.run = async (request) => {
      requests.push(request);
      return { workflowId: 'custom', finalState: 'custom-target-ready' };
    };
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: controller,
      stateIo: { read: async () => undefined, write: async () => undefined },
      openPortal: async () => undefined,
      diagnostics: {
        directory: 'C:\\StreamPanel\\web-connector\\diagnostics',
        record: async () => undefined,
      },
      notify: (message, level) => { notifications.push({ message, level }); },
    });
    await service.start();

    expect(service.queue(workflowAction({
      id: 'custom-documents',
      label: '에듀파인 문서함',
      target: 'https://klef.goe.go.kr/',
      webWorkflow: {
        id: 'custom',
        browserId: 'edge',
        custom: {
          name: '에듀파인 문서함',
          system: 'edufine',
          steps: [{ id: 'step-1', label: '내 문서함' }],
          finalText: '내 문서함 목록',
        },
      },
    }))).toEqual({ queued: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(requests).toEqual([expect.objectContaining({
      officeCode: 'goe',
      browserId: 'edge',
      workflowId: 'custom',
      workflowSpec: expect.objectContaining({
        id: 'custom',
        custom: expect.objectContaining({ name: '에듀파인 문서함', system: 'edufine' }),
      }),
    })]);
    expect(notifications).toEqual([{
      message: '에듀파인 문서함 화면을 열었습니다. 내용을 확인한 뒤 필요한 최종 동작은 직접 진행해 주세요.',
      level: 'info',
    }]);
  });

  it('rejects another office target and never falls back to a personal browser', async () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: createController(),
      stateIo: { read: async () => undefined, write: async () => undefined },
      openPortal: async () => undefined,
    });
    await service.start();

    expect(service.queue(workflowAction({ target: 'https://sen.neis.go.kr/' }))).toMatchObject({
      queued: false,
      message: expect.stringMatching(/교육청/),
    });
  });
});
