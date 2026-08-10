import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ConfigStore } from '../store';
import { assertConfigPatch } from '../security/inputValidation';
import { validateAppConfig } from '../security/validate';
import { applyPanelLayout } from '../windows/panelWindow';

export function broadcastConfig(configStore: ConfigStore): void {
  const config = configStore.get();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.CONFIG_CHANGED, config);
  }
}

export function registerConfigHandlers(configStore: ConfigStore): void {
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, () => configStore.get());
  ipcMain.handle(IPC_CHANNELS.CONFIG_SET, (_event, input: unknown) => {
    assertConfigPatch(input);
    const candidate = { ...configStore.get(), ...input };
    validateAppConfig(candidate);
    const config = configStore.set(candidate);
    applyPanelLayout(config);
    broadcastConfig(configStore);
    return config;
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_RESET, () => {
    const reset = configStore.reset();
    applyPanelLayout(reset);
    broadcastConfig(configStore);
    return reset;
  });
}
