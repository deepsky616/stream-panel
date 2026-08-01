import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { assertAppsListInput } from '../security/inputValidation';
import { AppScanner } from '../services/appScanner';

export function registerAppHandlers(): void {
  const scanner = new AppScanner({ userDataPath: app.getPath('userData') });
  ipcMain.handle(IPC_CHANNELS.APPS_LIST, (_event, input: unknown) => {
    assertAppsListInput(input);
    return scanner.list(input.refresh ?? false);
  });
}
