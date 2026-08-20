import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AppConfig,
  ApprovalMonitorConfig,
  ApprovalMonitorStatus,
  ApprovalWorkHoursConfig,
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebWorkflowSystem,
} from '../../../shared/types';
import { isEducationOfficeCode } from '../../../shared/educationOffices';
import { isWebConnectorBrowserId } from '../../../shared/webWorkflows';
import type { ApprovalScanInput } from './definitions';
import { isApprovalCheckCancelled } from './cancellation';

const SYSTEMS = ['neis', 'edufine'] as const;
const BUSY_RETRY_DELAY_MS = 60_000;

interface PersistedSystemState {
  officeCode: EducationOfficeCode;
  browserId: WebConnectorBrowserId;
  pendingCount: number;
  lastCheckedAt: number;
  lastNotifiedCount?: number;
}

interface ApprovalMonitorState {
  version: 2;
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
  check(
    input: { system?: WebWorkflowSystem },
    options?: { interactive?: boolean },
  ): Promise<ApprovalMonitorStatus[]>;
  onConfigChanged(config: AppConfig): void;
}

export interface CreateApprovalMonitorServiceOptions {
  platform?: NodeJS.Platform;
  userDataPath?: string;
  getConfig: () => AppConfig;
  scanner: ApprovalMonitorScanner;
  stateIo?: ApprovalMonitorStateIo;
  notify?: (
    system: WebWorkflowSystem,
    count: number,
    previousCount: number | undefined,
  ) => void;
  broadcast?: (statuses: ApprovalMonitorStatus[]) => void;
  now?: () => number;
  setTimer?: (handler: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (error: Error) => void;
}

export interface ApprovalMonitorStateFileSystem {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  writeFile(
    path: string,
    text: string,
    options: { encoding: 'utf8'; mode: number },
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export function createApprovalMonitorStateIo(
  userDataPath: string,
  fileSystem: ApprovalMonitorStateFileSystem = { readFile, mkdir, writeFile, rename },
): ApprovalMonitorStateIo {
  const statePath = join(userDataPath, 'approval-monitor', 'state.json');
  const temporaryPath = `${statePath}.tmp`;
  return {
    async read() {
      try {
        return await fileSystem.readFile(statePath, 'utf8');
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return undefined;
        throw new Error(`결재 알림 상태 파일을 읽지 못했습니다. 스트림 패널 설정 폴더의 읽기 권한을 확인해 주세요: ${errorDetail(error)}`);
      }
    },
    async write(text) {
      await fileSystem.mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      await fileSystem.writeFile(temporaryPath, text, { encoding: 'utf8', mode: 0o600 });
      await fileSystem.rename(temporaryPath, statePath);
    },
  };
}

function defaultState(): ApprovalMonitorState {
  return { version: 2, systems: {} };
}

function validPersistedSystem(value: unknown): value is PersistedSystemState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => [
      'officeCode',
      'browserId',
      'pendingCount',
      'lastCheckedAt',
      'lastNotifiedCount',
    ].includes(key)) &&
    isEducationOfficeCode(record.officeCode) &&
    isWebConnectorBrowserId(record.browserId) &&
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
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('결재 알림 상태 파일이 손상되었습니다. 설정의 지금 확인을 눌러 새 기준을 저장해 주세요.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('결재 알림 상태 파일이 손상되었습니다. 설정의 지금 확인을 눌러 새 기준을 저장해 주세요.');
  }
  const record = value as Record<string, unknown>;
  // Version 1 could persist a page-size selector (for example 100) as an
  // approval count. Discard it once so the next scan establishes a list-based
  // baseline instead of continuing to show a known-unreliable value.
  if (record.version === 1) return defaultState();
  if (
    record.version !== 2 ||
    !record.systems ||
    typeof record.systems !== 'object' ||
    Array.isArray(record.systems)
  ) {
    throw new Error('결재 알림 상태 파일이 손상되었습니다. 설정의 지금 확인을 눌러 새 기준을 저장해 주세요.');
  }
  const rawSystems = record.systems as Record<string, unknown>;
  const systems: ApprovalMonitorState['systems'] = {};
  for (const system of SYSTEMS) {
    if (rawSystems[system] === undefined) continue;
    if (!validPersistedSystem(rawSystems[system])) {
      throw new Error('결재 알림 상태 파일이 손상되었습니다. 설정의 지금 확인을 눌러 새 기준을 저장해 주세요.');
    }
    systems[system] = { ...rawSystems[system] };
  }
  return { version: 2, systems };
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
  stateIo = createApprovalMonitorStateIo(userDataPath),
  notify = () => undefined,
  broadcast = () => undefined,
  now = Date.now,
  setTimer = (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  onError = (error) => console.warn(error.message),
}: CreateApprovalMonitorServiceOptions): ApprovalMonitorService {
  let state = defaultState();
  let statuses: ApprovalMonitorStatus[] = [];
  let started = false;
  let stateLoadError: string | null = null;
  let timer: unknown = null;
  const busyRetrySystems = new Set<WebWorkflowSystem>();
  let tail: Promise<void> = Promise.resolve();
  const inFlightBySystem = new Map<WebWorkflowSystem, Promise<void>>();
  const interactiveChecks = new Set<WebWorkflowSystem>();
  const consecutiveFailures = new Map<WebWorkflowSystem, number>();
  const checkRevisions = new Map<WebWorkflowSystem, number>(
    SYSTEMS.map((system) => [system, 0]),
  );
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
    if (stateLoadError) return { system, state: 'error', message: stateLoadError };
    return {
      system,
      state: persisted ? 'ready' : 'idle',
      ...(persisted ? {
        pendingCount: persisted.pendingCount,
        lastCheckedAt: persisted.lastCheckedAt,
      } : {}),
    };
  });

  const reportError = (message: string, error: unknown): void => {
    onError(new Error(`${message}: ${errorDetail(error)}`));
  };

  const publish = () => {
    try {
      broadcast(statuses.map((status) => ({ ...status })));
    } catch (error) {
      reportError('결재 알림 상태를 창에 전달하지 못했습니다. 닫힌 창은 건너뛰고 다음 확인을 계속합니다', error);
    }
  };

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  const persist = async (nextState: ApprovalMonitorState = state): Promise<void> => {
    try {
      await stateIo.write(JSON.stringify(nextState, null, 2));
    } catch (error) {
      throw new Error(`결재 알림 상태를 저장하지 못했습니다. 스트림 패널 설정 폴더의 쓰기 권한과 남은 저장 공간을 확인해 주세요: ${errorDetail(error)}`);
    }
  };

  const service: ApprovalMonitorService = {
    async start() {
      if (started) return;
      try {
        state = parseState(await stateIo.read());
        stateLoadError = null;
      } catch (error) {
        state = defaultState();
        stateLoadError = errorDetail(error);
      }
      const config = getConfig();
      for (const system of SYSTEMS) {
        const persisted = state.systems[system];
        const source = config.approvalMonitor.sources[system];
        if (
          persisted &&
          (
            persisted.officeCode !== config.educationOfficeCode ||
            persisted.browserId !== source.browserId
          )
        ) {
          delete state.systems[system];
        }
      }
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
    async check(input, options) {
      if (!started || platform !== 'win32') return service.getStatuses();
      const interactive = options?.interactive === true;
      const selected = input.system ? [input.system] : [...SYSTEMS];
      const runs = selected.map((system) => {
        const inFlight = inFlightBySystem.get(system);
        if (inFlight && (!interactive || interactiveChecks.has(system))) return inFlight;
        const checkRevision = (checkRevisions.get(system) ?? 0) + 1;
        checkRevisions.set(system, checkRevision);
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
              ...(previous ? { previousPendingCount: previous.pendingCount } : {}),
              ...(interactive ? { interactive: true } : {}),
            });
            if (!started) return;
            if ((checkRevisions.get(system) ?? 0) !== checkRevision) return;
            if ((sourceRevisions.get(system) ?? 0) !== sourceRevision) {
              statuses = createStatuses();
              publish();
              return;
            }
            const checkedAt = now();
            const currentConfig = getConfig();
            const increase = previous === undefined
              ? 0
              : Math.max(0, pendingCount - previous.pendingCount);
            const sendNotification = establishedBaselines.has(system) &&
              isWithinApprovalWorkHours(
                new Date(checkedAt),
                currentConfig.approvalMonitor.workHours,
              ) &&
              shouldSendApprovalNotification(
                previous?.pendingCount,
                pendingCount,
                currentConfig.approvalMonitor.notifyOnlyOnIncrease,
              );
            const nextState: ApprovalMonitorState = {
              version: 2,
              systems: {
                ...state.systems,
                [system]: {
                  officeCode: currentConfig.educationOfficeCode,
                  browserId: currentConfig.approvalMonitor.sources[system].browserId,
                  pendingCount,
                  lastCheckedAt: checkedAt,
                  ...(sendNotification
                    ? { lastNotifiedCount: pendingCount }
                    : previous?.lastNotifiedCount === undefined
                      ? {}
                      : { lastNotifiedCount: previous.lastNotifiedCount }),
                },
              },
            };
            await persist(nextState);
            if (!started) return;
            if ((sourceRevisions.get(system) ?? 0) !== sourceRevision) {
              await persist();
              statuses = createStatuses();
              publish();
              return;
            }
            state = nextState;
            stateLoadError = null;
            consecutiveFailures.delete(system);
            busyRetrySystems.delete(system);
            statuses[index] = {
              system,
              state: 'ready',
              pendingCount,
              lastCheckedAt: checkedAt,
              ...(increase > 0 && previous ? {
                previousPendingCount: previous.pendingCount,
                increase,
                changedAt: checkedAt,
              } : {}),
            };
            establishedBaselines.add(system);
            if (sendNotification) {
              try {
                notify(system, pendingCount, previous?.pendingCount);
              } catch (error) {
                reportError('결재 대기 알림을 표시하지 못했습니다. 윈도우 알림 설정을 확인해 주세요', error);
              }
            }
          } catch (error) {
            if (!started) return;
            if ((checkRevisions.get(system) ?? 0) !== checkRevision) return;
            if ((sourceRevisions.get(system) ?? 0) !== sourceRevision) {
              statuses = createStatuses();
              publish();
              return;
            }
            if (isApprovalCheckCancelled(error)) {
              if (!interactive) busyRetrySystems.add(system);
              statuses[index] = previous
                ? {
                    system,
                    state: 'ready',
                    pendingCount: previous.pendingCount,
                    lastCheckedAt: previous.lastCheckedAt,
                  }
                : { system, state: 'idle' };
              publish();
              return;
            }
            const message = errorDetail(error);
            const connectionProblem = /로그인|인증|연결 탭|다시 연결/.test(message);
            const persistentLocalProblem = /상태.*저장|권한|남은 저장 공간/.test(message);
            const failures = (consecutiveFailures.get(system) ?? 0) + 1;
            consecutiveFailures.set(system, failures);
            if (!interactive && !connectionProblem && !persistentLocalProblem && failures < 3) {
              busyRetrySystems.add(system);
              statuses[index] = {
                system,
                state: 'retrying',
                message: `업무 화면을 사용하는 동안 건수 확인을 마치지 못했습니다. 1분 뒤 다시 확인합니다. (${failures}/3)`,
                ...(previous ? {
                  pendingCount: previous.pendingCount,
                  lastCheckedAt: previous.lastCheckedAt,
                } : {}),
              };
            } else {
              busyRetrySystems.delete(system);
              statuses[index] = {
                system,
                state: connectionProblem ? 'login-required' : 'error',
                message,
                ...(previous ? {
                  pendingCount: previous.pendingCount,
                  lastCheckedAt: previous.lastCheckedAt,
                } : {}),
              };
            }
          }
          publish();
        };
        // A user click must not sit behind a scheduled scan that can spend tens
        // of seconds inside portal frames. Start it immediately; the connector
        // aborts the older scan and the revision guard ignores its stale result.
        const run = interactive ? operation() : tail.then(operation, operation);
        if (!interactive) tail = run.then(() => undefined, () => undefined);
        const tracked = run.finally(() => {
          if (inFlightBySystem.get(system) === tracked) {
            inFlightBySystem.delete(system);
            interactiveChecks.delete(system);
          }
        });
        inFlightBySystem.set(system, tracked);
        if (interactive) interactiveChecks.add(system);
        return tracked;
      });
      try {
        await Promise.all(runs);
        return service.getStatuses();
      } finally {
        schedule();
      }
    },
    onConfigChanged(config) {
      for (const system of SYSTEMS) {
        const nextSignature = sourceSignature(config, system);
        if (sourceSignatures.get(system) !== nextSignature) {
          establishedBaselines.delete(system);
          consecutiveFailures.delete(system);
          busyRetrySystems.delete(system);
          sourceRevisions.set(system, (sourceRevisions.get(system) ?? 0) + 1);
          delete state.systems[system];
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
    let config: ApprovalMonitorConfig;
    try {
      config = getConfig().approvalMonitor;
    } catch (error) {
      reportError('결재 알림 설정을 읽지 못했습니다. 10분 뒤 다시 확인합니다', error);
      timer = setTimer(schedule, 10 * 60_000);
      return;
    }
    if (!SYSTEMS.some((system) => config.sources[system].enabled)) return;
    const intervalMinutes = [5, 10, 30].includes(config.intervalMinutes)
      ? config.intervalMinutes
      : 10;
    const retryAfterBusyWork = busyRetrySystems.size > 0;
    timer = setTimer(() => {
      timer = null;
      let current: ApprovalMonitorConfig;
      try {
        current = getConfig().approvalMonitor;
      } catch (error) {
        reportError('결재 알림 설정을 읽지 못했습니다. 다음 확인을 다시 예약합니다', error);
        schedule();
        return;
      }
      if (isWithinApprovalWorkHours(new Date(now()), current.workHours)) {
        void service.check({}).catch((error) => {
          reportError('예약된 결재 대기 확인을 마치지 못했습니다. 다음 주기에 다시 시도합니다', error);
        });
      } else {
        schedule();
      }
    }, retryAfterBusyWork ? BUSY_RETRY_DELAY_MS : intervalMinutes * 60_000);
  }

  statuses = createStatuses();
  return service;
}
