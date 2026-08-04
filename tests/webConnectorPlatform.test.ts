import { describe, expect, it } from 'vitest';
import type { CandidateSummary } from '../src/main/services/webConnector/workflows/common';
import type { WindowsWorkflowPage } from '../src/main/services/webConnector/windows';
import {
  createWindowsManagedBrowserSession,
  executeWindowsWorkflow,
  openCdpWindowsWorkflowPage,
  selectWindowsWorkflowTarget,
} from '../src/main/services/webConnector/windows';
import { createMacosWebAutomation } from '../src/main/services/webConnector/macos';

function safeCandidate(index: number, text: string): CandidateSummary {
  return { index, text, visible: true, enabled: true, width: 100, height: 30 };
}

function page(origin: string): WindowsWorkflowPage {
  return {
    currentOrigin: async () => origin,
    inspectCandidates: async (step) => [safeCandidate(0, step.candidateLabels[0])],
    pressCandidate: async () => undefined,
    checkPostcondition: async () => true,
    wait: async () => undefined,
    activate: async () => undefined,
  };
}

describe('Windows managed web automation', () => {
  it('selects only the requested office and system page target', () => {
    const targets = [
      { targetId: 'personal', type: 'page', url: 'https://mail.example.com/' },
      { targetId: 'other-office', type: 'page', url: 'https://sen.neis.go.kr/' },
      { targetId: 'wrong-system', type: 'page', url: 'https://klef.goe.go.kr/' },
      { targetId: 'right', type: 'page', url: 'https://goe.neis.go.kr/main?secret=value' },
      { targetId: 'worker', type: 'service_worker', url: 'https://goe.neis.go.kr/sw.js' },
    ];

    expect(selectWindowsWorkflowTarget(targets, 'goe', 'neis-leave')).toEqual(targets[3]);
    expect(selectWindowsWorkflowTarget(targets, 'goe', 'edufine-draft')).toEqual(targets[2]);
    expect(selectWindowsWorkflowTarget(targets, 'jje', 'neis-trip')).toBeNull();
  });

  it('creates a dedicated profile session with the selected known browser', async () => {
    const connected: Array<{ browserId: string; executable: string; profilePath: string }> = [];
    const protocol = {
      isClosed: false,
      send: async () => ({}),
      close() { this.isClosed = true; },
    };
    const session = await createWindowsManagedBrowserSession(
      'sen',
      'edge',
      {
        userDataPath: 'C:\\StreamPanel',
        env: {
          'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        },
        exists: (path) => path.endsWith('Microsoft\\Edge\\Application\\msedge.exe'),
        makeDirectory: async () => undefined,
        connectBrowser: async (options) => {
          connected.push(options);
          return {
            transportKind: 'pipe',
            protocol: protocol as never,
            process: {
              pid: 42,
              exited: false,
              close: async () => undefined,
            } as never,
          };
        },
      },
    );

    expect(connected).toEqual([{
      browserId: 'edge',
      executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      profilePath: 'C:\\StreamPanel\\web-browsers\\sen\\edge',
    }]);
    expect(session.isAlive()).toBe(true);
    await session.close();
    expect(protocol.isClosed).toBe(true);
  });

  it('waits for a newly created target to reach an HTTP origin before returning the page', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    let originChecks = 0;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') return { targetInfos: [] };
        if (method === 'Target.createTarget') return { targetId: 'target-1' };
        if (method === 'Target.attachToTarget') return { sessionId: 'session-1' };
        if (method === 'Runtime.evaluate') {
          originChecks += 1;
          return { result: { value: originChecks === 1 ? 'null' : 'https://sen.neis.go.kr' } };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const managedSession = {
      officeCode: 'sen' as const,
      browserId: 'edge' as const,
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    const workflowPage = await openCdpWindowsWorkflowPage(managedSession as never, 'neis-leave');

    expect(originChecks).toBe(2);
    expect(commands.find(({ method }) => method === 'Target.createTarget')?.params).toEqual({
      url: 'https://sen.neis.go.kr/',
    });
    await expect(workflowPage.currentOrigin()).resolves.toBe('https://sen.neis.go.kr');
  });

  it('stops on a login portal or an unapproved origin before inspecting page content', async () => {
    let inspections = 0;
    const loginPage = page('https://goe.eduptl.kr');
    loginPage.inspectCandidates = async () => { inspections += 1; return []; };
    await expect(executeWindowsWorkflow(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { officeCode: 'goe', browserId: 'edge', workflowId: 'neis-leave' },
      {
        openWorkflowPage: async () => loginPage,
        isWxsClientRegistered: async () => true,
        listWxsClientWindows: async () => [],
        focusWindow: async () => true,
      },
    )).rejects.toThrow(/로그인/);
    expect(inspections).toBe(0);

    await expect(executeWindowsWorkflow(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { officeCode: 'goe', browserId: 'edge', workflowId: 'neis-leave' },
      {
        openWorkflowPage: async () => page('https://evil.example'),
        isWxsClientRegistered: async () => true,
        listWxsClientWindows: async () => [],
        focusWindow: async () => true,
      },
    )).rejects.toThrow(/허용되지 않은/);
  });

  it('checks the origin around each state step and activates the browser after success', async () => {
    let origin = 'https://goe.neis.go.kr';
    let activated = 0;
    const workflowPage = page(origin);
    workflowPage.currentOrigin = async () => origin;
    workflowPage.pressCandidate = async (_candidate, step) => {
      if (step.id === 'open-duty-section') origin = 'https://evil.example';
    };
    workflowPage.activate = async () => { activated += 1; };

    await expect(executeWindowsWorkflow(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { officeCode: 'goe', browserId: 'edge', workflowId: 'neis-leave' },
      {
        openWorkflowPage: async () => workflowPage,
        isWxsClientRegistered: async () => true,
        listWxsClientWindows: async () => [],
        focusWindow: async () => true,
      },
    )).rejects.toThrow(/허용되지 않은/);
    expect(activated).toBe(0);
  });

  it('requires WXSClient and focuses only a newly created standard-form window', async () => {
    const session = {
      officeCode: 'goe' as const,
      browserId: 'chrome' as const,
      isAlive: () => true,
      close: async () => undefined,
    };
    const workflowRequest = {
      officeCode: 'goe' as const,
      browserId: 'chrome' as const,
      workflowId: 'edufine-draft' as const,
    };
    let openedPage = false;
    await expect(executeWindowsWorkflow(session, workflowRequest, {
      openWorkflowPage: async () => { openedPage = true; return page('https://klef.goe.go.kr'); },
      isWxsClientRegistered: async () => false,
      listWxsClientWindows: async () => [],
      focusWindow: async () => true,
    })).rejects.toThrow(/설치/);
    expect(openedPage).toBe(false);

    let listCount = 0;
    const focused: number[] = [];
    await expect(executeWindowsWorkflow(session, workflowRequest, {
      openWorkflowPage: async () => page('https://klef.goe.go.kr'),
      isWxsClientRegistered: async () => true,
      listWxsClientWindows: async () => {
        listCount += 1;
        return listCount === 1
          ? [{ id: 10, title: '기존 표준서식' }]
          : [{ id: 10, title: '기존 표준서식' }, { id: 11, title: '새 표준서식' }];
      },
      focusWindow: async (id) => { focused.push(id); return true; },
    })).resolves.toMatchObject({ finalState: 'standard-form-editor' });
    expect(focused).toEqual([11]);
  });
});

describe('macOS managed web automation', () => {
  it('returns safe unsupported results without touching browser or window services', async () => {
    let calls = 0;
    const automation = createMacosWebAutomation({ onPlatformCall: () => { calls += 1; } });

    expect(automation.getStatuses()).toEqual([
      { browserId: 'edge', paired: false, connected: false },
      { browserId: 'chrome', paired: false, connected: false },
    ]);
    await expect(automation.prepare('edge')).resolves.toMatchObject({ ok: false });
    await expect(automation.run({
      officeCode: 'goe',
      browserId: 'edge',
      workflowId: 'neis-leave',
    })).resolves.toMatchObject({ ok: false });
    await expect(automation.closeAll()).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });
});
