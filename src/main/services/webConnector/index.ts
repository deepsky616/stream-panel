import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ActionItem,
  AppConfig,
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebConnectorStatus,
  WebSystemConnectionStatus,
  WebWorkflowSpec,
  WebWorkflowSystem,
} from '../../../shared/types';
import {
  getWebWorkflowTarget,
  getWebWorkflowTargetForSpec,
  getWebWorkflowSystem,
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
  type WindowsConnectionDiagnosticEvent,
  type WindowsManagedBrowserSession,
} from './windows';
import type { WorkflowRunResult } from './workflows/engine';
import type { ApprovalScanInput } from '../approvalMonitor/definitions';
import { isApprovalCheckCancelled } from '../approvalMonitor/cancellation';

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
  focus?(request: ManagedWorkflowRequest): Promise<void>;
  getSession(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): ManagedBrowserSession | undefined;
  closeOtherOffices(officeCode: EducationOfficeCode): Promise<void>;
  closeAll(): Promise<void>;
  checkApproval?(input: ApprovalScanInput): Promise<number>;
  cancelApprovalChecks?(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): void;
  beginInteractiveWork?(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): void;
  endInteractiveWork?(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): void;
  connectSystems?(
    input: {
      officeCode: EducationOfficeCode;
      browserId: WebConnectorBrowserId;
      systems: readonly WebWorkflowSystem[];
      foreground?: boolean;
      signal?: AbortSignal;
      diagnose?: (event: WindowsConnectionDiagnosticEvent) => void | Promise<void>;
    },
    report?: (status: WebSystemConnectionStatus) => void,
  ): Promise<void>;
}

export interface WebConnectorService {
  start(): Promise<ConnectorReply>;
  stop(): Promise<void>;
  queue(item: ActionItem): WebConnectorEnqueueResult;
  getStatuses(): WebConnectorStatus[];
  test(browserId: WebConnectorBrowserId): Promise<ConnectorReply>;
  openSetup(
    browserId: WebConnectorBrowserId,
    target: 'pair' | 'connect' | 'extensions',
  ): Promise<ConnectorReply>;
  openApprovalInbox(system: WebWorkflowSystem): WebConnectorEnqueueResult;
  ensureDiagnosticsDirectory(): Promise<string>;
  scanApproval(input: ApprovalScanInput): Promise<number>;
  onConfigChanged(config: AppConfig): Promise<void>;
}

export interface CreateWebConnectorServiceOptions {
  userDataPath: string;
  platform?: NodeJS.Platform;
  getConfig: () => AppConfig;
  notify?: (message: string, level: 'info' | 'error') => void;
  broadcast?: (statuses: WebConnectorStatus[]) => void;
  stateIo?: LoadManagedWebConnectorStateOptions;
  sessionController?: WebConnectorSessionController;
  openPortal?: (session: ManagedBrowserSession) => Promise<void>;
  diagnostics?: WebConnectorDiagnostics;
  now?: () => number;
  confirmWorkflowStep?: (details: {
    workflowName: string;
    stepLabel: string;
    system: WebWorkflowSystem;
  }) => Promise<boolean>;
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
    case 'neis-approval-inbox':
      return '나이스 결재함을 열었습니다. 승인, 반려와 서명은 화면에서 직접 진행해 주세요.';
    case 'edufine-draft':
      return '에듀파인 기안 화면을 열었습니다. 내용을 확인한 뒤 직접 상신해 주세요.';
    case 'edufine-purchase':
      return '에듀파인 품의 화면을 열었습니다. 내용을 확인한 뒤 직접 상신해 주세요.';
    case 'edufine-approval-inbox':
      return '에듀파인 결재함을 열었습니다. 승인, 반려와 서명은 화면에서 직접 진행해 주세요.';
    case 'custom':
      return `${workflowSpec.custom.name} 이동을 완료했습니다. 확인이 필요한 중요 단계는 승인한 항목만 한 번 실행했습니다.`;
  }
}

function workflowProgressMessage(workflowSpec: WebWorkflowSpec): string {
  const name = workflowSpec.id === 'custom'
    ? workflowSpec.custom.name
    : {
        'neis-leave': '나이스 복무',
        'neis-trip': '나이스 출장',
        'neis-approval-inbox': '나이스 결재함',
        'edufine-draft': '에듀파인 기안',
        'edufine-purchase': '에듀파인 품의',
        'edufine-approval-inbox': '에듀파인 결재함',
      }[workflowSpec.id];
  return `${name} 화면을 여는 중입니다. 로그인이 필요하면 표시된 업무용 브라우저에서 진행해 주세요.`;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류';
}

function diagnosticStepId(error: unknown): string {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return 'workflow-failed';
  const stepId = (error as { stepId?: unknown }).stepId;
  if (typeof stepId === 'string' && /^[a-z0-9-]{1,64}$/.test(stepId)) return stepId;
  const message = errorDetail(error);
  if (/결재 대기 수|결재 목록|목록 표/.test(message)) return 'read-approval-count';
  if (/로그인|인증/.test(message)) return 'approval-login-required';
  if (/허용되지 않은|주소|호스트|origin/i.test(message)) return 'approval-origin';
  return 'workflow-failed';
}

export function createWebConnectorService({
  userDataPath,
  platform = process.platform,
  getConfig,
  notify = () => undefined,
  broadcast = () => undefined,
  stateIo = diskStateIo(userDataPath),
  sessionController,
  openPortal,
  diagnostics: injectedDiagnostics,
  now = Date.now,
  confirmWorkflowStep,
}: CreateWebConnectorServiceOptions): WebConnectorService {
  const controller = sessionController ?? (
    platform === 'win32'
      ? createWindowsManagedSessionManager({
        userDataPath,
        workflowDependencies: {
          confirmStep: async (request, _step, candidate) => {
            const spec = request.workflowSpec;
            if (!spec || !confirmWorkflowStep) return false;
            return confirmWorkflowStep({
              workflowName: spec.id === 'custom' ? spec.custom.name : candidate.text,
              stepLabel: candidate.text,
              system: getWebWorkflowSystem(spec),
            });
          },
        },
      })
      : unavailableController()
  );
  const portalOpener = openPortal ?? (
    platform === 'win32'
      ? (session: ManagedBrowserSession) => openWindowsOfficePortal(
          session as WindowsManagedBrowserSession,
        )
      : undefined
  );
  const diagnostics = injectedDiagnostics ?? createWebConnectorDiagnostics({
    userDataPath,
    platform: platform === 'win32' ? 'win32' : 'darwin',
  });
  let state: ManagedWebConnectorState | null = null;
  let starting: Promise<ConnectorReply> | null = null;
  let started = false;
  let persistTail: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<void>>();
  const inFlightWorkflows = new Map<string, Promise<void>>();
  const connectionStates = new Map<string, Map<WebWorkflowSystem, WebSystemConnectionStatus>>();
  let configuredOfficeCode = getConfig().educationOfficeCode;

  const currentOffice = (): EducationOfficeCode => getConfig().educationOfficeCode;

  const connectionKey = (
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ) => `${officeCode}:${browserId}`;

  const systemStatuses = (
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
    sessionAlive: boolean,
  ): WebSystemConnectionStatus[] => {
    const stored = connectionStates.get(connectionKey(officeCode, browserId));
    return (['neis', 'edufine'] as const).map((system) => {
      const status = stored?.get(system) ?? { system, state: 'idle' as const };
      return !sessionAlive && status.state === 'connected'
        ? { system, state: 'idle' as const }
        : { ...status };
    });
  };

  const readStatuses = (): WebConnectorStatus[] => {
    const officeCode = currentOffice();
    return (['edge', 'chrome'] as const).map((browserId): WebConnectorStatus => {
      const handshake = state?.offices[officeCode]?.[browserId];
      const session = controller.getSession(officeCode, browserId);
      const sessionAlive = Boolean(session?.isAlive());
      return {
        browserId,
        paired: Boolean(handshake),
        connected: sessionAlive,
        systems: systemStatuses(officeCode, browserId, sessionAlive),
        ...(handshake ? { lastSeenAt: handshake.lastSeenAt } : {}),
      };
    });
  };

  const publishStatuses = (): void => {
    try {
      broadcast(readStatuses());
    } catch {
      // A closed renderer must not stop browser connection work.
    }
  };

  const setSystemStatus = (
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
    status: WebSystemConnectionStatus,
  ): void => {
    const key = connectionKey(officeCode, browserId);
    const systems = connectionStates.get(key) ?? new Map();
    systems.set(status.system, { ...status });
    connectionStates.set(key, systems);
    publishStatuses();
  };

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
    controller.cancelApprovalChecks?.(officeCode, browserId);
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
      connectionStates.clear();
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
      const officeCode = currentOffice();
      // The central office is authoritative at launch time. This protects an
      // already-rendered key from opening the previous office during the short
      // interval between a settings change and the updated deck broadcast.
      const workflowSpec: WebWorkflowSpec = {
        ...item.webWorkflow,
        officeCode,
      };
      const workflowSystem = getWebWorkflowSystem(workflowSpec);
      const workflowTarget = getWebWorkflowTargetForSpec(workflowSpec, officeCode);
      if (!isAllowedWebWorkflowSpecTarget(workflowSpec, workflowTarget, officeCode)) {
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
      // Interactive button presses must not wait behind a background approval
      // scan that can spend tens of seconds waiting for portal frames.
      controller.cancelApprovalChecks?.(officeCode, request.browserId);
      const workflowKey = [
        officeCode,
        request.browserId,
        request.workflowId,
      ].join(':');
      if (inFlightWorkflows.has(workflowKey)) {
        notify(workflowProgressMessage(workflowSpec), 'info');
        void controller.focus?.(request).catch(() => undefined);
        return { queued: true };
      }
      controller.beginInteractiveWork?.(officeCode, request.browserId);
      const startedAt = now();
      notify(workflowProgressMessage(workflowSpec), 'info');
      const task = (async () => {
        try {
          await controller.closeOtherOffices(officeCode);
          await controller.prepare(officeCode, request.browserId);
          if (state) {
            state = markManagedHandshake(state, officeCode, request.browserId, now());
            await persist();
          }
          await controller.run(request);
          setSystemStatus(officeCode, request.browserId, {
            system: workflowSystem,
            state: 'connected',
            checkedAt: now(),
          });
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
          const cancelledByUser = /단계 실행을 취소했습니다/.test(detail);
          setSystemStatus(officeCode, request.browserId, {
            system: workflowSystem,
            state: cancelledByUser
              ? 'connected'
              : (
                /로그인|인증|기다리는 시간이 지났습니다/.test(detail)
                  ? 'login-required'
                  : 'error'
              ),
            ...(cancelledByUser ? { checkedAt: now() } : { message: detail }),
          });
          notify(detail, cancelledByUser ? 'info' : 'error');
          try {
            await diagnostics.record({
              at: now(),
              browserId: request.browserId,
              officeCode,
              workflowId: request.workflowId,
              stepId: diagnosticStepId(error),
              sequence: 0,
              outcome: 'failed',
              durationMs: Math.max(0, now() - startedAt),
            });
          } catch {
            // A diagnostic write failure must not hide the actionable workflow error.
          }
        } finally {
          controller.endInteractiveWork?.(officeCode, request.browserId);
        }
      })();
      inFlightWorkflows.set(workflowKey, task);
      pending.add(task);
      void task.finally(() => {
        pending.delete(task);
        if (inFlightWorkflows.get(workflowKey) === task) {
          inFlightWorkflows.delete(workflowKey);
        }
      });
      return { queued: true };
    },
    getStatuses() {
      return readStatuses();
    },
    async test(browserId) {
      const officeCode = currentOffice();
      controller.beginInteractiveWork?.(officeCode, browserId);
      try {
        await prepareAndMark(browserId);
        // A successful browser probe proves the managed browser transport is healthy.
        // Do not leave a previous NEIS/Edufine workflow error painted on the browser card.
        connectionStates.delete(connectionKey(currentOffice(), browserId));
        publishStatuses();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: errorDetail(error) };
      } finally {
        controller.endInteractiveWork?.(officeCode, browserId);
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
      const officeCode = currentOffice();
      controller.beginInteractiveWork?.(officeCode, browserId);
      try {
        const session = await prepareAndMark(browserId);
        connectionStates.delete(connectionKey(officeCode, browserId));
        publishStatuses();
        if (target === 'pair') {
          await portalOpener?.(session);
          return { ok: true };
        }
        if (!controller.connectSystems) {
          throw new Error('나이스·K-에듀파인 연결 기능이 준비되지 않았습니다. 앱을 다시 시작해 주세요.');
        }
        const systems: readonly WebWorkflowSystem[] = ['neis', 'edufine'];
        const connectionResults = new Map<WebWorkflowSystem, WebSystemConnectionStatus>();
        await controller.connectSystems({
          officeCode,
          browserId,
          systems,
          foreground: true,
          diagnose: async (event) => {
            try {
              await diagnostics.record({
                at: now(),
                browserId,
                officeCode,
                ...(event.system ? { system: event.system } : {}),
                stepId: event.stepId,
                sequence: 0,
                outcome: event.outcome,
                durationMs: event.durationMs,
                ...(event.currentUrl ? { currentUrl: event.currentUrl } : {}),
              });
            } catch {
              // Connection diagnostics must not alter the official SSO result.
            }
          },
        }, (status) => {
          connectionResults.set(status.system, status);
          setSystemStatus(officeCode, browserId, status);
        });
        const failed = systems.flatMap((system) => {
          const status = connectionResults.get(system);
          const label = system === 'neis' ? '나이스' : 'K-에듀파인';
          if (!status) {
            const message = `${label} 연결 결과를 확인하지 못했습니다. 업무포털 메인에서 다시 연결해 주세요.`;
            setSystemStatus(officeCode, browserId, {
              system,
              state: 'error',
              message,
            });
            return [message];
          }
          if (status.state === 'connected') return [];
          return [`${label}: ${status.message ?? '연결을 완료하지 못했습니다.'}`];
        });
        if (failed.length > 0) throw new Error(failed.join(' / '));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: errorDetail(error) };
      } finally {
        controller.endInteractiveWork?.(officeCode, browserId);
      }
    },
    openApprovalInbox(system) {
      const config = getConfig();
      const workflowId = system === 'neis'
        ? 'neis-approval-inbox' as const
        : 'edufine-approval-inbox' as const;
      const browserId = config.approvalMonitor.sources[system].browserId;
      return this.queue({
        id: `titlebar-${system}-approval-inbox`,
        kind: 'action',
        label: system === 'neis' ? '나이스 결재함' : '에듀파인 결재함',
        type: 'url',
        target: getWebWorkflowTarget(workflowId, config.educationOfficeCode),
        args: [],
        icon: { kind: 'emoji', value: '🔔' },
        color: '#5B8CFF',
        position: 0,
        webWorkflow: {
          id: workflowId,
          browserId,
          officeCode: config.educationOfficeCode,
        },
      });
    },
    async ensureDiagnosticsDirectory() {
      await mkdir(diagnostics.directory, { recursive: true, mode: 0o700 });
      return diagnostics.directory;
    },
    async scanApproval(input) {
      if (!started || !state) {
        throw new Error('결재 대기 알림 연결부가 준비되지 않았습니다. 앱을 다시 시작해 주세요.');
      }
      if (platform !== 'win32') {
        throw new Error('결재 대기 알림은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 시도해 주세요.');
      }
      if (input.officeCode !== currentOffice()) {
        throw new Error('현재 소속 교육청과 결재 대기 확인 요청의 교육청이 다릅니다. 설정을 다시 확인해 주세요.');
      }
      if (!controller.checkApproval) {
        throw new Error('결재 대기 확인 기능이 준비되지 않았습니다. 스트림 패널을 업데이트해 주세요.');
      }
      const previousStatus = connectionStates
        .get(connectionKey(input.officeCode, input.browserId))
        ?.get(input.system);
      const startedAt = now();
      const workflowId = input.system === 'neis'
        ? 'neis-approval-inbox' as const
        : 'edufine-approval-inbox' as const;
      setSystemStatus(input.officeCode, input.browserId, {
        system: input.system,
        state: 'connecting',
        message: `${input.system === 'neis' ? '나이스' : 'K-에듀파인'} 결재함에 연결하고 있습니다.`,
      });
      try {
        const count = await controller.checkApproval(input);
        setSystemStatus(input.officeCode, input.browserId, {
          system: input.system,
          state: 'connected',
          checkedAt: now(),
        });
        try {
          await diagnostics.record({
            at: now(),
            browserId: input.browserId,
            officeCode: input.officeCode,
            workflowId,
            stepId: 'approval-count-read',
            sequence: 0,
            outcome: 'success',
            durationMs: Math.max(0, now() - startedAt),
          });
        } catch {
          // A diagnostic write failure must not turn a successful count into an error.
        }
        return count;
      } catch (error) {
        if (isApprovalCheckCancelled(error)) {
          setSystemStatus(
            input.officeCode,
            input.browserId,
            previousStatus ?? { system: input.system, state: 'idle' },
          );
          try {
            await diagnostics.record({
              at: now(),
              browserId: input.browserId,
              officeCode: input.officeCode,
              workflowId,
              stepId: 'approval-check-cancelled',
              sequence: 0,
              outcome: 'cancelled',
              durationMs: Math.max(0, now() - startedAt),
            });
          } catch {
            // Preserve the cancellation that allowed an interactive workflow to proceed.
          }
          throw error;
        }
        const message = errorDetail(error);
        setSystemStatus(input.officeCode, input.browserId, {
          system: input.system,
          state: /로그인|인증|기다리는 시간이 지났습니다/.test(message)
            ? 'login-required'
            : 'error',
          message,
        });
        try {
          await diagnostics.record({
            at: now(),
            browserId: input.browserId,
            officeCode: input.officeCode,
            workflowId,
            stepId: diagnosticStepId(error),
            sequence: 0,
            outcome: 'failed',
            durationMs: Math.max(0, now() - startedAt),
          });
        } catch {
          // Preserve the actionable approval error when diagnostics cannot be written.
        }
        throw error;
      }
    },
    async onConfigChanged(config) {
      const officeChanged = configuredOfficeCode !== config.educationOfficeCode;
      configuredOfficeCode = config.educationOfficeCode;
      if (officeChanged) connectionStates.clear();
      await controller.closeOtherOffices(config.educationOfficeCode);
      if (officeChanged) publishStatuses();
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
