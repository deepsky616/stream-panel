import { basename, dirname, extname } from 'node:path';
import { app, dialog, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { importCustomIcon } from '../services/customIconService';

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
    const selected = await pickPath(['openFile'], [
      { name: '실행 파일', extensions: ['exe', 'lnk'] },
    ]);
    if (!selected) return null;
    if (extname(selected).toLowerCase() === '.lnk') {
      if (process.platform !== 'win32') return null;
      try {
        const shortcut = shell.readShortcutLink(selected);
        return {
          target: shortcut.target,
          args:
            shortcut.args
              ?.match(/(?:[^\s"]+|"[^"]*")+/g)
              ?.map((value) => value.replace(/^"|"$/g, '')) ??
            [],
          workingDir: shortcut.cwd || dirname(shortcut.target),
          name: basename(selected, extname(selected)),
        };
      } catch {
        return null;
      }
    }
    return {
      target: selected,
      args: [],
      workingDir: dirname(selected),
      name: basename(selected, extname(selected)),
    };
  });
}
