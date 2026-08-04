import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ActionItem,
  AppConfig,
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebConnectorStatus,
  WebWorkflowSpec,
} from '../../../shared/types';
import {
  isAllowedWebWorkflowSpecTarget,
  isWebWorkflowSpec,
} from '../../../shared/webWorkflows';
import {
  createWebConnectorDiagnostics,
  type WebConnectorDiagnostics,
} from './diagnostics';
import type {
  ManagedBrowserSession,
  ManagedWorkflowRequest,
} from './sessionManager';
import {
  loadManagedWebConnectorState,
  markManagedHandshake,
  type LoadManagedWebConnectorStateOptions,
  type ManagedWebConnectorState,
} from './state';
import {
  createWindowsManagedSessionManager,
  openWindowsOfficePortal,
  type WindowsManagedBrowserSession,
} from './windows';
import type { WorkflowRunResult } from './workflows/engine';

export type ConnectorReply = { ok: true } | { ok: false; message: string };

export type WebConnectorEnqueueResult =
  | { queued: true }
  | { queued: false; message: string };

export interface WebConnectorSessionController {
  prepare(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): Promise<ManagedBrowserSession>;
  run(request: ManagedWorkflowRequest): Promise<WorkflowRunResult>;
  getSession(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): ManagedBrowserSession | undefined;
  closeOtherOffices(officeCode: EducationOfficeCode): Promise<void>;
  closeAll(): Promise<void>;
}

export interface WebConnectorService {
  start(): Promise<ConnectorReply>;
  stop(): Promise<void>;
  queue(item: ActionItem): WebConnectorEnqueueResult;
  getStatuses(): WebConnectorStatus[];
  test(browserId: WebConnectorBrowserId): Promise<ConnectorReply>;
  openSetup(
    browserId: WebConnectorBrowserId,
    target: 'pair' | 'extensions',
  ): Promise<ConnectorReply>;
  ensureDiagnosticsDirectory(): Promise<string>;
  onConfigChanged(config: AppConfig): Promise<void>;
}

export interface CreateWebConnectorServiceOptions {
  userDataPath: string;
  platform?: NodeJS.Platform;
  getConfig: () => AppConfig;
  notify?: (message: string, level: 'info' | 'error') => void;
  stateIo?: LoadManagedWebConnectorStateOptions;
  sessionController?: WebConnectorSessionController;
  openPortal?: (session: ManagedBrowserSession) => Promise<void>;
  diagnostics?: WebConnectorDiagnostics;
  now?: () => number;
}

function diskStateIo(userDataPath: string): LoadManagedWebConnectorStateOptions {
  const statePath = join(userDataPath, 'web-connector', 'managed-state.json');
  return {
    read: async () => {
      try {
        return await readFile(statePath, 'utf8');
      } catch {
        return undefined;
      }
    },
    write: async (text) => {
      await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      await writeFile(statePath, text, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

function unavailableController(): WebConnectorSessionController {
  const reject = async (): Promise<never> => {
    throw new Error('웹 업무 자동 이동은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 시도해 주세요.');
  };
  return {
    prepare: reject,
    run: reject,
    getSession: () => undefined,
    closeOtherOffices: async () => undefined,
    closeAll: async () => undefined,
  };
}

function workflowSuccessMessage(workflowSpec: WebWorkflowSpec): string {
  switch (workflowSpec.id) {
    case 'neis-leave':
      return '나이스 복무 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 제출해 주세요.';
    case 'neis-trip':
      return '나이스 출장 화면을 열었습니다. 내용을 확인한 뒤 직접 저장하거나 제출해 주세요.';
    case 'edufine-draft':
      return '에듀파인 기안 화면을 열었습니다. 내용을 확인한 뒤 직접 상신해 주세요.';
    case 'edufine-purchase':
      return '에듀파인 품의 화면을 열었습니다. 내용을 확인한 뒤 직접 상신해 주세요.';
    case 'custom':
      return `${workflowSpec.custom.name} 화면을 열었습니다. 내용을 확인한 뒤 필요한 최종 동작은 직접 진행해 주세요.`;
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류';
}

export function createWebConnectorService({
  userDataPath,
  platform = process.platform,
  getConfig,
  notify = () => undefined,
  stateIo = diskStateIo(userDataPath),
  sessionController,
  openPortal,
  diagnostics: injectedDiagnostics,
  now = Date.now,
}: CreateWebConnectorServiceOptions): WebConnectorService {
  const controller = sessionController ?? (
    platform === 'win32'
      ? createWindowsManagedSessionManager({ userDataPath })
      : unavailableController()
  );
  const openOfficePortal = openPortal ?? (async (session) => {
    if (platform !== 'win32' || !('connection' in session)) {
      throw new Error('업무용 브라우저 연결 정보가 없습니다. 설정에서 연결을 다시 시험해 주세요.');
    }
    await openWindowsOfficePortal(session as WindowsManagedBrowserSession);
  });
  const diagnostics = injectedDiagnostics ?? createWebConnectorDiagnostics({
    userDataPath,
    platform: platform === 'win32' ? 'win32' : 'darwin',
  });
  let state: ManagedWebConnectorState | null = null;
  let starting: Promise<ConnectorReply> | null = null;
  let started = false;
  let persistTail: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<void>>();

  const persist = (): Promise<void> => {
    if (!state) return Promise.resolve();
    const text = JSON.stringify(state, null, 2);
    persistTail = persistTail.then(async () => {
      try {
        await stateIo.write(text);
      } catch (error) {
        notify(
          `업무용 브라우저 상태를 저장하지 못했습니다. 다음 실행에서 연결을 다시 시험해 주세요: ${errorDetail(error)}`,
          'error',
        );
      }
    });
    return persistTail;
  };

  const start = async (): Promise<ConnectorReply> => {
    if (started) return { ok: true };
    if (starting) return starting;
    starting = (async () => {
      try {
        state = await loadManagedWebConnectorState(stateIo);
        started = true;
        return { ok: true } as const;
      } catch (error) {
        return {
          ok: false as const,
          message: `업무용 브라우저 상태를 준비하지 못했습니다. 설정 폴더 권한을 확인해 주세요: ${errorDetail(error)}`,
        };
      }
    })();
    const result = await starting;
    starting = null;
    return result;
  };

  const currentOffice = (): EducationOfficeCode => getConfig().educationOfficeCode;

  const prepareAndMark = async (
    browserId: WebConnectorBrowserId,
  ): Promise<ManagedBrowserSession> => {
    if (!started || !state) {
      throw new Error('업무용 브라우저 연결부가 준비되지 않았습니다. 앱을 다시 시작해 주세요.');
    }
    if (platform !== 'win32') {
      throw new Error('웹 업무 자동 이동은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 시도해 주세요.');
    }
    const officeCode = currentOffice();
    await controller.closeOtherOffices(officeCode);
    const session = await controller.prepare(officeCode, browserId);
    state = markManagedHandshake(state, officeCode, browserId, now());
    await persist();
    return session;
  };

  return {
    start,
    async stop() {
      started = false;
      await Promise.allSettled([...pending]);
      await controller.closeAll();
      await persistTail;
      state = null;
      starting = null;
    },
    queue(item) {
      if (!started || !state) {
        return {
          queued: false,
          message: '웹 업무 연결부가 준비되지 않았습니다. 앱을 다시 시작한 뒤 연결을 시험해 주세요.',
        };
      }
      if (platform !== 'win32') {
        return {
          queued: false,
          message: '나이스와 에듀파인 자동 이동은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 실행해 주세요.',
        };
      }
      if (!isWebWorkflowSpec(item.webWorkflow)) {
        return {
          queued: false,
          message: '웹 업무 종류가 지정되지 않았습니다. 편집기에서 업무 키를 다시 만들어 주세요.',
        };
      }
      const workflowSpec = item.webWorkflow;
      const officeCode = currentOffice();
      if (!isAllowedWebWorkflowSpecTarget(workflowSpec, item.target, officeCode)) {
        return {
          queued: false,
          message: '선택한 교육청과 업무 주소가 일치하지 않습니다. 설정에서 소속 교육청을 다시 선택해 주세요.',
        };
      }
      const request: ManagedWorkflowRequest = {
        officeCode,
        browserId: workflowSpec.browserId,
        workflowId: workflowSpec.id,
        workflowSpec,
      };
      const startedAt = now();
      const task = (async () => {
        try {
          await controller.closeOtherOffices(officeCode);
          await controller.prepare(officeCode, request.browserId);
          if (state) {
            state = markManagedHandshake(state, officeCode, request.browserId, now());
            await persist();
          }
          await controller.run(request);
          notify(workflowSuccessMessage(workflowSpec), 'info');
          await diagnostics.record({
            at: now(),
            browserId: request.browserId,
            officeCode,
            workflowId: request.workflowId,
            stepId: 'workflow-complete',
            sequence: 0,
            outcome: 'success',
            durationMs: Math.max(0, now() - startedAt),
          });
        } catch (error) {
          const detail = errorDetail(error);
          notify(detail, 'error');
          try {
            await diagnostics.record({
              at: now(),
              browserId: request.browserId,
              officeCode,
              workflowId: request.workflowId,
              stepId: 'workflow-failed',
              sequence: 0,
              outcome: 'failed',
              durationMs: Math.max(0, now() - startedAt),
            });
          } catch {
            // A diagnostic write failure must not hide the actionable workflow error.
          }
        }
      })();
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return { queued: true };
    },
    getStatuses() {
      const officeCode = currentOffice();
      return (['edge', 'chrome'] as const).map((browserId): WebConnectorStatus => {
        const handshake = state?.offices[officeCode]?.[browserId];
        const session = controller.getSession(officeCode, browserId);
        return {
          browserId,
          paired: Boolean(handshake),
          connected: Boolean(session?.isAlive()),
          ...(handshake ? { lastSeenAt: handshake.lastSeenAt } : {}),
        };
      });
    },
    async test(browserId) {
      try {
        const session = await prepareAndMark(browserId);
        await openOfficePortal(session);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: errorDetail(error) };
      }
    },
    async openSetup(browserId, target) {
      if (target === 'extensions') {
        if (state && !state.legacyExtensionNoticeShown) {
          state = { ...state, legacyExtensionNoticeShown: true };
          await persist();
        }
        notify(
          '예전 브라우저 확장 기능은 더 이상 필요하지 않습니다. 업무용 브라우저 열기를 사용해 주세요.',
          'info',
        );
        return { ok: true };
      }
      return this.test(browserId);
    },
    async ensureDiagnosticsDirectory() {
      await mkdir(diagnostics.directory, { recursive: true, mode: 0o700 });
      return diagnostics.directory;
    },
    async onConfigChanged(config) {
      await controller.closeOtherOffices(config.educationOfficeCode);
    },
  };
}

let activeService: WebConnectorService | null = null;

export function setActiveWebConnectorService(service: WebConnectorService | null): void {
  activeService = service;
}

export function queueActiveWebWorkflow(item: ActionItem): WebConnectorEnqueueResult {
  return activeService?.queue(item) ?? {
    queued: false,
    message: '웹 업무 연결부가 시작되지 않았습니다. 앱을 다시 시작한 뒤 연결을 시험해 주세요.',
  };
}
