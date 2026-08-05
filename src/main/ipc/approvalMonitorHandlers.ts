import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { WebWorkflowSystem } from '../../shared/types';
import {
  assertApprovalMonitorCheckInput,
  assertApprovalMonitorStatusInput,
} from '../security/inputValidation';
import type { ApprovalMonitorService } from '../services/approvalMonitor';
import { getEditorWindow } from '../windows/editorWindow';

const SYSTEMS = ['neis', 'edufine'] as const;

interface ApprovalMonitorCheckEvent {
  sender: { mainFrame: unknown };
  senderFrame: unknown;
}

interface ApprovalMonitorEditorWindow {
  isDestroyed(): boolean;
  webContents: unknown;
}

export function assertApprovalMonitorCheckSender(
  event: ApprovalMonitorCheckEvent,
  editor: ApprovalMonitorEditorWindow | null = getEditorWindow(),
): void {
  if (!editor || editor.isDestroyed() || editor.webContents !== event.sender) {
    throw new TypeError('결재 대기 확인은 스트림 패널 설정 창에서만 실행할 수 있습니다. 설정 창을 다시 열어 주세요.');
  }
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new TypeError('결재 대기 확인은 설정 창의 최상위 화면에서만 실행할 수 있습니다. 설정 창을 다시 열어 주세요.');
  }
}

export function createApprovalMonitorHandlerActions(
  service: ApprovalMonitorService,
  {
    now = Date.now,
    cooldownMs = 2_000,
  }: { now?: () => number; cooldownMs?: number } = {},
) {
  const lastCheckAt = new Map<WebWorkflowSystem, number>();
  return {
    status: () => service.getStatuses(),
    check: (input: { system?: WebWorkflowSystem }) => {
      const requested = input.system ? [input.system] : [...SYSTEMS];
      const checkedAt = now();
      if (
        cooldownMs > 0 &&
        requested.some((system) => checkedAt - (lastCheckAt.get(system) ?? -Infinity) < cooldownMs)
      ) {
        return Promise.resolve(service.getStatuses());
      }
      for (const system of requested) lastCheckAt.set(system, checkedAt);
      return service.check(input);
    },
  };
}

export function registerApprovalMonitorHandlers(service: ApprovalMonitorService): void {
  const actions = createApprovalMonitorHandlerActions(service);
  ipcMain.handle(IPC_CHANNELS.WEB_APPROVAL_STATUS, (_event, input: unknown) => {
    assertApprovalMonitorStatusInput(input);
    return actions.status();
  });
  ipcMain.handle(IPC_CHANNELS.WEB_APPROVAL_CHECK, (event, input: unknown) => {
    assertApprovalMonitorCheckInput(input);
    assertApprovalMonitorCheckSender(event);
    return actions.check(input);
  });
}
