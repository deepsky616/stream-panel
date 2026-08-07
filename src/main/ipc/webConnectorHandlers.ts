import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { WebConnectorBrowserId } from '../../shared/types';
import {
  assertWebConnectorApprovalInput,
  assertWebConnectorBrowserInput,
  assertWebConnectorSetupInput,
  assertWebConnectorStatusInput,
} from '../security/inputValidation';
import type { ConnectorReply, WebConnectorService } from '../services/webConnector';

interface WebConnectorHandlerDependencies {
  openDiagnosticsDirectory(path: string): Promise<string>;
}

export function createWebConnectorHandlerActions(
  service: WebConnectorService,
  dependencies: WebConnectorHandlerDependencies = {
    openDiagnosticsDirectory: (path) => shell.openPath(path),
  },
) {
  return {
    status: () => service.getStatuses(),
    test: (input: { browserId: WebConnectorBrowserId }) => service.test(input.browserId),
    openApprovalInbox: (input: { system: 'neis' | 'edufine' }) => (
      service.openApprovalInbox(input.system)
    ),
    async openSetup(input: {
      browserId: WebConnectorBrowserId;
      target: 'pair' | 'folder' | 'extensions';
    }): Promise<ConnectorReply> {
      if (input.target !== 'folder') {
        return service.openSetup(input.browserId, input.target);
      }
      try {
        const directory = await service.ensureDiagnosticsDirectory();
        const error = await dependencies.openDiagnosticsDirectory(directory);
        if (!error) return { ok: true };
        return {
          ok: false,
          message: `문제 해결 폴더를 열지 못했습니다. 폴더 접근 권한을 확인해 주세요: ${error}`,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : '알 수 없는 오류';
        return {
          ok: false,
          message: `문제 해결 폴더를 열지 못했습니다. 폴더 접근 권한을 확인해 주세요: ${detail}`,
        };
      }
    },
  };
}

export function registerWebConnectorHandlers(service: WebConnectorService): void {
  const actions = createWebConnectorHandlerActions(service);

  ipcMain.handle(IPC_CHANNELS.WEB_CONNECTOR_STATUS, (_event, input: unknown) => {
    assertWebConnectorStatusInput(input);
    return actions.status();
  });

  ipcMain.handle(IPC_CHANNELS.WEB_CONNECTOR_TEST, (_event, input: unknown) => {
    assertWebConnectorBrowserInput(input);
    return actions.test(input);
  });

  ipcMain.handle(IPC_CHANNELS.WEB_CONNECTOR_OPEN_SETUP, (_event, input: unknown) => {
    assertWebConnectorSetupInput(input);
    return actions.openSetup(input);
  });

  ipcMain.handle(IPC_CHANNELS.WEB_CONNECTOR_OPEN_APPROVAL, (_event, input: unknown) => {
    assertWebConnectorApprovalInput(input);
    return actions.openApprovalInbox(input);
  });
}
