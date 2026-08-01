import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ConfigStore } from '../store';
import {
  assertEditorOpenInput,
  assertIdleInput,
  assertRevealPathInput,
} from '../security/inputValidation';
import {
  applyPanelLayout,
  hidePanel,
  setPanelIdle,
  showPanel,
} from '../windows/panelWindow';
import { openEditorWindow } from '../windows/editorWindow';

export function registerWindowHandlers(configStore: ConfigStore): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW_HIDE, () => hidePanel());
  ipcMain.handle(IPC_CHANNELS.WINDOW_SHOW, () => showPanel(true));
  ipcMain.handle(IPC_CHANNELS.WINDOW_RELAYOUT, (event) => {
    const forceFooter = event.sender.getTitle().includes('[footer]');
    applyPanelLayout(configStore.get(), forceFooter);
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_IDLE, (_event, input: unknown) => {
    assertIdleInput(input);
    setPanelIdle(input);
  });
  ipcMain.handle(IPC_CHANNELS.EDITOR_OPEN, (_event, input: unknown) => {
    assertEditorOpenInput(input);
    openEditorWindow(input);
  });
  ipcMain.handle(IPC_CHANNELS.APP_INFO, () => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  }));
  ipcMain.handle(IPC_CHANNELS.SHELL_REVEAL, (_event, input: unknown) => {
    assertRevealPathInput(input);
    shell.showItemInFolder(input);
  });
}
