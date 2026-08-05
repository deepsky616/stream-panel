import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import type { AppConfig } from '../src/shared/types';
import { recoverConfigText } from '../src/main/store';
import { validateAppConfig } from '../src/main/security/validate';
import {
  createApprovalMonitorService,
  isWithinApprovalWorkHours,
  shouldSendApprovalNotification,
} from '../src/main/services/approvalMonitor';
import { createMacosApprovalScanner } from '../src/main/services/approvalMonitor/macos';

function windowsConfig(): AppConfig {
  let id = 0;
  return createDefaultConfig(
    { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
    () => `id-${id++}`,
    'win32',
  );
}

describe('approval monitor settings', () => {
  it('adds safe disabled defaults and restores them for an existing version-one config', () => {
    const defaults = windowsConfig();
    expect(defaults.approvalMonitor).toEqual({
      sources: {
        neis: { enabled: false, browserId: 'edge' },
        edufine: { enabled: false, browserId: 'edge' },
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
});

describe('approval monitor rules', () => {
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
          version: 1,
          systems: {
            neis: {
              pendingCount: 2,
              lastCheckedAt: 1_799_000_000_000,
              lastNotifiedCount: 2,
            },
          },
        }),
        write: async () => undefined,
      },
      notify: (_system, count) => { notifications.push(count); },
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
    const counts = [2, 4];
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
      now: () => new Date(2026, 7, 5, 9, 30).getTime(),
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
    expect(scans).toEqual([
      { system: 'neis', browserId: 'edge', officeCode: 'goe' },
      { system: 'neis', browserId: 'edge', officeCode: 'goe' },
    ]);
    expect(notifications).toEqual([{ system: 'neis', count: 4 }]);
    expect(broadcasts.length).toBeGreaterThan(1);
    expect(timers.length).toBeGreaterThan(0);
    expect(JSON.parse(writes.at(-1)!)).toEqual({
      version: 1,
      systems: {
        neis: {
          officeCode: 'goe',
          browserId: 'edge',
          pendingCount: 4,
          lastCheckedAt: new Date(2026, 7, 5, 9, 30).getTime(),
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
