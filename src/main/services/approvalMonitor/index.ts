import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AppConfig,
  ApprovalMonitorStatus,
  ApprovalWorkHoursConfig,
  WebWorkflowSystem,
} from '../../../shared/types';
import type { ApprovalScanInput } from './definitions';

const SYSTEMS = ['neis', 'edufine'] as const;

interface PersistedSystemState {
  pendingCount: number;
  lastCheckedAt: number;
  lastNotifiedCount?: number;
}

interface ApprovalMonitorState {
  version: 1;
  systems: Partial<Record<WebWorkflowSystem, PersistedSystemState>>;
}

export interface ApprovalMonitorStateIo {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
}

export interface ApprovalMonitorScanner {
  scan(input: ApprovalScanInput): Promise<number>;
}

export interface ApprovalMonitorService {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatuses(): ApprovalMonitorStatus[];
  check(input: { system?: WebWorkflowSystem }): Promise<ApprovalMonitorStatus[]>;
  onConfigChanged(config: AppConfig): void;
}

export interface CreateApprovalMonitorServiceOptions {
  platform?: NodeJS.Platform;
  userDataPath?: string;
  getConfig: () => AppConfig;
  scanner: ApprovalMonitorScanner;
  stateIo?: ApprovalMonitorStateIo;
  notify?: (system: WebWorkflowSystem, count: number) => void;
  broadcast?: (statuses: ApprovalMonitorStatus[]) => void;
  now?: () => number;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function diskStateIo(userDataPath: string): ApprovalMonitorStateIo {
  const statePath = join(userDataPath, 'approval-monitor', 'state.json');
  return {
    async read() {
      try {
        return await readFile(statePath, 'utf8');
      } catch {
        return undefined;
      }
    },
    async write(text) {
      await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      await writeFile(statePath, text, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

function defaultState(): ApprovalMonitorState {
  return { version: 1, systems: {} };
}

function validPersistedSystem(value: unknown): value is PersistedSystemState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => [
      'pendingCount',
      'lastCheckedAt',
      'lastNotifiedCount',
    ].includes(key)) &&
    Number.isSafeInteger(record.pendingCount) &&
    Number(record.pendingCount) >= 0 &&
    Number(record.pendingCount) <= 9_999 &&
    Number.isSafeInteger(record.lastCheckedAt) &&
    Number(record.lastCheckedAt) >= 0 &&
    (record.lastNotifiedCount === undefined || (
      Number.isSafeInteger(record.lastNotifiedCount) &&
      Number(record.lastNotifiedCount) >= 0 &&
      Number(record.lastNotifiedCount) <= 9_999
    ))
  );
}

function parseState(text: string | undefined): ApprovalMonitorState {
  if (!text) return defaultState();
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultState();
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || !record.systems || typeof record.systems !== 'object') {
      return defaultState();
    }
    const rawSystems = record.systems as Record<string, unknown>;
    const systems: ApprovalMonitorState['systems'] = {};
    for (const system of SYSTEMS) {
      if (validPersistedSystem(rawSystems[system])) {
        systems[system] = { ...rawSystems[system] };
      }
    }
    return { version: 1, systems };
  } catch {
    return defaultState();
  }
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function isWithinApprovalWorkHours(
  date: Date,
  workHours: ApprovalWorkHoursConfig,
): boolean {
  if (!workHours.enabled) return true;
  const current = date.getHours() * 60 + date.getMinutes();
  const start = timeToMinutes(workHours.start);
  const end = timeToMinutes(workHours.end);
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function shouldSendApprovalNotification(
  previousCount: number | undefined,
  currentCount: number,
  onlyOnIncrease: boolean,
): boolean {
  if (previousCount === undefined || currentCount < 1) return false;
  return onlyOnIncrease ? currentCount > previousCount : true;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류';
}

export function createApprovalMonitorService({
  platform = process.platform,
  userDataPath = '',
  getConfig,
  scanner,
  stateIo = diskStateIo(userDataPath),
  notify = () => undefined,
  broadcast = () => undefined,
  now = Date.now,
  setTimer = (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: CreateApprovalMonitorServiceOptions): ApprovalMonitorService {
  let state = defaultState();
  let statuses: ApprovalMonitorStatus[] = [];
  let started = false;
  let timer: unknown = null;
  let tail: Promise<void> = Promise.resolve();
  const inFlightBySystem = new Map<WebWorkflowSystem, Promise<void>>();
  const establishedBaselines = new Set<WebWorkflowSystem>();
  let sourceSignatures = new Map<WebWorkflowSystem, string>();
  const sourceRevisions = new Map<WebWorkflowSystem, number>(
    SYSTEMS.map((system) => [system, 0]),
  );

  const sourceSignature = (config: AppConfig, system: WebWorkflowSystem): string => {
    const source = config.approvalMonitor.sources[system];
    return `${config.educationOfficeCode}:${source.browserId}:${source.enabled}`;
  };

  const createStatuses = (): ApprovalMonitorStatus[] => SYSTEMS.map((system) => {
    const source = getConfig().approvalMonitor.sources[system];
    const persisted = state.systems[system];
    if (platform !== 'win32' || !source.enabled) return { system, state: 'disabled' };
    return {
      system,
      state: persisted ? 'ready' : 'idle',
      ...(persisted ? {
        pendingCount: persisted.pendingCount,
        lastCheckedAt: persisted.lastCheckedAt,
      } : {}),
    };
  });

  const publish = () => {
    broadcast(statuses.map((status) => ({ ...status })));
  };

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const persist = () => stateIo.write(JSON.stringify(state, null, 2));

  const service: ApprovalMonitorService = {
    async start() {
      if (started) return;
      state = parseState(await stateIo.read());
      const config = getConfig();
      sourceSignatures = new Map(
        SYSTEMS.map((system) => [system, sourceSignature(config, system)]),
      );
      started = true;
      statuses = createStatuses();
      publish();
      schedule();
    },
    async stop() {
      started = false;
      cancelTimer();
      await tail;
    },
    getStatuses() {
      return statuses.map((status) => ({ ...status }));
    },
    async check(input) {
      if (!started || platform !== 'win32') return service.getStatuses();
      const selected = input.system ? [input.system] : [...SYSTEMS];
      const runs = selected.map((system) => {
        const inFlight = inFlightBySystem.get(system);
        if (inFlight) return inFlight;
        const operation = async () => {
          const config = getConfig();
          const source = config.approvalMonitor.sources[system];
          if (!source.enabled) return;
          const sourceRevision = sourceRevisions.get(system) ?? 0;
          const index = statuses.findIndex((status) => status.system === system);
          const previous = state.systems[system];
          statuses[index] = {
            system,
            state: 'checking',
            ...(previous ? {
              pendingCount: previous.pendingCount,
              lastCheckedAt: previous.lastCheckedAt,
            } : {}),
          };
          publish();
          try {
            const pendingCount = await scanner.scan({
              system,
              browserId: source.browserId,
              officeCode: config.educationOfficeCode,
            });
            if ((sourceRevisions.get(system) ?? 0) !== sourceRevision) {
              statuses = createStatuses();
              publish();
              return;
            }
            const checkedAt = now();
            const sendNotification = establishedBaselines.has(system) &&
              shouldSendApprovalNotification(
                previous?.pendingCount,
                pendingCount,
                config.approvalMonitor.notifyOnlyOnIncrease,
              );
            state.systems[system] = {
              pendingCount,
              lastCheckedAt: checkedAt,
              ...(sendNotification
                ? { lastNotifiedCount: pendingCount }
                : previous?.lastNotifiedCount === undefined
                  ? {}
                  : { lastNotifiedCount: previous.lastNotifiedCount }),
            };
            await persist();
            if ((sourceRevisions.get(system) ?? 0) !== sourceRevision) {
              if (previous) state.systems[system] = previous;
              else delete state.systems[system];
              await persist();
              statuses = createStatuses();
              publish();
              return;
            }
            statuses[index] = {
              system,
              state: 'ready',
              pendingCount,
              lastCheckedAt: checkedAt,
            };
            establishedBaselines.add(system);
            if (sendNotification) notify(system, pendingCount);
          } catch (error) {
            const message = errorDetail(error);
            statuses[index] = {
              system,
              state: /로그인|인증/.test(message) ? 'login-required' : 'error',
              message,
              ...(previous ? {
                pendingCount: previous.pendingCount,
                lastCheckedAt: previous.lastCheckedAt,
              } : {}),
            };
          }
          publish();
        };
        const run = tail.then(operation, operation);
        tail = run.then(() => undefined, () => undefined);
        const tracked = run.finally(() => {
          if (inFlightBySystem.get(system) === tracked) {
            inFlightBySystem.delete(system);
          }
        });
        inFlightBySystem.set(system, tracked);
        return tracked;
      });
      await Promise.all(runs);
      schedule();
      return service.getStatuses();
    },
    onConfigChanged(config) {
      for (const system of SYSTEMS) {
        const nextSignature = sourceSignature(config, system);
        if (sourceSignatures.get(system) !== nextSignature) {
          establishedBaselines.delete(system);
          sourceRevisions.set(system, (sourceRevisions.get(system) ?? 0) + 1);
        }
        sourceSignatures.set(system, nextSignature);
      }
      statuses = createStatuses();
      publish();
      schedule();
    },
  };

  function schedule(): void {
    cancelTimer();
    if (!started || platform !== 'win32') return;
    const config = getConfig().approvalMonitor;
    if (!SYSTEMS.some((system) => config.sources[system].enabled)) return;
    timer = setTimer(() => {
      timer = null;
      const current = getConfig().approvalMonitor;
      if (isWithinApprovalWorkHours(new Date(now()), current.workHours)) {
        void service.check({});
      } else {
        schedule();
      }
    }, config.intervalMinutes * 60_000);
  }

  statuses = createStatuses();
  return service;
}
