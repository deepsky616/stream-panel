import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { WebWorkflowSystem } from '../../shared/types';
import {
  assertApprovalMonitorCheckInput,
  assertApprovalMonitorStatusInput,
} from '../security/inputValidation';
import type { ApprovalMonitorService } from '../services/approvalMonitor';

export function createApprovalMonitorHandlerActions(service: ApprovalMonitorService) {
  return {
    status: () => service.getStatuses(),
    check: (input: { system?: WebWorkflowSystem }) => service.check(input),
  };
}

export function registerApprovalMonitorHandlers(service: ApprovalMonitorService): void {
  const actions = createApprovalMonitorHandlerActions(service);
  ipcMain.handle(IPC_CHANNELS.WEB_APPROVAL_STATUS, (_event, input: unknown) => {
    assertApprovalMonitorStatusInput(input);
    return actions.status();
  });
  ipcMain.handle(IPC_CHANNELS.WEB_APPROVAL_CHECK, (_event, input: unknown) => {
    assertApprovalMonitorCheckInput(input);
    return actions.check(input);
  });
}
