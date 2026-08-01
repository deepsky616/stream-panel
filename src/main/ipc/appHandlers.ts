import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { assertAppsListInput } from '../security/inputValidation';

export function registerAppHandlers(): void {
  let scanner: Awaited<ReturnType<typeof loadScanner>> | null = null;
  ipcMain.handle(IPC_CHANNELS.APPS_LIST, async (_event, input: unknown) => {
    assertAppsListInput(input);
    scanner ??= await loadScanner();
    return scanner.list(input.refresh ?? false);
  });
}

async function loadScanner() {
  const { createAppScanner } = await import('../services/appScanner');
  return createAppScanner({
    userDataPath: app.getPath('userData'),
    platform: process.platform,
  });
}
