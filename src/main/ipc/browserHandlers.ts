import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { assertBrowsersListInput } from '../security/inputValidation';
import { createBrowserService } from '../services/browserService';

export function registerBrowserHandlers(): void {
  const service = createBrowserService({
    userDataPath: app.getPath('userData'),
    homePath: app.getPath('home'),
    getIcon: async (path) => {
      try {
        const image = await app.getFileIcon(path, { size: 'normal' });
        return image.isEmpty() ? undefined : image.toDataURL();
      } catch {
        return undefined;
      }
    },
  });
  ipcMain.handle(IPC_CHANNELS.BROWSERS_LIST, (_event, input: unknown) => {
    assertBrowsersListInput(input);
    return service.list(input.refresh);
  });
}
