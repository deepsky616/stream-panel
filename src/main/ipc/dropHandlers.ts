import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { assertDropClassifyInput, assertImportPathInput } from '../security/inputValidation';
import {
  classifyDroppedItems,
  createDropClassifierDependencies,
} from '../services/dropClassifier';
import { importCustomIcon } from '../services/customIconService';

export function registerDropHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DROP_CLASSIFY, (_event, input: unknown) => {
    assertDropClassifyInput(input);
    return classifyDroppedItems(input, createDropClassifierDependencies());
  });
  ipcMain.handle(IPC_CHANNELS.ICON_IMPORT_PATH, (_event, input: unknown) => {
    assertImportPathInput(input);
    return importCustomIcon(input, app.getPath('userData'));
  });
}
