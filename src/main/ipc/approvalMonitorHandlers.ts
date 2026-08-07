import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import {
  assertApprovalMonitorCheckInput,
  assertApprovalMonitorStatusInput,
} from '../security/inputValidation';
import type { ApprovalMonitorService } from '../services/approvalMonitor';
import { getEditorWindow } from '../windows/editorWindow';

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
) {
  return {
    status: () => service.getStatuses(),
    // The service already coalesces checks that are in flight. A renderer-side
    // cooldown returned stale "idle" states and made the button look inert.
    check: (input: Parameters<ApprovalMonitorService['check']>[0]) => service.check(
      input,
      { interactive: true },
    ),
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
