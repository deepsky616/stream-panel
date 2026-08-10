import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createDefaultConfig } from '../src/shared/defaults';
import type { AppConfig } from '../src/shared/types';
import { recoverConfigText } from '../src/main/store';
import { validateAppConfig } from '../src/main/security/validate';
import {
  createApprovalMonitorService,
  isWithinApprovalWorkHours,
  shouldSendApprovalNotification,
} from '../src/main/services/approvalMonitor';
import * as approvalMonitorModule from '../src/main/services/approvalMonitor';
import { createMacosApprovalScanner } from '../src/main/services/approvalMonitor/macos';
import { createApprovalCheckCancelledError } from '../src/main/services/approvalMonitor/cancellation';

function windowsConfig(): AppConfig {
  let id = 0;
  return createDefaultConfig(
    { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
    () => `id-${id++}`,
    'win32',
  );
}

const FIXED_WORK_TIME = new Date(2026, 7, 5, 9, 30).getTime();

describe('approval monitor settings', () => {
  it('enables both approval counters by default and restores them for existing configs', () => {
    const defaults = windowsConfig();
    expect(defaults.approvalMonitor).toEqual({
      sources: {
        neis: { enabled: true, browserId: 'edge' },
        edufine: { enabled: true, browserId: 'edge' },
      },
      intervalMinutes: 10,
      notifyOnlyOnIncrease: true,
      workHours: { enabled: true, start: '08:00', end: '18:00' },
    });

    const legacy = structuredClone(defaults) as unknown as Record<string, unknown>;
    delete legacy.approvalMonitor;
    const recovered = recoverConfigText(JSON.stringify(legacy), defaults);
    expect(recovered.config.approvalMonitor).toEqual(defaults.approvalMonitor);
  });

  it('accepts only fixed intervals, known browsers, and valid local work times', () => {
    const valid = windowsConfig();
    valid.approvalMonitor.sources.neis.enabled = true;
    expect(() => validateAppConfig(valid)).not.toThrow();

    const invalidInterval = structuredClone(valid);
    invalidInterval.approvalMonitor.intervalMinutes = 11 as 10;
    expect(() => validateAppConfig(invalidInterval)).toThrow(/확인 주기/);

    const invalidBrowser = structuredClone(valid);
    invalidBrowser.approvalMonitor.sources.edufine.browserId = 'whale' as 'edge';
    expect(() => validateAppConfig(invalidBrowser)).toThrow(/브라우저/);

    const invalidTime = structuredClone(valid);
    invalidTime.approvalMonitor.workHours.start = '25:00';
    expect(() => validateAppConfig(invalidTime)).toThrow(/근무 시간/);
  });

  it('repairs invalid persisted monitor fields before scheduling starts', () => {
    const defaults = windowsConfig();
    const damaged = structuredClone(defaults);
    damaged.approvalMonitor.intervalMinutes = 0 as 10;
    damaged.approvalMonitor.sources.neis.browserId = 'other' as 'edge';
    damaged.approvalMonitor.workHours.start = 'invalid';

    const recovered = recoverConfigText(JSON.stringify(damaged), defaults);

    expect(recovered.config.approvalMonitor.intervalMinutes).toBe(10);
    expect(recovered.config.approvalMonitor.sources.neis.browserId).toBe('edge');
    expect(recovered.config.approvalMonitor.workHours.start).toBe('08:00');
  });
});

describe('approval monitor rules', () => {
  it('writes the monitor state through a same-folder temporary file and reports read errors', async () => {
    const createApprovalMonitorStateIo = (
      approvalMonitorModule as unknown as {
        createApprovalMonitorStateIo?: (
          userDataPath: string,
          fileSystem: {
            readFile(path: string, encoding: 'utf8'): Promise<string>;
            mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
            writeFile(
              path: string,
              text: string,
              options: { encoding: 'utf8'; mode: number },
            ): Promise<void>;
            rename(from: string, to: string): Promise<void>;
          },
        ) => {
          read(): Promise<string | undefined>;
          write(text: string): Promise<void>;
        };
      }
    ).createApprovalMonitorStateIo;
    expect(createApprovalMonitorStateIo).toBeTypeOf('function');
    const operations: string[] = [];
    const io = createApprovalMonitorStateIo!('/data', {
      readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      mkdir: async (path) => { operations.push(`mkdir:${path}`); },
      writeFile: async (path) => { operations.push(`write:${path}`); },
      rename: async (from, to) => { operations.push(`rename:${from}->${to}`); },
    });

    await expect(io.read()).resolves.toBeUndefined();
    await io.write('{"version":1}');
    expect(operations).toEqual([
      `mkdir:${join('/data', 'approval-monitor')}`,
      `write:${join('/data', 'approval-monitor', 'state.json.tmp')}`,
      `rename:${join('/data', 'approval-monitor', 'state.json.tmp')}->${join('/data', 'approval-monitor', 'state.json')}`,
    ]);

    const unreadable = createApprovalMonitorStateIo!('/data', {
      readFile: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      rename: async () => undefined,
    });
    await expect(unreadable.read()).rejects.toThrow(/읽지 못했습니다.*권한/);
  });

  it('returns a safe empty result from the macOS platform adapter', async () => {
    await expect(createMacosApprovalScanner().scan({
      system: 'neis',
      officeCode: 'goe',
      browserId: 'edge',
    })).resolves.toBe(0);
  });

  it('checks normal and overnight local work-hour windows', () => {
    expect(isWithinApprovalWorkHours(new Date(2026, 7, 5, 9, 30), {
      enabled: true,
      start: '08:00',
      end: '18:00',
    })).toBe(true);
    expect(isWithinApprovalWorkHours(new Date(2026, 7, 5, 20, 0), {
      enabled: true,
      start: '08:00',
      end: '18:00',
    })).toBe(false);
    expect(isWithinApprovalWorkHours(new Date(2026, 7, 5, 23, 0), {
      enabled: true,
      start: '22:00',
      end: '06:00',
    })).toBe(true);
    expect(isWithinApprovalWorkHours(new Date(2026, 7, 5, 12, 0), {
      enabled: false,
      start: '08:00',
      end: '18:00',
    })).toBe(true);
  });

  it('does not notify on the first read and notifies only for a positive increase by default', () => {
    expect(shouldSendApprovalNotification(undefined, 3, true)).toBe(false);
    expect(shouldSendApprovalNotification(3, 3, true)).toBe(false);
    expect(shouldSendApprovalNotification(3, 2, true)).toBe(false);
    expect(shouldSendApprovalNotification(3, 4, true)).toBe(true);
    expect(shouldSendApprovalNotification(3, 3, false)).toBe(true);
    expect(shouldSendApprovalNotification(3, 0, false)).toBe(false);
  });
});

describe('approval monitor service', () => {
  it('returns to the previous state instead of showing an error when a key preempts a scan', async () => {
    const config = windowsConfig();
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: { scan: async () => { throw createApprovalCheckCancelledError(); } },
      stateIo: { read: async () => undefined, write: async () => undefined },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    await service.start();

    await expect(service.check({ system: 'neis' })).resolves.toEqual(
      expect.arrayContaining([{ system: 'neis', state: 'idle' }]),
    );
  });

  it('shows a recoverable error for a corrupt state file instead of silently resetting it', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: { scan: async () => 3 },
      stateIo: { read: async () => '{broken', write: async () => undefined },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });

    await service.start();
    expect(service.getStatuses()).toContainEqual(expect.objectContaining({
      system: 'neis',
      state: 'error',
      message: expect.stringMatching(/상태 파일.*손상.*지금 확인/),
    }));

    await service.check({ system: 'neis' });
    expect(service.getStatuses()).toContainEqual(expect.objectContaining({
      system: 'neis',
      state: 'ready',
      pendingCount: 3,
    }));
  });

  it('discards version 1 counts that may have come from a page-size control', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.edufine.enabled = true;
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: { scan: async () => 0 },
      stateIo: {
        read: async () => JSON.stringify({
          version: 1,
          systems: {
            edufine: {
              officeCode: 'goe',
              browserId: 'edge',
              pendingCount: 100,
              lastCheckedAt: FIXED_WORK_TIME,
            },
          },
        }),
        write: async () => undefined,
      },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });

    await service.start();

    expect(service.getStatuses()).toContainEqual(
      expect.objectContaining({ system: 'edufine', state: 'idle' }),
    );
    expect(service.getStatuses().find(({ system }) => system === 'edufine')).not.toHaveProperty(
      'pendingCount',
    );
  });

  it('isolates broadcast and notification failures from checks and future scheduling', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    config.approvalMonitor.notifyOnlyOnIncrease = false;
    const timers: Array<{ handler: () => void; delayMs: number }> = [];
    const errors: string[] = [];
    let scans = 0;
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: { scan: async () => { scans += 1; return 2; } },
      stateIo: { read: async () => undefined, write: async () => undefined },
      notify: () => { throw new Error('notification failed'); },
      broadcast: () => { throw new Error('window closed'); },
      onError: (error) => { errors.push(error.message); },
      now: () => FIXED_WORK_TIME,
      setTimer: (handler, delayMs) => {
        const timer = { handler, delayMs };
        timers.push(timer);
        return timer;
      },
      clearTimer: () => undefined,
    });

    await expect(service.start()).resolves.toBeUndefined();
    await service.check({ system: 'neis' });
    await expect(service.check({ system: 'neis' })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ system: 'neis', state: 'ready' })]),
    );

    expect(scans).toBe(2);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/상태.*전달/),
      expect.stringMatching(/알림.*표시/),
    ]));
    expect(timers.length).toBeGreaterThan(1);
  });

  it('uses a safe interval fallback and reschedules even after an unexpected check failure', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    config.approvalMonitor.intervalMinutes = 0 as 10;
    let failConfig = false;
    const timers: Array<{ handler: () => void; delayMs: number }> = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => {
        if (failConfig) throw new Error('config unavailable');
        return config;
      },
      scanner: { scan: async () => 1 },
      stateIo: { read: async () => undefined, write: async () => undefined },
      setTimer: (handler, delayMs) => {
        const timer = { handler, delayMs };
        timers.push(timer);
        return timer;
      },
      clearTimer: () => undefined,
    });
    await service.start();
    expect(timers.at(-1)?.delayMs).toBe(10 * 60_000);

    failConfig = true;
    await expect(service.check({ system: 'neis' })).rejects.toThrow(/config unavailable/);
    failConfig = false;
    expect(timers.length).toBeGreaterThan(1);
    expect(timers.at(-1)?.delayMs).toBe(10 * 60_000);
  });

  it('does not publish or notify after stopping while a scan is in flight', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    let scanNumber = 0;
    let releaseScan!: (count: number) => void;
    const pendingScan = new Promise<number>((resolve) => { releaseScan = resolve; });
    const notifications: number[] = [];
    const broadcasts: unknown[] = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: {
        scan: async () => {
          scanNumber += 1;
          return scanNumber === 1 ? 1 : pendingScan;
        },
      },
      stateIo: { read: async () => undefined, write: async () => undefined },
      notify: (_system, count) => { notifications.push(count); },
      broadcast: (statuses) => { broadcasts.push(statuses); },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    await service.start();
    await service.check({ system: 'neis' });

    const check = service.check({ system: 'neis' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const broadcastsBeforeStop = broadcasts.length;
    const stop = service.stop();
    releaseScan(2);
    await Promise.all([check, stop]);

    expect(notifications).toEqual([]);
    expect(broadcasts).toHaveLength(broadcastsBeforeStop);
  });

  it('keeps the previous baseline when saving a new count fails', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    const counts = [2, 4, 4];
    let writes = 0;
    const notifications: number[] = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: { scan: async () => counts.shift() ?? 0 },
      stateIo: {
        read: async () => undefined,
        write: async () => {
          writes += 1;
          if (writes === 2) throw new Error('permission denied');
        },
      },
      notify: (_system, count) => { notifications.push(count); },
      now: () => FIXED_WORK_TIME,
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    await service.start();

    await service.check({ system: 'neis' });
    await service.check({ system: 'neis' });
    expect(service.getStatuses()).toContainEqual(
      expect.objectContaining({ system: 'neis', state: 'error', pendingCount: 2 }),
    );
    await service.check({ system: 'neis' });

    expect(notifications).toEqual([4]);
  });

  it('discards a late scan error after the source settings change', async () => {
    for (const change of ['disable', 'browser', 'office'] as const) {
      const config = windowsConfig();
      config.approvalMonitor.sources.neis.enabled = true;
      let rejectScan!: (error: Error) => void;
      const pendingScan = new Promise<number>((_resolve, reject) => { rejectScan = reject; });
      const service = createApprovalMonitorService({
        platform: 'win32',
        getConfig: () => config,
        scanner: { scan: async () => pendingScan },
        stateIo: { read: async () => undefined, write: async () => undefined },
        setTimer: () => 1,
        clearTimer: () => undefined,
      });
      await service.start();

      const check = service.check({ system: 'neis' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (change === 'disable') config.approvalMonitor.sources.neis.enabled = false;
      if (change === 'browser') config.approvalMonitor.sources.neis.browserId = 'chrome';
      if (change === 'office') config.educationOfficeCode = 'sen';
      service.onConfigChanged(config);
      rejectScan(new Error('old connection failed'));
      await check;

      expect(service.getStatuses()).toContainEqual(
        expect.objectContaining({
          system: 'neis',
          state: change === 'disable' ? 'disabled' : 'idle',
        }),
      );
    }
  });

  it('uses the current notification policy when a delayed scan finishes', async () => {
    for (const scenario of [
      { initialOnlyOnIncrease: false, changedOnlyOnIncrease: true, notifications: [] },
      { initialOnlyOnIncrease: true, changedOnlyOnIncrease: false, notifications: [2] },
    ]) {
      let config = windowsConfig();
      config.approvalMonitor.sources.neis.enabled = true;
      config.approvalMonitor.notifyOnlyOnIncrease = scenario.initialOnlyOnIncrease;
      let scanNumber = 0;
      let releaseScan!: (count: number) => void;
      const pendingScan = new Promise<number>((resolve) => { releaseScan = resolve; });
      const notifications: number[] = [];
      const service = createApprovalMonitorService({
        platform: 'win32',
        getConfig: () => config,
        scanner: {
          scan: async () => {
            scanNumber += 1;
            return scanNumber === 1 ? 2 : pendingScan;
          },
        },
        stateIo: { read: async () => undefined, write: async () => undefined },
        notify: (_system, count) => { notifications.push(count); },
        now: () => FIXED_WORK_TIME,
        setTimer: () => 1,
        clearTimer: () => undefined,
      });
      await service.start();
      await service.check({ system: 'neis' });

      const check = service.check({ system: 'neis' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      config = structuredClone(config);
      config.approvalMonitor.notifyOnlyOnIncrease = scenario.changedOnlyOnIncrease;
      service.onConfigChanged(config);
      releaseScan(2);
      await check;

      expect(notifications).toEqual(scenario.notifications);
    }
  });

  it('does not notify when a delayed scan finishes after configured work hours', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    let currentTime = new Date(2026, 7, 5, 9, 0).getTime();
    let scanNumber = 0;
    let releaseScan!: (count: number) => void;
    const pendingScan = new Promise<number>((resolve) => { releaseScan = resolve; });
    const notifications: number[] = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: {
        scan: async () => {
          scanNumber += 1;
          return scanNumber === 1 ? 1 : pendingScan;
        },
      },
      stateIo: { read: async () => undefined, write: async () => undefined },
      notify: (_system, count) => { notifications.push(count); },
      now: () => currentTime,
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    await service.start();
    await service.check({ system: 'neis' });

    const check = service.check({ system: 'neis' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    currentTime = new Date(2026, 7, 5, 20, 0).getTime();
    releaseScan(2);
    await check;

    expect(notifications).toEqual([]);
    expect(service.getStatuses()).toContainEqual(
      expect.objectContaining({ system: 'neis', pendingCount: 2 }),
    );
  });

  it('coalesces overlapping checks for the same system into one scan', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    let scans = 0;
    let releaseScan!: (count: number) => void;
    const pendingScan = new Promise<number>((resolve) => { releaseScan = resolve; });
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: {
        scan: async () => {
          scans += 1;
          return pendingScan;
        },
      },
      stateIo: { read: async () => undefined, write: async () => undefined },
      setTimer: () => 1,
      clearTimer: () => undefined,
    });
    await service.start();
    expect(service.getStatuses()).toContainEqual(
      expect.objectContaining({ system: 'neis', state: 'idle' }),
    );

    const first = service.check({ system: 'neis' });
    const second = service.check({ system: 'neis' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(scans).toBe(1);
    releaseScan(3);
    await Promise.all([first, second]);

    expect(scans).toBe(1);
    expect(service.getStatuses()).toContainEqual(
      expect.objectContaining({ system: 'neis', pendingCount: 3 }),
    );
  });

  it('uses the first read after restart or a browser change as a fresh baseline', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    const counts = [5, 6, 9, 10];
    const notifications: number[] = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: { scan: async () => counts.shift() ?? 0 },
      stateIo: {
        read: async () => JSON.stringify({
          version: 2,
          systems: {
            neis: {
              officeCode: 'goe',
              browserId: 'edge',
              pendingCount: 2,
              lastCheckedAt: 1_799_000_000_000,
              lastNotifiedCount: 2,
            },
          },
        }),
        write: async () => undefined,
      },
      notify: (_system, count) => { notifications.push(count); },
      now: () => FIXED_WORK_TIME,
      setTimer: (handler) => handler,
      clearTimer: () => undefined,
    });
    await service.start();

    await service.check({ system: 'neis' });
    expect(notifications).toEqual([]);
    await service.check({ system: 'neis' });
    expect(notifications).toEqual([6]);

    config.approvalMonitor.sources.neis.browserId = 'chrome';
    service.onConfigChanged(config);
    expect(service.getStatuses()).toContainEqual(
      expect.objectContaining({ system: 'neis', state: 'idle' }),
    );
    await service.check({ system: 'neis' });
    expect(notifications).toEqual([6]);
    await service.check({ system: 'neis' });
    expect(notifications).toEqual([6, 10]);
  });

  it('discards an old browser result that finishes after the connection changes', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    let releaseOldScan!: (count: number) => void;
    const oldScan = new Promise<number>((resolve) => { releaseOldScan = resolve; });
    let scanNumber = 0;
    const notifications: number[] = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: {
        scan: async () => {
          scanNumber += 1;
          if (scanNumber === 1) return 1;
          if (scanNumber === 2) return oldScan;
          return scanNumber === 3 ? 8 : 9;
        },
      },
      stateIo: { read: async () => undefined, write: async () => undefined },
      notify: (_system, count) => { notifications.push(count); },
      now: () => FIXED_WORK_TIME,
      setTimer: (handler) => handler,
      clearTimer: () => undefined,
    });
    await service.start();
    await service.check({ system: 'neis' });

    const staleCheck = service.check({ system: 'neis' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    config.approvalMonitor.sources.neis.browserId = 'chrome';
    service.onConfigChanged(config);
    releaseOldScan(7);
    await staleCheck;

    await service.check({ system: 'neis' });
    expect(notifications).toEqual([]);
    await service.check({ system: 'neis' });
    expect(notifications).toEqual([9]);
  });

  it('checks only enabled systems, broadcasts counts, and persists counts without document data', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    config.approvalMonitor.sources.edufine.enabled = false;
    const counts = [2, 4, 4];
    const scans: unknown[] = [];
    const notifications: unknown[] = [];
    const broadcasts: unknown[] = [];
    const writes: string[] = [];
    const timers: Array<() => void> = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: {
        async scan(input) {
          scans.push(input);
          return counts.shift() ?? 0;
        },
      },
      stateIo: {
        read: async () => undefined,
        write: async (text) => { writes.push(text); },
      },
      notify: (system, count) => { notifications.push({ system, count }); },
      broadcast: (statuses) => { broadcasts.push(statuses); },
      now: () => FIXED_WORK_TIME,
      setTimer: (handler) => { timers.push(handler); return handler; },
      clearTimer: () => undefined,
    });

    await service.start();
    await service.check({ system: 'neis' });
    expect(notifications).toEqual([]);
    expect(service.getStatuses()).toEqual([
      expect.objectContaining({ system: 'neis', state: 'ready', pendingCount: 2 }),
      expect.objectContaining({ system: 'edufine', state: 'disabled' }),
    ]);

    await service.check({ system: 'neis' });
    await service.check({ system: 'neis' }, { interactive: true });
    expect(scans).toEqual([
      { system: 'neis', browserId: 'edge', officeCode: 'goe' },
      { system: 'neis', browserId: 'edge', officeCode: 'goe' },
      { system: 'neis', browserId: 'edge', officeCode: 'goe', interactive: true },
    ]);
    expect(notifications).toEqual([{ system: 'neis', count: 4 }]);
    expect(broadcasts.length).toBeGreaterThan(1);
    expect(timers.length).toBeGreaterThan(0);
    expect(JSON.parse(writes.at(-1)!)).toEqual({
      version: 2,
      systems: {
        neis: {
          officeCode: 'goe',
          browserId: 'edge',
          pendingCount: 4,
          lastCheckedAt: FIXED_WORK_TIME,
          lastNotifiedCount: 4,
        },
      },
    });
    expect(writes.at(-1)).not.toMatch(/title|author|body|cookie|token|password/i);
    await service.stop();
  });

  it('never scans or schedules browser work on macOS', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    let scans = 0;
    let timers = 0;
    const service = createApprovalMonitorService({
      platform: 'darwin',
      getConfig: () => config,
      scanner: { scan: async () => { scans += 1; return 1; } },
      stateIo: { read: async () => undefined, write: async () => undefined },
      setTimer: () => { timers += 1; return 1; },
      clearTimer: () => undefined,
    });

    await service.start();
    await service.check({ system: 'neis' });

    expect(scans).toBe(0);
    expect(timers).toBe(0);
    expect(service.getStatuses()).toEqual([
      expect.objectContaining({ system: 'neis', state: 'disabled' }),
      expect.objectContaining({ system: 'edufine', state: 'disabled' }),
    ]);
  });

  it('reschedules outside work hours and scans from the shared timer during work hours', async () => {
    const config = windowsConfig();
    config.approvalMonitor.sources.neis.enabled = true;
    config.approvalMonitor.sources.edufine.enabled = false;
    let currentTime = new Date(2026, 7, 5, 20, 0).getTime();
    let scans = 0;
    const timers: Array<{ handler: () => void; delayMs: number }> = [];
    const cleared: unknown[] = [];
    const service = createApprovalMonitorService({
      platform: 'win32',
      getConfig: () => config,
      scanner: { scan: async () => { scans += 1; return 3; } },
      stateIo: { read: async () => undefined, write: async () => undefined },
      now: () => currentTime,
      setTimer: (handler, delayMs) => {
        const timer = { handler, delayMs };
        timers.push(timer);
        return timer;
      },
      clearTimer: (handle) => { cleared.push(handle); },
    });

    await service.start();
    expect(timers.at(-1)?.delayMs).toBe(10 * 60_000);
    timers.at(-1)?.handler();
    expect(scans).toBe(0);
    expect(timers).toHaveLength(2);

    currentTime = new Date(2026, 7, 6, 9, 30).getTime();
    timers.at(-1)?.handler();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(scans).toBe(1);
    expect(service.getStatuses()).toEqual([
      expect.objectContaining({ system: 'neis', state: 'ready', pendingCount: 3 }),
      expect.objectContaining({ system: 'edufine', state: 'disabled' }),
    ]);
    expect(timers.at(-1)?.delayMs).toBe(10 * 60_000);

    await service.stop();
    expect(cleared.length).toBeGreaterThan(0);
  });
});
