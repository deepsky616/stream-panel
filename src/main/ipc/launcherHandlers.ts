import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { findActionPath, searchDeckItems } from '../../shared/search';
import type { LaunchResult } from '../../shared/types';
import {
  assertLauncherQueryInput,
  assertLauncherResizeInput,
  assertLauncherRunInput,
  assertNoInput,
} from '../security/inputValidation';
import { launchDeckItem } from '../services/launcher';
import type { ConfigStore } from '../store';
import { hideLauncherWindow, resizeLauncherWindow } from '../windows/launcherWindow';

export function registerLauncherHandlers(configStore: ConfigStore): void {
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_QUERY, (_event, input: unknown) => {
    assertLauncherQueryInput(input);
    const config = configStore.get();
    return searchDeckItems(config.root, input.text, config.grid);
  });
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_RUN, async (_event, input: unknown) => {
    assertLauncherRunInput(input);
    const config = configStore.get();
    const path = findActionPath(config.root, input.id);
    const result: LaunchResult = path
      ? await launchDeckItem(config.root, path, input.id)
      : {
          ok: false,
          code: 'NOT_FOUND',
          message: '실행할 항목을 찾을 수 없습니다. 런처를 다시 열어 최신 목록을 불러와 주세요.',
        };
    if (result.ok) hideLauncherWindow();
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_CLOSE, (_event, input: unknown) => {
    assertNoInput(input);
    hideLauncherWindow();
  });
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_RESIZE, (_event, input: unknown) => {
    assertLauncherResizeInput(input);
    resizeLauncherWindow(input.height);
  });
}
