import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import type { ActionItem } from '../src/shared/types';
import {
  createWebConnectorService,
  type WebConnectorSessionController,
} from '../src/main/services/webConnector';
import type { ManagedBrowserSession } from '../src/main/services/webConnector/sessionManager';
import { createApprovalCheckCancelledError } from '../src/main/services/approvalMonitor/cancellation';

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
  it('cancels a background approval scan and keeps later scans out until the key finishes', async () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const controller = createController();
    let rejectApproval: ((error: Error) => void) | undefined;
    let interactive = 0;
    const events: string[] = [];
    controller.checkApproval = async () => new Promise<number>((_resolve, reject) => {
      rejectApproval = reject;
      events.push('approval-started');
    });
    controller.cancelApprovalChecks = () => {
      events.push('approval-cancelled');
      rejectApproval?.(createApprovalCheckCancelledError());
    };
    controller.beginInteractiveWork = () => { interactive += 1; events.push('interactive-begin'); };
    controller.endInteractiveWork = () => { interactive -= 1; events.push('interactive-end'); };
    controller.run = async () => {
      events.push(`workflow-run:${interactive}`);
      return { workflowId: 'neis-leave', finalState: 'leave-request-form' };
    };
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: controller,
      stateIo: { read: async () => undefined, write: async () => undefined },
      diagnostics: {
        directory: 'C:\\StreamPanel\\web-connector\\diagnostics',
        record: async () => undefined,
      },
    });
    await service.start();
    const scan = service.scanApproval({
      system: 'neis',
      officeCode: 'goe',
      browserId: 'edge',
    });
    const rejectedScan = expect(scan).rejects.toThrow(/배경 업무 알림/);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(service.queue(workflowAction())).toEqual({ queued: true });
    await rejectedScan;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual([
      'approval-started',
      'approval-cancelled',
      'interactive-begin',
      'workflow-run:1',
      'interactive-end',
    ]);
    expect(service.getStatuses()[0].systems).toContainEqual({
      system: 'neis',
      state: 'connected',
      checkedAt: expect.any(Number),
    });
  });

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

  it('marks the current office browser paired without opening the portal', async () => {
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

    expect(opened).toEqual([]);
    expect(service.getStatuses()).toEqual([
      {
        browserId: 'edge',
        paired: true,
        connected: true,
        lastSeenAt: 1_800_000_000_000,
        systems: [
          { system: 'neis', state: 'idle' },
          { system: 'edufine', state: 'idle' },
        ],
      },
      {
        browserId: 'chrome',
        paired: false,
        connected: false,
        systems: [
          { system: 'neis', state: 'idle' },
          { system: 'edufine', state: 'idle' },
        ],
      },
    ]);
    expect(JSON.parse(writes.at(-1)!)).toEqual({
      version: 1,
      offices: { goe: { edge: { lastSeenAt: 1_800_000_000_000 } } },
      legacyExtensionNoticeShown: false,
    });
  });

  it('opens both direct system tabs when the managed browser is opened', async () => {
    const inputs: unknown[] = [];
    const broadcasts: unknown[] = [];
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const controller = createController();
    controller.connectSystems = async (input, report) => {
      inputs.push(input);
      for (const system of input.systems) {
        report?.({ system, state: 'connecting' });
        report?.({ system, state: 'connected', checkedAt: 1_800_000_000_001 });
      }
    };
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: controller,
      stateIo: { read: async () => undefined, write: async () => undefined },
      openPortal: async () => undefined,
      broadcast: (statuses) => broadcasts.push(statuses),
    });
    await service.start();

    await expect(service.openSetup('edge', 'pair')).resolves.toEqual({ ok: true });

    expect(inputs).toEqual([expect.objectContaining({
      officeCode: 'goe',
      browserId: 'edge',
      systems: ['neis', 'edufine'],
      foreground: true,
    })]);
    expect(service.getStatuses()[0].systems).toEqual([
      { system: 'neis', state: 'connected', checkedAt: 1_800_000_000_001 },
      { system: 'edufine', state: 'connected', checkedAt: 1_800_000_000_001 },
    ]);
    expect(broadcasts.length).toBeGreaterThan(0);
  });

  it('clears stale system failures after the managed browser is opened successfully', async () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const controller = createController() as WebConnectorSessionController & {
      checkApproval(input: unknown): Promise<number>;
    };
    controller.checkApproval = async () => {
      throw new Error("'결재대기' 메뉴를 찾지 못했습니다.");
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
      system: 'edufine',
      officeCode: 'goe',
      browserId: 'edge',
    })).rejects.toThrow(/결재대기/);
    expect(service.getStatuses()[0].systems).toContainEqual(expect.objectContaining({
      system: 'edufine',
      state: 'error',
    }));

    await expect(service.test('edge')).resolves.toEqual({ ok: true });
    expect(service.getStatuses()[0].systems).toEqual([
      { system: 'neis', state: 'idle' },
      { system: 'edufine', state: 'idle' },
    ]);
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
    let runCount = 0;
    let focusCount = 0;
    controller.run = async () => {
      runCount += 1;
      await gate;
      return { workflowId: 'neis-leave', finalState: 'leave-request-form' };
    };
    controller.focus = async () => { focusCount += 1; };
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
    expect(service.queue(workflowAction())).toEqual({ queued: true });
    expect(notifications).toEqual([
      {
        message: '나이스 복무 화면을 여는 중입니다. 로그인이 필요하면 표시된 업무용 브라우저에서 진행해 주세요.',
        level: 'info',
      },
      {
        message: '나이스 복무 화면을 여는 중입니다. 로그인이 필요하면 표시된 업무용 브라우저에서 진행해 주세요.',
        level: 'info',
      },
    ]);
    finish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(runCount).toBe(1);
    expect(focusCount).toBe(1);
    expect(notifications.at(-1)).toEqual({
      message: '나이스 복무 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 제출해 주세요.',
      level: 'info',
    });
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
    expect(notifications).toEqual([
      {
        message: '에듀파인 문서함 화면을 여는 중입니다. 로그인이 필요하면 표시된 업무용 브라우저에서 진행해 주세요.',
        level: 'info',
      },
      {
        message: '에듀파인 문서함 이동을 완료했습니다. 확인이 필요한 중요 단계는 승인한 항목만 한 번 실행했습니다.',
        level: 'info',
      },
    ]);
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

  it('runs a key with the office saved on that key instead of the global office', async () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const requests: Array<{ officeCode: string }> = [];
    const controller = createController();
    controller.run = async (request) => {
      requests.push(request);
      return { workflowId: 'neis-leave', finalState: 'leave-request-form' };
    };
    const service = createWebConnectorService({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      getConfig: () => config,
      sessionController: controller,
      stateIo: { read: async () => undefined, write: async () => undefined },
      diagnostics: {
        directory: 'C:\\StreamPanel\\web-connector\\diagnostics',
        record: async () => undefined,
      },
    });
    await service.start();

    expect(service.queue(workflowAction({
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'sen' },
    }))).toEqual({ queued: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(requests).toEqual([expect.objectContaining({ officeCode: 'sen' })]);
  });
});
