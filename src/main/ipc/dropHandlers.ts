import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { assertDropClassifyInput, assertImportPathInput } from '../security/inputValidation';
import { classifyDroppedItems } from '../services/dropClassifier';
import { importCustomIcon } from '../services/customIconService';

export function registerDropHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DROP_CLASSIFY, (_event, input: unknown) => {
    assertDropClassifyInput(input);
    return classifyDroppedItems(input, {
      platform: process.platform,
      getStats: async (path) => {
        const { stat } = await import('node:fs/promises');
        return stat(path);
      },
      readShortcut: (path) => {
        if (process.platform !== 'win32') throw new Error('Unsupported platform');
        return shell.readShortcutLink(path);
      },
    });
  });
  ipcMain.handle(IPC_CHANNELS.ICON_IMPORT_PATH, (_event, input: unknown) => {
    assertImportPathInput(input);
    return importCustomIcon(input, app.getPath('userData'));
  });
}
