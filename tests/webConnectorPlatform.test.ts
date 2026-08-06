import { describe, expect, it } from 'vitest';
import type { CandidateSummary } from '../src/main/services/webConnector/workflows/common';
import type { WindowsWorkflowPage } from '../src/main/services/webConnector/windows';
import {
  connectWindowsOfficeSystems,
  createWindowsManagedBrowserSession,
  executeWindowsWorkflow,
  openCdpWindowsApprovalPage,
  openCdpWindowsWorkflowPage,
  restoreAndActivateTarget,
  selectWindowsWorkflowTarget,
} from '../src/main/services/webConnector/windows';
import { createMacosWebAutomation } from '../src/main/services/webConnector/macos';

function safeCandidate(index: number, text: string): CandidateSummary {
  return {
    index,
    text,
    visible: true,
    enabled: true,
    width: 100,
    height: 30,
    navigation: true,
    safeNavigation: true,
    tag: 'A',
    inputType: '',
    href: '/safe-navigation',
    formAssociated: false,
    inlineHandler: false,
    visibleText: text,
    accessibleName: '',
    titleText: '',
    valueText: '',
  };
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
    expect(session.workflowState).toBe('IDLE');
    await session.close();
    expect(protocol.isClosed).toBe(true);
  });

  it('reuses the bootstrap tab, restores the window, and enters NEIS through the portal SSO link', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    let targetChecks = 0;
    let ssoClicked = false;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          targetChecks += 1;
          const url = targetChecks === 1
            ? 'about:blank'
            : ssoClicked
              ? 'https://sen.neis.go.kr/main'
              : 'https://sen.eduptl.kr/';
          return { targetInfos: [{ targetId: 'target-1', type: 'page', url }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'session-1' };
        if (method === 'Browser.getWindowForTarget') {
          return { windowId: 7, bounds: { windowState: 'minimized' } };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression === 'location.origin') {
            return { result: { value: 'https://sen.neis.go.kr' } };
          }
          if (expression.includes('loginVisible')) {
            const href = ssoClicked
              ? 'https://sen.neis.go.kr/main'
              : 'https://sen.eduptl.kr/';
            return { result: { value: {
              href,
              origin: new URL(href).origin,
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes('clickable().slice')) {
            return { result: { value: [safeCandidate(0, '나이스')] } };
          }
          if (expression.includes('const item=clickable()')) {
            ssoClicked = true;
            return { result: { value: { ok: true, x: 10, y: 20 } } };
          }
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
      workflowState: 'IDLE' as const,
      isAlive: () => true,
      close: async () => undefined,
    };

    const workflowPage = await openCdpWindowsWorkflowPage(managedSession as never, 'neis-leave');

    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.find(({ method }) => method === 'Page.navigate')?.params).toEqual({
      url: 'https://sen.eduptl.kr/',
    });
    expect(commands).toContainEqual({
      method: 'Browser.setWindowBounds',
      params: { windowId: 7, bounds: { windowState: 'normal' } },
    });
    expect(ssoClicked).toBe(true);
    expect(managedSession.workflowState).toBe('NAVIGATING_DUTY_MENU');
    await expect(workflowPage.currentOrigin()).resolves.toBe('https://sen.neis.go.kr');
    const releasablePage = workflowPage as WindowsWorkflowPage & {
      release?: () => Promise<void>;
    };
    expect(releasablePage.release).toBeTypeOf('function');
    await releasablePage.release?.();
    expect(commands).toContainEqual({
      method: 'Target.detachFromTarget',
      params: { sessionId: 'session-1' },
    });
    expect(commands.some(({ method }) => method === 'Target.closeTarget')).toBe(false);
  });

  it('keeps a maximized target window intact and never foregrounds another Edge window', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    let nativeFocuses = 0;
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      connection: {
        protocol: {
          isClosed: false,
          async send(method: string, params: Record<string, unknown>) {
            commands.push({ method, params });
            if (method === 'Browser.getWindowForTarget') {
              return { windowId: 11, bounds: { windowState: 'maximized' } };
            }
            return {};
          },
          close() { this.isClosed = true; },
        },
        transportKind: 'pipe' as const,
        process: { pid: 42, exited: false },
      },
      workflowState: 'IDLE' as const,
      isAlive: () => true,
      close: async () => undefined,
    };

    await restoreAndActivateTarget(
      session as never,
      'edufine-target',
      'edufine-session',
      async () => {
        nativeFocuses += 1;
        return true;
      },
    );

    expect(nativeFocuses).toBe(0);
    expect(commands.some(({ method }) => method === 'Browser.setWindowBounds')).toBe(false);
    expect(commands.slice(-2)).toEqual([
      { method: 'Target.activateTarget', params: { targetId: 'edufine-target' } },
      { method: 'Page.bringToFront', params: {} },
    ]);
  });

  it('uses the owned-process focus fallback only when Chromium cannot resolve the target window', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    let nativeFocuses = 0;
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      connection: {
        protocol: {
          isClosed: false,
          async send(method: string, params: Record<string, unknown>) {
            commands.push({ method, params });
            if (method === 'Browser.getWindowForTarget') throw new Error('unsupported');
            return {};
          },
          close() { this.isClosed = true; },
        },
        transportKind: 'pipe' as const,
        process: { pid: 42, exited: false },
      },
      workflowState: 'IDLE' as const,
      isAlive: () => true,
      close: async () => undefined,
    };

    await restoreAndActivateTarget(
      session as never,
      'neis-target',
      undefined,
      async () => {
        nativeFocuses += 1;
        return true;
      },
    );

    expect(nativeFocuses).toBe(1);
    expect(commands.at(-1)).toEqual({
      method: 'Target.activateTarget',
      params: { targetId: 'neis-target' },
    });
  });

  it('ignores an existing work tab and closes only the background approval target created by the app', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return {
            targetInfos: [{
              targetId: 'user-work-target',
              type: 'page',
              url: 'https://sen.neis.go.kr/working-document',
              title: '작성 중인 문서',
            }],
          };
        }
        if (method === 'Target.createTarget') return { targetId: 'approval-target' };
        if (method === 'Target.attachToTarget') return { sessionId: 'approval-session' };
        if (method === 'Runtime.evaluate') {
          if (String(params.expression ?? '').includes('loginVisible')) {
            return { result: { value: {
              href: 'https://sen.neis.go.kr/',
              origin: 'https://sen.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          return { result: { value: 'https://sen.neis.go.kr' } };
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

    const approvalPage = await openCdpWindowsApprovalPage(managedSession as never, {
      system: 'neis',
      officeCode: 'sen',
      browserId: 'edge',
    });
    const releasablePage = approvalPage as typeof approvalPage & {
      release?: () => Promise<void>;
    };
    expect(releasablePage.release).toBeTypeOf('function');
    await releasablePage.release?.();

    expect(commands).toContainEqual({
      method: 'Target.createTarget',
      params: { url: 'https://sen.neis.go.kr/', background: true },
    });
    expect(commands).toContainEqual({
      method: 'Target.attachToTarget',
      params: { targetId: 'approval-target', flatten: true },
    });
    expect(commands).toContainEqual({
      method: 'Target.detachFromTarget',
      params: { sessionId: 'approval-session' },
    });
    expect(commands).toContainEqual({
      method: 'Target.closeTarget',
      params: { targetId: 'approval-target' },
    });
  });

  it('closes a managed browser session when target cleanup fails', async () => {
    let sessionCloses = 0;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'target-1',
            type: 'page',
            url: 'https://sen.neis.go.kr/',
          }] };
        }
        if (method === 'Target.createTarget') return { targetId: 'target-1' };
        if (method === 'Target.attachToTarget') return { sessionId: 'session-1' };
        if (method === 'Runtime.evaluate') {
          if (String(params.expression ?? '').includes('loginVisible')) {
            return { result: { value: {
              href: 'https://sen.neis.go.kr/',
              origin: 'https://sen.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          return { result: { value: 'https://sen.neis.go.kr' } };
        }
        if (method === 'Target.detachFromTarget') throw new Error('detach failed');
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
      close: async () => { sessionCloses += 1; },
    };
    const workflowPage = await openCdpWindowsWorkflowPage(
      managedSession as never,
      'neis-leave',
    );

    await workflowPage.release?.();

    expect(sessionCloses).toBe(1);
  });

  it('recovers through portal SSO when an existing NEIS tab redirects to the portal', async () => {
    let firstTargetLookup = true;
    let ssoClicked = false;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') {
          const url = firstTargetLookup
            ? 'https://goe.neis.go.kr/'
            : ssoClicked
              ? 'https://goe.neis.go.kr/main'
              : 'https://goe.eduptl.kr/';
          firstTargetLookup = false;
          return { targetInfos: [{ targetId: 'existing-neis', type: 'page', url }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'session-1' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 3 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            const href = ssoClicked
              ? 'https://goe.neis.go.kr/main'
              : 'https://goe.eduptl.kr/';
            return { result: { value: {
              href,
              origin: new URL(href).origin,
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes('clickable().slice')) {
            return { result: { value: [safeCandidate(0, '나이스')] } };
          }
          if (expression.includes('const item=clickable()')) {
            ssoClicked = true;
            return { result: { value: { ok: true, x: 1, y: 1 } } };
          }
          if (expression === 'location.origin') {
            return { result: { value: 'https://goe.neis.go.kr' } };
          }
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    await expect(openCdpWindowsWorkflowPage(session as never, 'neis-leave')).resolves.toBeDefined();
    expect(ssoClicked).toBe(true);
  });

  it('enters K-Edufine through the official portal SSO menu instead of a direct login URL', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    let ssoClicked = false;
    let selectedCandidate = -1;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          const url = ssoClicked
            ? 'https://klef.goe.go.kr/main'
            : 'https://goe.eduptl.kr/bpm_man_mn00_001.do';
          return { targetInfos: [{ targetId: 'portal', type: 'page', url }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'portal-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 9 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            const href = ssoClicked
              ? 'https://klef.goe.go.kr/main'
              : 'https://goe.eduptl.kr/bpm_man_mn00_001.do';
            return { result: { value: {
              href,
              origin: new URL(href).origin,
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes('clickable().slice')) {
            return { result: { value: [
              { ...safeCandidate(0, 'K-에듀파인'), left: 20, top: 503 },
              { ...safeCandidate(1, 'K-에듀파인'), left: 20, top: 148 },
            ] } };
          }
          if (expression.includes('const item=clickable()')) {
            selectedCandidate = expression.includes('clickable()[1]') ? 1 : 0;
            ssoClicked = true;
            return { result: { value: { ok: true, x: 2, y: 2 } } };
          }
          if (expression === 'location.origin') {
            return { result: { value: 'https://klef.goe.go.kr' } };
          }
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    const workflowPage = await openCdpWindowsWorkflowPage(
      session as never,
      'edufine-purchase',
    );

    expect(ssoClicked).toBe(true);
    expect(selectedCandidate).toBe(1);
    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.some(({ method, params }) => (
      method === 'Page.navigate' && String(params.url).includes('klef.goe.go.kr')
    ))).toBe(false);
    await workflowPage.release?.();
  });

  it('switches to a newly opened NEIS request page and activates that target', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = [];
    let clicked = false;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'neis-main', type: 'page', url: 'https://goe.neis.go.kr/main' },
            ...(clicked
              ? [{ targetId: 'leave-form', type: 'page', url: 'https://goe.neis.go.kr/leave' }]
              : []),
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: params.targetId === 'leave-form' ? 'leave-session' : 'main-session' };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: 12 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://goe.neis.go.kr/main',
              origin: 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes('const item=clickable()')) {
            clicked = true;
            return { result: { value: { ok: true } } };
          }
          if (expression.includes('근무상황신청')) {
            return { result: { value: sessionId === 'leave-session' } };
          }
          if (expression === 'location.origin') {
            return { result: { value: 'https://goe.neis.go.kr' } };
          }
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };
    const workflowPage = await openCdpWindowsWorkflowPage(session as never, 'neis-leave');
    const step = {
      id: 'open-leave-form',
      candidateLabels: ['신청(새 창 열기)', '신청'],
      selection: 'first-available' as const,
      interaction: 'dom-click' as const,
      allowActionText: true,
      postcondition: {
        kind: 'new-page-any' as const,
        labels: ['근무상황신청', '개인근무상황신청'],
      },
      maxChecks: 20,
      checkDelayMs: 500,
    };

    await workflowPage.pressCandidate(safeCandidate(0, '신청(새 창 열기)'), step);
    await expect(workflowPage.checkPostcondition(step)).resolves.toBe(true);
    await workflowPage.activate();

    expect(commands).toContainEqual({
      method: 'Target.activateTarget',
      params: { targetId: 'leave-form' },
      sessionId: undefined,
    });
    await workflowPage.release?.();
  });

  it('keeps an authenticated system tab and recreates only the background portal tab', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'neis-ready',
            type: 'page',
            url: 'https://goe.neis.go.kr/main',
          }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'neis-session' };
        if (method === 'Runtime.evaluate' && String(params.expression ?? '').includes('loginVisible')) {
          return { result: { value: {
            href: 'https://goe.neis.go.kr/main',
            origin: 'https://goe.neis.go.kr',
            readyState: 'complete',
            loginVisible: false,
          } } };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    await connectWindowsOfficeSystems(session as never, ['neis']);

    expect(commands.some(({ method }) => method === 'Target.closeTarget')).toBe(false);
    expect(commands).toContainEqual({
      method: 'Target.createTarget',
      params: { url: 'https://goe.eduptl.kr/', background: true },
    });
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
    expect(activated).toBe(2);
  });

  it('runs a validated custom Edufine path on the Edufine host', async () => {
    const pressed: string[] = [];
    let activated = 0;
    const workflowPage = page('https://klef.goe.go.kr');
    workflowPage.pressCandidate = async (_candidate, step) => { pressed.push(step.id); };
    workflowPage.activate = async () => { activated += 1; };

    await expect(executeWindowsWorkflow(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      {
        officeCode: 'goe',
        browserId: 'edge',
        workflowId: 'custom',
        workflowSpec: {
          id: 'custom',
          browserId: 'edge',
          custom: {
            name: '에듀파인 문서함',
            system: 'edufine',
            steps: [
              { id: 'step-1', label: '업무관리' },
              { id: 'step-2', label: '내 문서함' },
            ],
            finalText: '내 문서함 목록',
          },
        },
      },
      {
        openWorkflowPage: async () => workflowPage,
        isWxsClientRegistered: async () => false,
        listWxsClientWindows: async () => [],
        focusWindow: async () => true,
      },
    )).resolves.toEqual({ workflowId: 'custom', finalState: 'custom-target-ready' });
    expect(pressed).toEqual(['step-1', 'step-2']);
    expect(activated).toBe(2);
  });

  it('rejects a workflow identifier and definition mismatch before opening a page', async () => {
    let opened = false;
    await expect(executeWindowsWorkflow(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      {
        officeCode: 'goe',
        browserId: 'edge',
        workflowId: 'neis-leave',
        workflowSpec: { id: 'edufine-purchase', browserId: 'edge' },
      },
      {
        openWorkflowPage: async () => { opened = true; return page('https://goe.neis.go.kr'); },
        isWxsClientRegistered: async () => true,
        listWxsClientWindows: async () => [],
        focusWindow: async () => true,
      },
    )).rejects.toThrow(/서로 다릅니다/);
    expect(opened).toBe(false);
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

    let reusedChecks = 0;
    const reusedFocus: number[] = [];
    await expect(executeWindowsWorkflow(session, workflowRequest, {
      openWorkflowPage: async () => page('https://klef.goe.go.kr'),
      isWxsClientRegistered: async () => true,
      listWxsClientWindows: async () => {
        reusedChecks += 1;
        return [{ id: 22, title: 'K-에듀파인 문서작성', handle: 220 }];
      },
      focusWindow: async (id) => { reusedFocus.push(id); return true; },
    })).resolves.toMatchObject({ finalState: 'standard-form-editor' });
    expect(reusedChecks).toBeGreaterThanOrEqual(9);
    expect(reusedFocus).toEqual([22]);
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
