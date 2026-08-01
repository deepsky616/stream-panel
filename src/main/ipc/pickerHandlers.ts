import { app, dialog, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { importCustomIcon } from '../services/customIconService';
import {
  getExecutableDialogOptions,
  resolveExecutableSelection,
} from '../services/executablePicker';

async function pickPath(
  properties: Array<'openFile' | 'openDirectory'>,
  filters?: Electron.FileFilter[],
): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties, filters });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function registerPickerHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PICKER_FOLDER, () => pickPath(['openDirectory']));
  ipcMain.handle(IPC_CHANNELS.PICKER_FILE, () => pickPath(['openFile']));
  ipcMain.handle(IPC_CHANNELS.PICKER_IMAGE, async () => {
    const selected = await pickPath(['openFile'], [
      { name: '아이콘 이미지', extensions: ['png', 'jpg', 'jpeg', 'ico', 'bmp', 'webp'] },
    ]);
    return selected ? importCustomIcon(selected, app.getPath('userData')) : null;
  });
  ipcMain.handle(IPC_CHANNELS.PICKER_EXECUTABLE, async () => {
    const options = getExecutableDialogOptions(process.platform);
    if (!options) return null;
    const selected = await pickPath(options.properties, options.filters);
    return selected
      ? resolveExecutableSelection(selected, process.platform, {
          readShortcutLink: (path) => shell.readShortcutLink(path),
        })
      : null;
  });
}
