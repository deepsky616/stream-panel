import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { assertIconResolveInput } from '../security/inputValidation';
import { resolveActionIcon, resolveCustomIcon } from '../services/iconService';

export function registerIconHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ICON_RESOLVE, (_event, input: unknown) => {
    assertIconResolveInput(input);
    if (input.target.startsWith('icon-file:')) {
      return resolveCustomIcon(input.target.slice('icon-file:'.length), app.getPath('userData'));
    }
    return resolveActionIcon(input.type, input.target, app.getPath('userData'));
  });
}
