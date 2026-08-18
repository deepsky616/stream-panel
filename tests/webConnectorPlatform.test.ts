import { describe, expect, it, vi } from 'vitest';
import type { CandidateSummary } from '../src/main/services/webConnector/workflows/common';
import type { WindowsWorkflowPage } from '../src/main/services/webConnector/windows';
import {
  connectWindowsOfficeSystems,
  createWindowsManagedBrowserSession,
  executeWindowsWorkflow,
  getWindowsConnectionPresence,
  openCdpWindowsApprovalPage,
  openCdpWindowsWorkflowPage,
  restoreAndActivateTarget,
  resetWindowsWorkflowTargets,
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

  it('keeps every existing tab and remembers the authenticated NEIS tab for an in-place restart', async () => {
    let targets = [
      { targetId: 'neis-main', type: 'page', url: 'https://goe.neis.go.kr/main' },
      { targetId: 'neis-form', type: 'page', url: 'https://goe.neis.go.kr/leave/request' },
      { targetId: 'edufine', type: 'page', url: 'https://klef.goe.go.kr/main' },
      { targetId: 'personal', type: 'page', url: 'https://mail.example.com/' },
    ];
    const closed: string[] = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') return { targetInfos: targets };
        if (method === 'Target.closeTarget') {
          const targetId = String(params.targetId);
          closed.push(targetId);
          targets = targets.filter((target) => target.targetId !== targetId);
          return { success: true };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    await resetWindowsWorkflowTargets({
      officeCode: 'goe',
      browserId: 'edge',
      systemTargetIds: { neis: 'neis-main' },
      connection: { protocol, process: { exited: false }, transportKind: 'pipe' },
      workflowState: 'IDLE',
      isAlive: () => true,
      close: async () => undefined,
    } as never, 'neis-leave');

    expect(closed).toEqual([]);
    expect(targets.map(({ targetId }) => targetId)).toEqual([
      'neis-main',
      'neis-form',
      'edufine',
      'personal',
    ]);
  });

  it('keeps every existing tab and remembers the authenticated Edufine tab for an in-place restart', async () => {
    let targets = [
      { targetId: 'edufine-main', type: 'page', url: 'https://klef.goe.go.kr/main' },
      { targetId: 'edufine-form', type: 'page', url: 'https://klef.goe.go.kr/purchase/popup' },
      { targetId: 'neis', type: 'page', url: 'https://goe.neis.go.kr/main' },
      { targetId: 'personal', type: 'page', url: 'https://mail.example.com/' },
    ];
    const closed: string[] = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') return { targetInfos: targets };
        if (method === 'Target.closeTarget') {
          const targetId = String(params.targetId);
          closed.push(targetId);
          targets = targets.filter((target) => target.targetId !== targetId);
          return { success: true };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };

    await resetWindowsWorkflowTargets({
      officeCode: 'goe',
      browserId: 'edge',
      systemTargetIds: { edufine: 'edufine-main' },
      connection: { protocol, process: { exited: false }, transportKind: 'pipe' },
      workflowState: 'IDLE',
      isAlive: () => true,
      close: async () => undefined,
    } as never, 'edufine-purchase');

    expect(closed).toEqual([]);
    expect(targets.map(({ targetId }) => targetId)).toEqual([
      'edufine-main',
      'edufine-form',
      'neis',
      'personal',
    ]);
  });

  it('keeps custom workflow tabs and reuses its remembered system tab too', async () => {
    let targets = [
      { targetId: 'edufine-main', type: 'page', url: 'https://klef.goe.go.kr/main' },
      { targetId: 'edufine-custom-work', type: 'page', url: 'https://klef.goe.go.kr/custom/work' },
      { targetId: 'neis-main', type: 'page', url: 'https://goe.neis.go.kr/main' },
    ];
    const closed: string[] = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') return { targetInfos: targets };
        if (method === 'Target.closeTarget') {
          const targetId = String(params.targetId);
          closed.push(targetId);
          targets = targets.filter((target) => target.targetId !== targetId);
          return { success: true };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };

    await resetWindowsWorkflowTargets({
      officeCode: 'goe',
      browserId: 'edge',
      systemTargetIds: { edufine: 'edufine-main' },
      connection: { protocol, process: { exited: false }, transportKind: 'pipe' },
      workflowState: 'IDLE',
      isAlive: () => true,
      close: async () => undefined,
    } as never, 'custom', {
      id: 'custom',
      browserId: 'edge',
      officeCode: 'goe',
      custom: {
        name: '내 문서함',
        system: 'edufine',
        steps: [{ id: 'step-1', label: '내 문서함' }],
        finalText: '내 문서함 목록',
      },
    });

    expect(closed).toEqual([]);
    expect(targets.map(({ targetId }) => targetId)).toEqual([
      'edufine-main',
      'edufine-custom-work',
      'neis-main',
    ]);
  });

  it('extends sessions only on the selected office system origins', async () => {
    vi.useFakeTimers();
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'neis', type: 'page', url: 'https://goe.neis.go.kr/main' },
            { targetId: 'edufine', type: 'page', url: 'https://klef.goe.go.kr/main' },
            { targetId: 'portal', type: 'page', url: 'https://goe.eduptl.kr/' },
            { targetId: 'other', type: 'page', url: 'https://sen.neis.go.kr/' },
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Runtime.evaluate') {
          return { result: { value: { handled: false } } };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    try {
      const session = await createWindowsManagedBrowserSession('goe', 'edge', {
        userDataPath: 'C:\\StreamPanel',
        env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
        exists: (path) => path.endsWith('Microsoft\\Edge\\Application\\msedge.exe'),
        makeDirectory: async () => undefined,
        connectBrowser: async () => ({
          transportKind: 'pipe',
          protocol: protocol as never,
          process: {
            pid: 42,
            exited: false,
            close: async () => undefined,
          } as never,
        }),
      });

      session.maintenancePauseDepth = 1;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(commands.some(({ method }) => method === 'Target.attachToTarget')).toBe(false);
      session.maintenancePauseDepth = 0;
      await vi.advanceTimersByTimeAsync(60_000);

      const attachedTargets = commands
        .filter(({ method }) => method === 'Target.attachToTarget')
        .map(({ params }) => params.targetId);
      expect(attachedTargets).toEqual(['neis', 'edufine', 'portal']);
      expect(commands.filter(({ method }) => method === 'Runtime.evaluate')).toHaveLength(3);
      expect(commands.some(({ method, params }) => (
        method === 'Target.setDiscoverTargets' && params.discover === true
      ))).toBe(true);
      await session.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses the bootstrap tab, restores the window, and opens NEIS directly', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [{ targetId: 'target-1', type: 'page', url: 'about:blank' }] };
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
            return { result: { value: {
              href: 'https://sen.neis.go.kr/main',
              origin: 'https://sen.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
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
      url: 'https://sen.neis.go.kr/',
    });
    expect(commands).toContainEqual({
      method: 'Browser.setWindowBounds',
      params: { windowId: 7, bounds: { windowState: 'normal' } },
    });
    expect(commands.some(({ method, params }) => (
      method === 'Runtime.evaluate' && String(params.expression).includes('clickable().slice')
    ))).toBe(false);
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

  it('reuses the connected system tab for approval checks without creating or closing a tab', async () => {
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
      systemTargetIds: { neis: 'user-work-target' },
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
      method: 'Target.attachToTarget',
      params: { targetId: 'user-work-target', flatten: true },
    });
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(commands).toContainEqual({
      method: 'Target.detachFromTarget',
      params: { sessionId: 'approval-session' },
    });
    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.some(({ method }) => method === 'Target.closeTarget')).toBe(false);
  });

  it('does not let a scheduled approval check navigate away from an active work form', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'edufine-work-form',
            type: 'page',
            url: 'https://klef.goe.go.kr/purchase',
          }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'edufine-work-session' };
        if (
          method === 'Runtime.evaluate' &&
          String(params.expression ?? '').includes('const activeWorkSystem="edufine"')
        ) return { result: { value: true } };
        return {};
      },
      close() { this.isClosed = true; },
    };
    const managedSession = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      systemTargetIds: { edufine: 'edufine-work-form' },
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    await expect(openCdpWindowsApprovalPage(managedSession as never, {
      system: 'edufine',
      officeCode: 'goe',
      browserId: 'edge',
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
  });

  it('counts only the Edufine approval-list grid and ignores an unrelated 100-row selector', async () => {
    let countExpression = '';
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'edufine-anchor',
            type: 'page',
            url: 'https://klef.goe.go.kr/main',
          }] };
        }
        if (method === 'Target.createTarget') return { targetId: 'edufine-approval' };
        if (method === 'Target.attachToTarget') return { sessionId: 'edufine-approval-session' };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://klef.goe.go.kr/main',
              origin: 'https://klef.goe.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes("[id$='btnUseTimeExtn']")) {
            return { result: { value: { handled: false } } };
          }
          if (expression.includes('const approvalSystem="edufine"')) {
            countExpression = expression;
            return { result: { value: {
              candidates: [{
                text: '전체 100', ariaLabel: '', title: '', className: 'page-size', role: 'option', children: [],
              }],
              rowCounts: [
                { count: 1, area: 60_000, relevant: true, source: 'nexacro' },
                { count: 100, area: 90_000, relevant: false, source: 'nexacro' },
              ],
              emptyList: false,
              listReady: true,
            } } };
          }
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const managedSession = {
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

    const approvalPage = await openCdpWindowsApprovalPage(managedSession as never, {
      system: 'edufine',
      officeCode: 'goe',
      browserId: 'edge',
    });
    await expect(approvalPage.readApprovalCount('edufine')).resolves.toBe(1);
    expect(countExpression).toContain("const requiredHeaderMatches=approvalSystem==='edufine'?2:1");
    expect(countExpression).not.toContain('||screenMarkerVisible');
    expect(countExpression).toContain('collection.get_item?.(index)');
    expect(() => new Function(`return ${countExpression}`)).not.toThrow();
    await approvalPage.release?.();
  });

  it('keeps and activates a manual approval tab when login is required', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') return { targetInfos: [] };
        if (method === 'Target.createTarget') return { targetId: 'approval-login-target' };
        if (method === 'Target.attachToTarget') return { sessionId: 'approval-login-session' };
        if (method === 'Browser.getWindowForTarget') {
          return { windowId: 7, bounds: { windowState: 'normal' } };
        }
        if (method === 'Runtime.evaluate') {
          return { result: { value: {
            href: 'https://sen.neis.go.kr/login',
            origin: 'https://sen.neis.go.kr',
            readyState: 'complete',
            loginVisible: true,
          } } };
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

    await expect(openCdpWindowsApprovalPage(managedSession as never, {
      system: 'neis',
      officeCode: 'sen',
      browserId: 'edge',
      interactive: true,
    })).rejects.toThrow();

    expect(commands).toContainEqual({
      method: 'Target.activateTarget',
      params: { targetId: 'approval-login-target' },
    });
    expect(commands.some(({ method }) => method === 'Target.closeTarget')).toBe(false);
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

  it('keeps the portal tab intact and opens NEIS in a separate direct tab', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'portal',
            type: 'page',
            url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do',
          }] };
        }
        if (method === 'Target.createTarget') return { targetId: 'direct-neis' };
        if (method === 'Target.attachToTarget') return { sessionId: 'neis-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 3 };
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
    expect(commands).toContainEqual({
      method: 'Target.createTarget',
      params: { url: 'https://goe.neis.go.kr/jsp/main.jsp' },
    });
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(commands.some(({ method, params }) => (
      method === 'Runtime.evaluate' && String(params.expression).includes('clickable().slice')
    ))).toBe(false);
    await workflowPage.release?.();
  });

  it('reuses a blank tab and opens K-Edufine directly without a portal click', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [{ targetId: 'bootstrap', type: 'page', url: 'about:blank' }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'edufine-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 9 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://klef.goe.go.kr/main',
              origin: 'https://klef.goe.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
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

    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands).toContainEqual({
      method: 'Page.navigate',
      params: { url: 'https://klef.goe.go.kr/' },
    });
    expect(commands.some(({ method, params }) => (
      method === 'Runtime.evaluate' && String(params.expression).includes('clickable().slice')
    ))).toBe(false);
    await workflowPage.release?.();
  });

  it('creates a new rightmost tab when an interactive workflow requests a fresh target', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    let openedFromExistingSystemTab = false;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'old-edufine', type: 'page', url: 'https://klef.goe.go.kr/old' },
            { targetId: 'bootstrap', type: 'page', url: 'about:blank' },
            ...(openedFromExistingSystemTab
              ? [{ targetId: 'fresh-edufine', type: 'page', url: 'https://klef.goe.go.kr/' }]
              : []),
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: params.targetId === 'old-edufine' ? 'anchor-session' : 'fresh-session' };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: 9 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('window.open')) {
            openedFromExistingSystemTab = true;
            return { result: { value: true } };
          }
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://klef.goe.go.kr/main',
              origin: 'https://klef.goe.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      bootstrapTargetId: 'bootstrap',
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
      undefined,
      { forceNewTarget: true },
    );

    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.some(({ method, params }) => (
      method === 'Runtime.evaluate' &&
      String(params.expression).includes("window.open(\"https://klef.goe.go.kr/\",'_blank')")
    ))).toBe(true);
    expect(commands).toContainEqual({
      method: 'Target.attachToTarget',
      params: { targetId: 'old-edufine', flatten: true },
    });
    expect(commands).toContainEqual({
      method: 'Target.attachToTarget',
      params: { targetId: 'fresh-edufine', flatten: true },
    });
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    await workflowPage.release?.();
  });

  it('continues a workflow inside the remembered authenticated tab without resetting its current screen', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'neis-anchor', type: 'page', url: 'https://goe.neis.go.kr/leave/old' },
            { targetId: 'edufine-anchor', type: 'page', url: 'https://klef.goe.go.kr/main' },
          ] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'neis-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 10 };
        if (method === 'Runtime.evaluate' && String(params.expression ?? '').includes('loginVisible')) {
          return { result: { value: {
            href: 'https://goe.neis.go.kr/',
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
      systemTargetIds: { neis: 'neis-anchor' },
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
      'neis-leave',
      undefined,
    );

    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.some(({ method, params }) => (
      method === 'Runtime.evaluate' && String(params.expression).includes('window.open')
    ))).toBe(false);
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(commands).toContainEqual({
      method: 'Target.activateTarget',
      params: { targetId: 'neis-anchor' },
    });
    expect(commands.some(({ method, params }) => (
      method === 'Target.activateTarget' && params.targetId === 'edufine-anchor'
    ))).toBe(false);
    await workflowPage.release?.();
  });

  it('invalidates live connection targets as soon as their managed tabs close', async () => {
    let eventListener: ((event: { method: string; params?: unknown }) => void) | undefined;
    let listenerRemoved = false;
    const closed: Array<{ role: string; system?: string }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string) {
        if (method === 'Target.getTargets') return { targetInfos: [] };
        return {};
      },
      onEvent(listener: (event: { method: string; params?: unknown }) => void) {
        eventListener = listener;
        return () => { listenerRemoved = true; };
      },
      close() { this.isClosed = true; },
    };
    const session = await createWindowsManagedBrowserSession('goe', 'edge', {
      userDataPath: 'C:\\StreamPanel',
      env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
      exists: (path) => path.endsWith('Microsoft\\Edge\\Application\\msedge.exe'),
      makeDirectory: async () => undefined,
      connectBrowser: async () => ({
        transportKind: 'pipe',
        protocol: protocol as never,
        process: {
          pid: 42,
          exited: false,
          close: async (graceful?: () => Promise<void>) => { await graceful?.(); },
        } as never,
      }),
      onManagedTargetClosed: (role, system) => { closed.push({ role, system }); },
    });
    session.portalTargetId = 'portal';
    session.connectionTargetIds = { neis: 'neis', edufine: 'edufine' };
    session.systemTargetIds = { neis: 'neis', edufine: 'edufine' };

    eventListener?.({ method: 'Target.targetDestroyed', params: { targetId: 'neis' } });
    expect(getWindowsConnectionPresence(session)).toEqual({
      portal: true,
      systems: { neis: false, edufine: true },
    });
    eventListener?.({ method: 'Target.targetDestroyed', params: { targetId: 'portal' } });
    expect(getWindowsConnectionPresence(session).portal).toBe(false);
    expect(closed).toEqual([
      { role: 'system', system: 'neis' },
      { role: 'portal', system: undefined },
    ]);

    await session.close();
    expect(listenerRemoved).toBe(true);
  });

  it.each([
    {
      system: 'neis' as const,
      workflowId: 'neis-trip' as const,
      anchorId: 'neis-main',
      anchorUrl: 'https://goe.neis.go.kr/main',
      resultId: 'neis-leave-form',
      resultUrl: 'https://goe.neis.go.kr/leave/request',
    },
    {
      system: 'edufine' as const,
      workflowId: 'edufine-purchase' as const,
      anchorId: 'edufine-main',
      anchorUrl: 'https://klef.goe.go.kr/main',
      resultId: 'edufine-draft-form',
      resultUrl: 'https://klef.goe.go.kr/draft/form',
    },
  ])('closes the remembered $system result window before reusing its connected parent tab', async ({
    system,
    workflowId,
    anchorId,
    anchorUrl,
    resultId,
    resultUrl,
  }) => {
    const attachedTargetIds: string[] = [];
    const closedTargetIds: string[] = [];
    let resultOpen = true;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') {
          // Put the former result first to prove it cannot replace the stable
          // system anchor when both pages still briefly appear in CDP.
          return { targetInfos: [
            ...(resultOpen
              ? [{ targetId: resultId, type: 'page', url: resultUrl, openerId: anchorId }]
              : []),
            { targetId: anchorId, type: 'page', url: anchorUrl },
          ] };
        }
        if (method === 'Target.closeTarget') {
          closedTargetIds.push(String(params.targetId));
          if (params.targetId === resultId) resultOpen = false;
          return { success: true };
        }
        if (method === 'Target.attachToTarget') {
          const targetId = String(params.targetId);
          attachedTargetIds.push(targetId);
          return { sessionId: `${targetId}-session` };
        }
        if (method === 'Browser.getWindowForTarget') {
          return { windowId: 31, bounds: { windowState: 'normal' } };
        }
        if (method === 'Runtime.evaluate' && String(params.expression ?? '').includes('loginVisible')) {
          return { result: { value: {
            href: anchorUrl,
            origin: new URL(anchorUrl).origin,
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
      systemTargetIds: { [system]: resultId },
      connectionTargetIds: { [system]: anchorId },
      workflowResultTargetIds: { [system]: resultId },
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    await resetWindowsWorkflowTargets(session as never, workflowId);
    const workflowPage = await openCdpWindowsWorkflowPage(session as never, workflowId);

    expect(closedTargetIds).toEqual([resultId]);
    expect(attachedTargetIds).toContain(anchorId);
    if (system === 'neis') expect(attachedTargetIds).toContain(resultId);
    else expect(attachedTargetIds).not.toContain(resultId);
    expect((session.systemTargetIds as Record<string, string>)[system]).toBe(anchorId);
    expect((session.workflowResultTargetIds as Record<string, string>)[system]).toBeUndefined();
    await workflowPage.release?.();
  });

  it('recovers and closes an unremembered NEIS request page without opener metadata', async () => {
    const closedTargetIds: string[] = [];
    const detachedSessionIds: string[] = [];
    let requestOpen = true;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            ...(requestOpen ? [{
              targetId: 'leave-request',
              type: 'page',
              url: 'https://goe.neis.go.kr/leave/request',
            }] : []),
            {
              targetId: 'neis-main',
              type: 'page',
              url: 'https://goe.neis.go.kr/main',
            },
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Runtime.evaluate' && sessionId === 'leave-request-session') {
          return { result: { value: true } };
        }
        if (method === 'Target.detachFromTarget') {
          detachedSessionIds.push(String(params.sessionId));
          return {};
        }
        if (method === 'Target.closeTarget') {
          closedTargetIds.push(String(params.targetId));
          if (params.targetId === 'leave-request') requestOpen = false;
          return { success: true };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      systemTargetIds: { neis: 'leave-request' },
      connectionTargetIds: { neis: 'neis-main' },
      workflowResultTargetIds: {},
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    await resetWindowsWorkflowTargets(session as never, 'neis-trip');

    expect(closedTargetIds).toEqual(['leave-request']);
    expect(detachedSessionIds).toEqual([
      'leave-request-session',
      'leave-request-session',
      'leave-request-session',
    ]);
    expect(session.systemTargetIds.neis).toBe('neis-main');
  });

  it('closes a NEIS request window reached through an intermediate owned opener', async () => {
    const closedTargetIds: string[] = [];
    let requestOpen = true;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            ...(requestOpen ? [{
              targetId: 'leave-request',
              type: 'page',
              url: 'https://goe.neis.go.kr/leave/request',
              openerId: 'neis-work-frame',
            }] : []),
            {
              targetId: 'neis-work-frame',
              type: 'page',
              url: 'https://goe.neis.go.kr/work',
              openerId: 'neis-main',
            },
            {
              targetId: 'neis-main',
              type: 'page',
              url: 'https://goe.neis.go.kr/main',
            },
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Runtime.evaluate' && sessionId === 'leave-request-session') {
          const expression = String(params.expression ?? '');
          if (expression.includes('window.close()')) {
            requestOpen = false;
            return { result: { value: true } };
          }
          return { result: { value: true } };
        }
        if (method === 'Runtime.evaluate') return { result: { value: false } };
        if (method === 'Target.closeTarget') {
          closedTargetIds.push(String(params.targetId));
          return { success: true };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };

    await resetWindowsWorkflowTargets({
      officeCode: 'goe',
      browserId: 'edge',
      systemTargetIds: { neis: 'neis-main' },
      connectionTargetIds: { neis: 'neis-main' },
      workflowResultTargetIds: {},
      connection: {
        protocol,
        transportKind: 'pipe',
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    } as never, 'neis-trip');

    expect(requestOpen).toBe(false);
    expect(closedTargetIds).toEqual([]);
  });

  it('does not close a NEIS request page opened by another NEIS tab', async () => {
    const closedTargetIds: string[] = [];
    const attachedTargetIds: string[] = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            {
              targetId: 'other-request',
              type: 'page',
              url: 'https://goe.neis.go.kr/leave/request',
              openerId: 'other-neis',
            },
            {
              targetId: 'other-neis',
              type: 'page',
              url: 'https://goe.neis.go.kr/other',
            },
            {
              targetId: 'neis-main',
              type: 'page',
              url: 'https://goe.neis.go.kr/main',
            },
          ] };
        }
        if (method === 'Target.attachToTarget') {
          attachedTargetIds.push(String(params.targetId));
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Runtime.evaluate') {
          return { result: { value: sessionId === 'other-request-session' } };
        }
        if (method === 'Target.closeTarget') {
          closedTargetIds.push(String(params.targetId));
          return { success: true };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };

    await resetWindowsWorkflowTargets({
      officeCode: 'goe',
      browserId: 'edge',
      systemTargetIds: { neis: 'neis-main' },
      connectionTargetIds: { neis: 'neis-main' },
      workflowResultTargetIds: {},
      connection: {
        protocol,
        transportKind: 'pipe',
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    } as never, 'neis-trip');

    expect(attachedTargetIds).not.toContain('other-request');
    expect(closedTargetIds).toEqual([]);
  });

  it('prefers window.close for an existing NEIS request window', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    let requestOpen = true;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            ...(requestOpen ? [{
              targetId: 'trip-request',
              type: 'page',
              url: 'https://goe.neis.go.kr/trip/request',
            }] : []),
            {
              targetId: 'neis-main',
              type: 'page',
              url: 'https://goe.neis.go.kr/main',
            },
          ] };
        }
        if (method === 'Target.closeTarget') return { success: false };
        if (method === 'Target.attachToTarget') return { sessionId: 'trip-request-session' };
        if (
          method === 'Runtime.evaluate' &&
          String(params.expression ?? '').includes('window.close()')
        ) {
          requestOpen = false;
          return { result: { value: true } };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      systemTargetIds: { neis: 'neis-main' },
      connectionTargetIds: { neis: 'neis-main' },
      workflowResultTargetIds: { neis: 'trip-request' },
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    await resetWindowsWorkflowTargets(session as never, 'neis-leave');

    expect(requestOpen).toBe(false);
    expect(commands.some(({ method, params }) => (
      method === 'Runtime.evaluate' && String(params.expression ?? '').includes('window.close()')
    ))).toBe(true);
    expect(commands.some(({ method }) => method === 'Target.closeTarget')).toBe(false);
    expect(session.systemTargetIds.neis).toBe('neis-main');
    expect(session.workflowResultTargetIds.neis).toBeUndefined();
  });

  it('scans nested frames and safely extends an exact session timeout prompt', async () => {
    const evaluationParams: Record<string, unknown>[] = [];
    const inputCommands: Array<{ params: Record<string, unknown>; sessionId?: string }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        if (method === 'Input.dispatchMouseEvent') {
          inputCommands.push({ params, sessionId });
          return {};
        }
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'neis-main',
            type: 'page',
            url: 'https://goe.neis.go.kr/main',
          }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'neis-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 6 };
        if (method === 'Runtime.evaluate') {
          evaluationParams.push(params);
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://goe.neis.go.kr/main',
              origin: 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes("[id$='btnUseTimeExtn']")) {
            return { result: { value: { handled: true, x: 70, y: 45 } } };
          }
          if (expression.includes('clickable().slice')) {
            return { result: { value: [] } };
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
    await expect(workflowPage.inspectCandidates({} as never)).resolves.toEqual([]);

    const readiness = evaluationParams.find(({ expression }) => (
      String(expression).includes('loginVisible')
    ));
    expect(String(readiness?.expression)).toContain("querySelectorAll('iframe,frame')");
    expect(() => new Function(`return ${String(readiness?.expression)}`)).not.toThrow();
    const extension = evaluationParams.find(({ expression }) => (
      String(expression).includes("[id$='btnUseTimeExtn']")
    ));
    expect(String(extension?.expression)).toContain("[id$='staUseTime']");
    expect(String(extension?.expression)).toContain('remainingSeconds>1200');
    expect(String(extension?.expression)).toContain('candidates.length!==1');
    expect(String(extension?.expression)).toContain("querySelectorAll('iframe,frame')");
    expect(String(extension?.expression)).toContain("'자동 로그아웃'");
    expect(String(extension?.expression)).toContain("closest?.('[role=\"dialog\"]");
    expect(() => new Function(`return ${String(extension?.expression)}`)).not.toThrow();
    expect(extension?.userGesture).toBe(true);
    expect(inputCommands).toEqual([
      { params: { type: 'mouseMoved', x: 70, y: 45 }, sessionId: 'neis-session' },
      {
        params: { type: 'mousePressed', x: 70, y: 45, button: 'left', clickCount: 1 },
        sessionId: 'neis-session',
      },
      {
        params: { type: 'mouseReleased', x: 70, y: 45, button: 'left', clickCount: 1 },
        sessionId: 'neis-session',
      },
    ]);
    await workflowPage.release?.();
  });

  it('uses each scoped Nexacro menu surface for Edufine navigation', async () => {
    const expressions: string[] = [];
    const inputCommands: string[] = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'edufine-main',
            type: 'page',
            url: 'https://klef.goe.go.kr/main',
          }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'edufine-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 19 };
        if (method === 'Input.dispatchMouseEvent') {
          inputCommands.push(String(params.type));
          return {};
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          expressions.push(expression);
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://klef.goe.go.kr/main',
              origin: 'https://klef.goe.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes("[id$='btnUseTimeExtn']")) {
            return { result: { value: { handled: false } } };
          }
          if (expression.includes("'NEXACRO-COMBO'")) {
            return { result: { value: [safeCandidate(0, '학교회계')] } };
          }
          if (expression.includes("'NEXACRO-JOB-TOGGLE'")) {
            return { result: { value: [safeCandidate(0, '업무관리')] } };
          }
          if (expression.includes("'NEXACRO-JOB-OPTION'")) {
            return { result: { value: [safeCandidate(0, '학교회계')] } };
          }
          if (expression.includes("'EXACT-TEXT'")) {
            return { result: { value: [safeCandidate(0, '내 문서함')] } };
          }
          if (expression.includes("'NEXACRO-TOP-MENU'")) {
            return { result: { value: [safeCandidate(0, '사업관리')] } };
          }
          if (expression.includes("'NEXACRO-DOCUMENT-MENU'")) {
            return { result: { value: [safeCandidate(0, '공용서식')] } };
          }
          if (expression.includes("'NEXACRO-RIGHT-MENU'")) {
            return { result: { value: [safeCandidate(0, '결재(긴급)')] } };
          }
          if (expression.includes("'NEXACRO-MEGA-MENU'")) {
            return { result: { value: [safeCandidate(0, '품의등록')] } };
          }
          if (expression.includes("'NEXACRO-POPUP-MENU'")) {
            return { result: { value: [safeCandidate(0, '표준서식(결재4인,협조4인)')] } };
          }
          if (expression.includes("'NEXACRO-LEFT-MENU'")) {
            return { result: { value: [safeCandidate(0, '사업담당')] } };
          }
          if (expression.includes("'NEXACRO-LEFT-TOGGLE'")) {
            return { result: { value: [safeCandidate(0, '업무관리')] } };
          }
          if (expression.includes('const interaction="edufine-top-menu"') ||
            expression.includes('const interaction="edufine-document-menu"') ||
            expression.includes('const interaction="edufine-right-menu"') ||
            expression.includes('const interaction="edufine-mega-menu"') ||
            expression.includes('const interaction="edufine-popup-menu"') ||
            expression.includes('const interaction="edufine-submenu"')) {
            return { result: { value: { ok: true, x: 100, y: 50 } } };
          }
          if (expression.includes('const interaction="edufine-left-menu"')) {
            return { result: { value: { ok: true, x: 55, y: 140 } } };
          }
          if (expression.includes('const interaction="edufine-left-toggle"')) {
            return { result: { value: { ok: true, x: 42, y: 120 } } };
          }
          if (expression.includes('const interaction="edufine-job-toggle"') ||
            expression.includes('const interaction="edufine-job-option"')) {
            return { result: { value: { ok: true, x: 90, y: 40 } } };
          }
          if (expression.includes('const interaction="frame-exact-text"')) {
            return { result: { value: { ok: true, x: 80, y: 30 } } };
          }
          if (expression.includes('const interaction="edufine-job"')) {
            return { result: { value: { ok: true, direct: true } } };
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
    const jobToggleStep = {
      id: 'open-job-selector',
      candidateLabels: ['업무관리'],
      interaction: 'edufine-left-toggle' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['학교회계'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const jobOptionStep = {
      id: 'select-school-accounting-option',
      candidateLabels: ['학교회계'],
      interaction: 'edufine-job-option' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['사업담당'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const jobStep = {
      id: 'select-school-accounting',
      candidateLabels: ['학교회계'],
      interaction: 'edufine-job' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['사업관리'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const topStep = {
      id: 'open-business-owner',
      candidateLabels: ['사업관리'],
      interaction: 'edufine-top-menu' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['품의등록'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const leftStep = {
      id: 'open-business-owner-left',
      candidateLabels: ['사업담당'],
      interaction: 'edufine-left-menu' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['품의/정산'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const documentStep = {
      id: 'open-public-forms',
      candidateLabels: ['공용서식'],
      interaction: 'edufine-document-menu' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['표준서식'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const rightStep = {
      id: 'open-document-approval',
      candidateLabels: ['결재(긴급)'],
      interaction: 'edufine-right-menu' as const,
      allowActionText: true,
      postcondition: { kind: 'edufine-mega-menu-any' as const, labels: ['결재대기'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const megaStep = {
      id: 'open-purchase-registration',
      candidateLabels: ['품의등록'],
      interaction: 'edufine-mega-menu' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['예산내역'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const popupStep = {
      id: 'open-standard-form',
      candidateLabels: ['표준서식(결재4인,협조4인)'],
      interaction: 'edufine-popup-menu' as const,
      postcondition: {
        kind: 'new-window' as const,
        processName: 'WXSClient' as const,
        titleIncludes: '표준서식',
      },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const submenuStep = {
      id: 'open-public-form-submenu',
      candidateLabels: ['공용서식'],
      interaction: 'edufine-submenu' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['표준서식'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };
    const frameExactStep = {
      id: 'open-custom-menu',
      candidateLabels: ['내 문서함'],
      interaction: 'frame-exact-text' as const,
      selection: 'first-available' as const,
      postcondition: { kind: 'visible-any' as const, labels: ['문서함 목록'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };

    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(jobToggleStep))[0],
      jobToggleStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(jobOptionStep))[0],
      jobOptionStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(jobStep))[0],
      jobStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(leftStep))[0],
      leftStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(topStep))[0],
      topStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(documentStep))[0],
      documentStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(rightStep))[0],
      rightStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(megaStep))[0],
      megaStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(popupStep))[0],
      popupStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(submenuStep))[0],
      submenuStep,
    );
    await workflowPage.pressCandidate(
      (await workflowPage.inspectCandidates(frameExactStep))[0],
      frameExactStep,
    );

    expect(expressions.some((expression) => expression.includes('cboJobList'))).toBe(true);
    expect(expressions.some((expression) => expression.includes("[id*='cboJobList'][id*='dropbutton']"))).toBe(true);
    expect(expressions.some((expression) => expression.includes("[id*='combolist']"))).toBe(true);
    expect(expressions.some((expression) => expression.includes('_on_value_change'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('unchanged:true'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('[id*="TopFrame"]'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('[id*="pdvMegaMenu"]'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('leftframe|leftmenu|left_menu|lnb'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('rightframe|rightmenu|right_menu|quickmenu'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('popupmenu|popup_menu|popupdiv'))).toBe(true);
    expect(expressions.some((expression) => (
      expression.includes('const interaction="edufine-popup-menu"') &&
      expression.includes('if(excluded.test(signal)&&!explicit)return null')
    ))).toBe(true);
    expect(expressions.some((expression) => (
      expression.includes('const interaction="edufine-submenu"') &&
      expression.includes('leftMenuMatch(label)||popupMenuMatch(label)')
    ))).toBe(true);
    expect(expressions.some((expression) => (
      expression.includes('const interaction="edufine-submenu"') &&
      expression.includes('leftMenuMatch()||popupMenuMatch()')
    ))).toBe(true);
    expect(expressions.some((expression) => expression.includes("sectionLabels=['문서관리','문서 관리']"))).toBe(true);
    expect(expressions.some((expression) => expression.includes('rightframe|rightmenu|right_menu|quickmenu'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('const interaction="edufine-document-menu"'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('NEXACRO-LEFT-TOGGLE'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('const interaction="frame-exact-text"'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('surfaceTextsOf(element).some'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('offsetX+rect.left+rect.width/2'))).toBe(true);
    expect(expressions.some((expression) => expression.includes('forbiddenTokens'))).toBe(true);
    for (const expression of expressions.filter((value) => value.includes('displayedLabelMatches'))) {
      expect(() => new Function(`return ${expression}`)).not.toThrow();
    }
    expect(inputCommands).toEqual([
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
      'mouseMoved', 'mousePressed', 'mouseReleased',
    ]);
    await workflowPage.release?.();
  });

  it('finds, clicks, and verifies an Edufine menu inside a cross-origin child frame', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'edufine-main',
            type: 'page',
            url: 'https://klef.goe.go.kr/main',
          }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'edufine-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 29 };
        if (method === 'Page.getFrameTree') {
          return {
            frameTree: {
              frame: { id: 'main-frame' },
              childFrames: [{ frame: { id: 'nexacro-frame' } }],
            },
          };
        }
        if (method === 'Page.createIsolatedWorld') return { executionContextId: 222 };
        if (method === 'DOM.getContentQuads') {
          return { quads: [[310, 170, 410, 170, 410, 230, 310, 230]] };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://klef.goe.go.kr/main',
              origin: 'https://klef.goe.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes("[id$='btnUseTimeExtn']")) {
            return { result: { value: { handled: false } } };
          }
          if (expression.includes('const approvalSystem="edufine"')) {
            return { result: { value: params.contextId === 222
              ? {
                  candidates: [],
                  rowCounts: [{ count: 1, area: 10_000, relevant: true, source: 'nexacro' }],
                  emptyList: false,
                  listReady: true,
                }
              : { candidates: [], rowCounts: [], emptyList: false, listReady: false } } };
          }
          if (expression.includes("'NEXACRO-LEFT-MENU'")) {
            return { result: { value: params.contextId === 222
              ? [safeCandidate(0, '기안')]
              : [] } };
          }
          if (expression.includes('const interaction="edufine-left-menu"')) {
            if (params.contextId === 222 && expression.includes('const returnElement=true')) {
              return { result: { objectId: 'draft-menu-node', subtype: 'node' } };
            }
            return { result: { value: { ok: false } } };
          }
          if (expression.includes('const selector=')) {
            return { result: { value: params.contextId === 222 } };
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
      'edufine-draft',
    );
    const step = {
      id: 'open-draft',
      candidateLabels: ['기안'],
      interaction: 'edufine-left-menu' as const,
      selection: 'first-available' as const,
      postcondition: {
        kind: 'visible-any' as const,
        labels: ['공용서식'],
      },
      maxChecks: 1,
      checkDelayMs: 1,
    };

    const candidates = await workflowPage.inspectCandidates(step);
    expect(candidates).toHaveLength(1);
    await workflowPage.pressCandidate(candidates[0], step);
    await expect(workflowPage.checkPostcondition(step)).resolves.toBe(true);
    await expect(workflowPage.readApprovalCount!('edufine')).resolves.toBe(1);

    expect(commands).toContainEqual({
      method: 'Page.createIsolatedWorld',
      params: expect.objectContaining({ frameId: 'nexacro-frame' }),
      sessionId: 'edufine-session',
    });
    expect(commands).toContainEqual({
      method: 'DOM.getContentQuads',
      params: { objectId: 'draft-menu-node' },
      sessionId: 'edufine-session',
    });
    expect(commands).toContainEqual({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseReleased', x: 360, y: 200, button: 'left', clickCount: 1 },
      sessionId: 'edufine-session',
    });
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
            // The parent can retain the same title as a hidden/breadcrumb label.
            // The workflow must still adopt and remember the actual new page.
            return { result: { value: sessionId === 'leave-session' || sessionId === 'main-session' } };
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
    expect((session as typeof session & {
      workflowResultTargetIds?: { neis?: string };
    }).workflowResultTargetIds?.neis).toBe('leave-form');
    await workflowPage.release?.();
  });

  it('prefers an existing lower NEIS management tab before opening a new request form', async () => {
    const expressions: string[] = [];
    const inputCommands: string[] = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [{
            targetId: 'neis-main',
            type: 'page',
            url: 'https://goe.neis.go.kr/main',
          }] };
        }
        if (method === 'Target.attachToTarget') return { sessionId: 'neis-session' };
        if (method === 'Browser.getWindowForTarget') return { windowId: 20 };
        if (method === 'Input.dispatchMouseEvent') {
          inputCommands.push(String(params.type));
          return {};
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          expressions.push(expression);
          if (expression.includes('loginVisible')) {
            return { result: { value: {
              href: 'https://goe.neis.go.kr/main',
              origin: 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes("[id$='btnUseTimeExtn']")) {
            return { result: { value: { handled: false } } };
          }
          if (expression.includes("'NEIS-MANAGEMENT-TAB'")) {
            return { result: { value: [safeCandidate(0, '개인출장관리')] } };
          }
          if (expression.includes('const interaction="neis-management-tab"')) {
            return { result: { value: { ok: true, x: 420, y: 760 } } };
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
    const workflowPage = await openCdpWindowsWorkflowPage(session as never, 'neis-trip');
    const step = {
      id: 'open-trip-management',
      candidateLabels: ['개인출장관리', '출장관리'],
      interaction: 'neis-management-tab' as const,
      postcondition: { kind: 'active-view-any' as const, labels: ['개인출장관리'] },
      maxChecks: 1,
      checkDelayMs: 1,
    };

    const candidates = await workflowPage.inspectCandidates(step);
    expect(candidates).toHaveLength(1);
    await workflowPage.pressCandidate(candidates[0], step);

    const tabExpressions = expressions.filter((expression) => (
      expression.includes('neis-management-tab') || expression.includes('NEIS-MANAGEMENT-TAB')
    ));
    expect(tabExpressions.some((expression) => expression.includes('worktab|work_tab|mdi|bottom'))).toBe(true);
    expect(tabExpressions.some((expression) => expression.includes("getAttribute?.('aria-selected')"))).toBe(true);
    for (const expression of tabExpressions) {
      expect(() => new Function(`return ${expression}`)).not.toThrow();
    }
    expect(inputCommands).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    await workflowPage.release?.();
  });

  it('reuses only the remembered Stream Panel connection tab after confirming the portal', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    let neisUrl = 'https://goe.neis.go.kr/main';
    let neisMarkerChecks = 0;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            {
              targetId: 'neis-ready',
              type: 'page',
              url: neisUrl,
            },
            {
              targetId: 'portal',
              type: 'page',
              url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do',
            },
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: params.targetId === 'portal' ? 'portal-session' : 'neis-session' };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: 13 };
        if (method === 'Runtime.evaluate' && String(params.expression ?? '').includes('loginVisible')) {
          const portal = sessionId === 'portal-session';
          if (!portal) neisMarkerChecks += 1;
          return { result: { value: {
            href: portal ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do' : neisUrl,
            origin: portal ? 'https://goe.eduptl.kr' : 'https://goe.neis.go.kr',
            readyState: 'complete',
            loginVisible: false,
            neisReady: portal ? false : neisMarkerChecks >= 3,
            marker: portal || neisMarkerChecks < 3 ? 'unready' : 'neis-application-menu',
          } } };
        }
        if (method === 'Page.navigate') neisUrl = String(params.url);
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
      connectionTargetIds: { neis: 'neis-ready' },
      isAlive: () => true,
      close: async () => undefined,
    };

    await connectWindowsOfficeSystems(session as never, ['neis'], undefined, undefined, true);

    expect(commands.some(({ method }) => method === 'Target.closeTarget')).toBe(false);
    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(neisMarkerChecks).toBeGreaterThanOrEqual(3);
    expect(commands).toContainEqual({
      method: 'Target.attachToTarget',
      params: { targetId: 'neis-ready', flatten: true },
    });
    expect(commands).toContainEqual({
      method: 'Target.activateTarget',
      params: { targetId: 'neis-ready' },
    });
  });

  it('keeps one Stream Panel system tab and closes only an owned duplicate', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const closedTargets = new Set<string>();
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'portal', type: 'page', url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do' },
            { targetId: 'neis-primary', type: 'page', url: 'https://goe.neis.go.kr/jsp/main.jsp' },
            { targetId: 'neis-duplicate', type: 'page', url: 'https://goe.neis.go.kr/jsp/main.jsp' },
            { targetId: 'personal-neis', type: 'page', url: 'https://goe.neis.go.kr/personal-work' },
          ].filter(({ targetId }) => !closedTargets.has(targetId)) };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Browser.getWindowForTarget') {
          return { windowId: 17, bounds: { windowState: 'normal' } };
        }
        if (method === 'Target.closeTarget') {
          closedTargets.add(String(params.targetId));
          return { success: true };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes("String(window.name||''")) {
            return { result: { value: sessionId === 'neis-duplicate-session'
              ? 'stream-panel-neis'
              : '' } };
          }
          if (expression.includes('loginVisible')) {
            const portal = sessionId === 'portal-session';
            return { result: { value: {
              href: portal
                ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do'
                : 'https://goe.neis.go.kr/jsp/main.jsp',
              origin: portal ? 'https://goe.eduptl.kr' : 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
              neisReady: !portal,
              marker: portal ? 'unready' : 'neis-application-menu',
            } } };
          }
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      connectionTargetIds: { neis: 'neis-primary' },
      systemTargetIds: { neis: 'neis-primary' },
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      isAlive: () => true,
      close: async () => undefined,
    };

    await connectWindowsOfficeSystems(session as never, ['neis'], undefined, undefined, true);

    expect([...closedTargets]).toEqual(['neis-duplicate']);
    expect(commands.some(({ method, params }) => (
      method === 'Target.closeTarget' && params.targetId === 'personal-neis'
    ))).toBe(false);
    expect((session as typeof session & {
      connectionTargetIds: { neis: string };
    }).connectionTargetIds.neis).toBe('neis-primary');
  });

  it('recovers a first-pass connection miss in the same Connect click', async () => {
    const reports: Array<{ system: string; state: string }> = [];
    let systemOpened = false;
    let aliveChecks = 0;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'portal', type: 'page', url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do' },
            ...(systemOpened
              ? [{ targetId: 'neis', type: 'page', url: 'https://goe.neis.go.kr/jsp/main.jsp' }]
              : []),
          ] };
        }
        if (method === 'Target.createTarget') {
          systemOpened = true;
          return { targetId: 'neis' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: params.targetId === 'portal' ? 'portal-session' : 'neis-session' };
        }
        if (method === 'Browser.getWindowForTarget') {
          return { windowId: 17, bounds: { windowState: 'normal' } };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('const ssoLabels=')) {
            return { result: { value: { clicked: true, count: 1, x: 120, y: 80 } } };
          }
          if (expression.includes('loginVisible')) {
            const portal = sessionId === 'portal-session';
            return { result: { value: {
              href: portal
                ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do'
                : 'https://goe.neis.go.kr/jsp/main.jsp',
              origin: portal ? 'https://goe.eduptl.kr' : 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
              neisReady: !portal,
              marker: portal ? 'unready' : 'neis-application-menu',
            } } };
          }
        }
        if (
          method === 'Input.dispatchMouseEvent' &&
          sessionId === 'portal-session' &&
          params.type === 'mouseReleased'
        ) systemOpened = true;
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
      // The third readiness check simulates the short document replacement
      // that used to make the first portal pass miss an otherwise valid tab.
      isAlive: () => {
        aliveChecks += 1;
        return aliveChecks !== 3;
      },
      close: async () => undefined,
    };

    await connectWindowsOfficeSystems(
      session as never,
      ['neis'],
      ({ system, state }) => reports.push({ system, state }),
      undefined,
      true,
    );

    expect(reports.at(-1)).toEqual({ system: 'neis', state: 'connected' });
    expect(reports.filter(({ system, state }) => (
      system === 'neis' && state === 'connected'
    ))).toHaveLength(1);
  });

  it('does not adopt an unrelated authenticated system tab as the Stream Panel connection tab', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    let connectionOpened = false;
    let connectionUrl = 'https://goe.neis.go.kr/main';
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'personal-neis', type: 'page', url: 'https://goe.neis.go.kr/personal-work' },
            { targetId: 'portal', type: 'page', url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do' },
            ...(connectionOpened
              ? [{ targetId: 'stream-neis', type: 'page', url: connectionUrl, openerId: 'portal' }]
              : []),
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: 23 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes("String(window.name||''")) {
            return { result: { value: '' } };
          }
          if (expression.includes('const ssoLabels=')) {
            connectionOpened = true;
            return { result: { value: { clicked: true, count: 1, x: 120, y: 80 } } };
          }
          if (expression.includes('loginVisible')) {
            const portal = sessionId === 'portal-session';
            const personal = sessionId === 'personal-neis-session';
            const href = portal
              ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do'
              : personal
                ? 'https://goe.neis.go.kr/personal-work'
                : connectionUrl;
            return { result: { value: {
              href,
              origin: portal ? 'https://goe.eduptl.kr' : 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
        }
        if (method === 'Page.navigate' && sessionId === 'stream-neis-session') {
          connectionUrl = String(params.url);
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

    await connectWindowsOfficeSystems(session as never, ['neis'], undefined, undefined, true);

    expect(connectionOpened).toBe(true);
    expect((session as typeof session & {
      connectionTargetIds?: { neis?: string };
    }).connectionTargetIds?.neis).toBe('stream-neis');
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(commands.some(({ method, sessionId }) => (
      method === 'Page.navigate' && sessionId === 'personal-neis-session'
    ))).toBe(false);
  });

  it('opens the logged-in portal SSO tabs in NEIS then K-Edufine order', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const reports: Array<{ system: string; state: string }> = [];
    const diagnostics: Array<{
      system?: string;
      stepId: string;
      outcome: string;
      currentUrl?: string;
    }> = [];
    const ssoExpressions: string[] = [];
    let neisOpened = false;
    let edufineOpened = false;
    let neisUrl = 'https://goe.neis.go.kr/main';
    let edufineUrl = 'https://klef.goe.go.kr/main';
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'portal', type: 'page', url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do' },
            ...(neisOpened
              ? [{ targetId: 'neis', type: 'page', url: neisUrl, openerId: 'portal' }]
              : []),
            ...(edufineOpened
              ? [{ targetId: 'edufine', type: 'page', url: edufineUrl, openerId: 'portal' }]
              : []),
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Browser.getWindowForTarget') {
          return { windowId: 17, bounds: { windowState: 'normal' } };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('const ssoLabels=')) {
            ssoExpressions.push(expression);
            if (expression.includes('const ssoLabels=["K-에듀파인"')) edufineOpened = true;
            else neisOpened = true;
            return { result: { value: { clicked: true, count: 1, x: 120, y: 80 } } };
          }
          if (expression.includes('loginVisible')) {
            const portal = sessionId === 'portal-session';
            const edufine = sessionId === 'edufine-session';
            return { result: { value: {
              href: portal
                ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do'
                : edufine
                  ? edufineUrl
                  : neisUrl,
              origin: portal
                ? 'https://goe.eduptl.kr'
                : edufine
                  ? 'https://klef.goe.go.kr'
                  : 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
              neisReady: !portal && !edufine,
              edufineReady: !portal && edufine,
              marker: portal
                ? 'unready'
                : edufine
                  ? 'edufine-job-list'
                  : 'neis-application-menu',
              selectedJob: edufine ? '업무관리' : '',
              jobNames: edufine ? ['업무관리', '학교회계'] : [],
            } } };
          }
        }
        if (method === 'Page.navigate' && sessionId === 'neis-session') {
          neisUrl = String(params.url);
        }
        if (method === 'Page.navigate' && sessionId === 'edufine-session') {
          edufineUrl = String(params.url);
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

    await connectWindowsOfficeSystems(
      session as never,
      ['edufine', 'neis'],
      ({ system, state }) => reports.push({ system, state }),
      undefined,
      true,
      (event) => { diagnostics.push(event); },
    );

    expect(ssoExpressions).toHaveLength(2);
    expect(ssoExpressions.every((expression) => (
      expression.includes("querySelectorAll('iframe,frame')") &&
      expression.includes("[onclick]") &&
      expression.includes('input[type="image"]') &&
      expression.includes('topContainerSelector') &&
      expression.includes("setAttribute?.('target',tabName)") &&
      expression.includes('original.call(this,url,tabName)')
    ))).toBe(true);
    expect(ssoExpressions[0]).toContain('const tabName="stream-panel-neis"');
    expect(ssoExpressions[1]).toContain('const tabName="stream-panel-edufine"');
    for (const expression of ssoExpressions) {
      expect(() => new Function(`return ${expression}`)).not.toThrow();
    }
    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(reports.filter(({ state }) => state === 'connected')).toEqual([
      { system: 'neis', state: 'connected' },
      { system: 'edufine', state: 'connected' },
    ]);
    expect(commands.filter(({ method }) => method === 'Target.activateTarget').at(-1)).toEqual({
      method: 'Target.activateTarget',
      params: { targetId: 'edufine' },
      sessionId: undefined,
    });
    expect(diagnostics.filter(({ stepId }) => stepId === 'connection-portal-target')).toEqual([
      expect.objectContaining({ stepId: 'connection-portal-target', outcome: 'success' }),
    ]);
    for (const system of ['neis', 'edufine']) {
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ system, stepId: 'connection-sso-click', outcome: 'success' }),
        expect.objectContaining({ system, stepId: 'connection-target-detected', outcome: 'success' }),
        expect.objectContaining({ system, stepId: 'connection-authenticated', outcome: 'success' }),
      ]));
    }
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        system: 'edufine',
        stepId: 'connection-authenticated',
        screenMarker: 'edufine-job-list',
        selectedJob: '업무관리',
        jobNames: ['업무관리', '학교회계'],
      }),
    ]));
    expect(diagnostics.filter(({ stepId }) => stepId === 'connection-target-detected')).toEqual([
      expect.objectContaining({ system: 'neis', currentUrl: expect.stringContaining('goe.neis.go.kr') }),
      expect.objectContaining({ system: 'edufine', currentUrl: expect.stringContaining('klef.goe.go.kr') }),
    ]);
  });

  it('selects the authenticated portal main tab instead of an older login tab', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const reports: Array<{ system: string; state: string }> = [];
    let neisOpened = false;
    let neisUrl = 'https://goe.neis.go.kr/main';
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'portal-login', type: 'page', url: 'https://goe.eduptl.kr/login.do' },
            { targetId: 'portal-main', type: 'page', url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do' },
            ...(neisOpened
              ? [{ targetId: 'neis', type: 'page', url: neisUrl }]
              : []),
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: 31 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('const ssoLabels=')) {
            return { result: { value: sessionId === 'portal-main-session'
              ? { clicked: true, count: 1, x: 150, y: 90 }
              : { clicked: false, count: 0 } } };
          }
          if (expression.includes('loginVisible')) {
            const login = sessionId === 'portal-login-session';
            const main = sessionId === 'portal-main-session';
            return { result: { value: {
              href: login
                ? 'https://goe.eduptl.kr/login.do'
                : main
                  ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do'
                  : neisUrl,
              origin: main || login ? 'https://goe.eduptl.kr' : 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: login,
            } } };
          }
        }
        if (
          method === 'Input.dispatchMouseEvent' &&
          sessionId === 'portal-main-session' &&
          params.type === 'mouseReleased'
        ) neisOpened = true;
        if (method === 'Page.navigate' && sessionId === 'neis-session') {
          neisUrl = String(params.url);
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

    await connectWindowsOfficeSystems(
      session as never,
      ['neis'],
      ({ system, state }) => reports.push({ system, state }),
      undefined,
      true,
    );

    expect(reports.at(-1)).toEqual({ system: 'neis', state: 'connected' });
    expect(commands.some(({ method, sessionId }) => (
      method === 'Input.dispatchMouseEvent' && sessionId === 'portal-login-session'
    ))).toBe(false);
    expect(commands).toContainEqual({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseReleased', x: 150, y: 90, button: 'left', clickCount: 1 },
      sessionId: 'portal-main-session',
    });
  });

  it('finds a portal SSO item inside a cross-origin child frame before opening the system', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const reports: Array<{ system: string; state: string }> = [];
    let neisOpened = false;
    let neisUrl = 'https://goe.neis.go.kr/main';
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'portal', type: 'page', url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do' },
            ...(neisOpened
              ? [{ targetId: 'neis', type: 'page', url: neisUrl }]
              : []),
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Browser.getWindowForTarget') {
          return { windowId: 21, bounds: { windowState: 'normal' } };
        }
        if (method === 'Page.getFrameTree') {
          return {
            frameTree: {
              frame: { id: 'main-frame' },
              childFrames: [{ frame: { id: 'external-sso-frame' } }],
            },
          };
        }
        if (method === 'Page.createIsolatedWorld') {
          return {
            executionContextId: params.frameId === 'external-sso-frame' ? 202 : 101,
          };
        }
        if (method === 'DOM.getContentQuads') {
          return { quads: [[40, 30, 160, 30, 160, 90, 40, 90]] };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('loginVisible')) {
            const portal = sessionId === 'portal-session';
            return { result: { value: {
              href: portal
                ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do'
                : neisUrl,
              origin: portal ? 'https://goe.eduptl.kr' : 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
          }
          if (expression.includes('const ssoLabels=')) {
            if (params.contextId === 202) {
              return { result: { objectId: 'cross-frame-sso-node', subtype: 'node' } };
            }
            if (params.returnByValue === false) {
              return { result: { value: null, subtype: 'null' } };
            }
            return { result: { value: { clicked: false, count: 0 } } };
          }
        }
        if (
          method === 'Input.dispatchMouseEvent' &&
          sessionId === 'portal-session' &&
          params.type === 'mouseReleased'
        ) neisOpened = true;
        if (method === 'Page.navigate' && sessionId === 'neis-session') {
          neisUrl = String(params.url);
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

    await connectWindowsOfficeSystems(
      session as never,
      ['neis'],
      ({ system, state }) => reports.push({ system, state }),
      undefined,
      true,
    );

    expect(commands).toContainEqual({
      method: 'Page.createIsolatedWorld',
      params: expect.objectContaining({ frameId: 'external-sso-frame' }),
      sessionId: 'portal-session',
    });
    expect(commands).toContainEqual({
      method: 'DOM.getContentQuads',
      params: { objectId: 'cross-frame-sso-node' },
      sessionId: 'portal-session',
    });
    expect(commands).toContainEqual({
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mouseReleased', x: 100, y: 60, button: 'left', clickCount: 1 },
      sessionId: 'portal-session',
    });
    expect(reports.at(-1)).toEqual({ system: 'neis', state: 'connected' });
  });

  it('recovers an expired NEIS tab through the logged-in portal before running a workflow', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    let authenticated = false;
    let neisUrl = 'https://goe.neis.go.kr/login';
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            { targetId: 'neis', type: 'page', url: neisUrl },
            { targetId: 'portal', type: 'page', url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do' },
          ] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: 19 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('const ssoLabels=')) {
            return { result: { value: { clicked: true, count: 1, x: 130, y: 75 } } };
          }
          if (expression.includes('loginVisible')) {
            const portal = sessionId === 'portal-session';
            return { result: { value: {
              href: portal
                ? 'https://goe.eduptl.kr/bpm_man_mn00_001.do'
                : authenticated
                  ? neisUrl
                  : 'https://goe.neis.go.kr/login',
              origin: portal ? 'https://goe.eduptl.kr' : 'https://goe.neis.go.kr',
              readyState: 'complete',
              loginVisible: !portal && !authenticated,
            } } };
          }
        }
        if (
          method === 'Input.dispatchMouseEvent' &&
          sessionId === 'portal-session' &&
          params.type === 'mouseReleased'
        ) authenticated = true;
        if (method === 'Page.navigate' && sessionId === 'neis-session') {
          neisUrl = String(params.url);
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
      connectionTargetIds: { neis: 'neis' },
      workflowState: 'IDLE' as const,
      isAlive: () => true,
      close: async () => undefined,
    };

    const workflowPage = await openCdpWindowsWorkflowPage(session as never, 'neis-leave');

    expect(authenticated).toBe(true);
    expect(commands.filter(({ method, sessionId }) => (
      method === 'Input.dispatchMouseEvent' && sessionId === 'portal-session'
    ))).toHaveLength(3);
    expect(commands).toContainEqual({
      method: 'Page.navigate',
      params: { url: 'https://goe.neis.go.kr/jsp/main.jsp' },
      sessionId: 'neis-session',
    });
    await workflowPage.release?.();
  });

  it('falls back to the configured system link when the portal SSO button cannot be inspected', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const reports: Array<{ system: string; state: string; message?: string }> = [];
    let directOpened = false;
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') {
          return { targetInfos: [
            {
              targetId: 'portal',
              type: 'page',
              url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do',
            },
            ...(directOpened ? [{
              targetId: 'direct-neis',
              type: 'page',
              url: 'https://goe.neis.go.kr/jsp/main.jsp',
            }] : []),
          ] };
        }
        if (method === 'Target.createTarget') {
          directOpened = true;
          return { targetId: 'direct-neis' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: params.targetId === 'portal' ? 'portal-session' : 'direct-neis-session' };
        }
        if (method === 'Browser.getWindowForTarget') return { windowId: 17 };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('const ssoLabels=')) {
            throw new Error('portal menu unavailable');
          }
          if (expression.includes('loginVisible')) {
            const direct = sessionId === 'direct-neis-session';
            return { result: { value: {
              href: direct
                ? 'https://goe.neis.go.kr/jsp/main.jsp'
                : 'https://goe.eduptl.kr/bpm_man_mn00_001.do',
              origin: direct ? 'https://goe.neis.go.kr' : 'https://goe.eduptl.kr',
              readyState: 'complete',
              loginVisible: false,
            } } };
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

    await connectWindowsOfficeSystems(
      session as never,
      ['neis'],
      (status) => reports.push(status),
      undefined,
      true,
    );

    expect(commands).toContainEqual({
      method: 'Target.createTarget',
      params: { url: 'https://goe.neis.go.kr/jsp/main.jsp' },
      sessionId: undefined,
    });
    expect(reports.at(-1)).toMatchObject({
      system: 'neis',
      state: 'connected',
    });
  });

  it('prepares NEIS and K-Edufine independently even when NEIS needs login', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const reports: Array<{ system: string; state: string }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') return { targetInfos: [] };
        if (method === 'Target.createTarget') {
          return { targetId: String(params.url).includes('klef.') ? 'edufine-direct' : 'neis-direct' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: params.targetId === 'edufine-direct' ? 'edufine-session' : 'neis-session' };
        }
        if (method === 'Runtime.evaluate' && String(params.expression ?? '').includes('loginVisible')) {
          const edufine = sessionId === 'edufine-session';
          return { result: { value: {
            href: edufine ? 'https://klef.goe.go.kr/main' : 'https://goe.neis.go.kr/login',
            origin: edufine ? 'https://klef.goe.go.kr' : 'https://goe.neis.go.kr',
            readyState: 'complete',
            loginVisible: !edufine,
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

    await connectWindowsOfficeSystems(
      session as never,
      ['neis', 'edufine'],
      ({ system, state }) => reports.push({ system, state }),
    );

    expect(commands).toContainEqual({
      method: 'Target.createTarget',
      params: { url: 'https://goe.neis.go.kr/jsp/main.jsp', background: true },
      sessionId: undefined,
    });
    expect(commands).toContainEqual({
      method: 'Target.createTarget',
      params: { url: 'https://klef.goe.go.kr/', background: true },
      sessionId: undefined,
    });
    expect(commands.some(({ method, params }) => (
      method === 'Target.createTarget' && String(params.url).includes('eduptl')
    ))).toBe(false);
    expect(reports.map(({ system, state }) => `${system}:${state}`)).toEqual([
      'neis:connecting',
      'neis:login-required',
      'edufine:connecting',
      'edufine:connected',
    ]);
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

  it('falls back from the left draft launcher to the scoped document menu route', async () => {
    const pressed: string[] = [];
    const focused: number[] = [];
    let windowChecks = 0;
    const workflowPage = page('https://klef.goe.go.kr');
    workflowPage.inspectCandidates = async (step) => (
      step.id === 'open-left-draft-menu'
        ? []
        : [safeCandidate(0, step.candidateLabels[0])]
    );
    workflowPage.pressCandidate = async (_candidate, step) => {
      pressed.push(step.id);
    };

    await expect(executeWindowsWorkflow(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { officeCode: 'goe', browserId: 'edge', workflowId: 'edufine-draft' },
      {
        openWorkflowPage: async () => workflowPage,
        isWxsClientRegistered: async () => true,
        listWxsClientWindows: async () => {
          windowChecks += 1;
          return windowChecks === 1
            ? []
            : [{ id: 41, title: '표준서식(결재4인,협조4인)', handle: 410 }];
        },
        focusWindow: async (id) => { focused.push(id); return true; },
      },
    )).resolves.toMatchObject({ finalState: 'standard-form-editor' });

    expect(pressed).toEqual([
      'select-business-management-job',
      'select-business-management-job',
      'open-public-forms',
      'open-standard-form',
    ]);
    expect(focused).toEqual([41]);
  });

  it('keeps the previous Edufine draft editor while opening and focusing a new one', async () => {
    let windows = [{ id: 30, title: '기존 표준서식', handle: 300 }];
    const closed: number[] = [];
    const focused: number[] = [];
    const workflowPage = page('https://klef.goe.go.kr');
    workflowPage.pressCandidate = async (_candidate, step) => {
      if (step.id === 'open-standard-form') {
        windows = [...windows, { id: 31, title: '새 표준서식', handle: 310 }];
      }
    };

    await expect(executeWindowsWorkflow(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { officeCode: 'goe', browserId: 'edge', workflowId: 'edufine-draft' },
      {
        openWorkflowPage: async () => workflowPage,
        isWxsClientRegistered: async () => true,
        listWxsClientWindows: async () => windows,
        closeWxsClientWindow: async (id) => {
          closed.push(id);
          windows = windows.filter((window) => window.id !== id);
          return true;
        },
        focusWindow: async (id) => { focused.push(id); return true; },
      },
    )).resolves.toMatchObject({ finalState: 'standard-form-editor' });

    expect(closed).toEqual([]);
    expect(windows.map(({ id }) => id)).toEqual([30, 31]);
    expect(focused).toEqual([31]);
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
