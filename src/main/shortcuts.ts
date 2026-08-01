import { app, BrowserWindow, globalShortcut } from 'electron';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type { ConfigStore } from './store';
import { togglePanel } from './windows/panelWindow';

function notifyError(message: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.TOAST, { level: 'error', message });
  }
}

export function registerShortcuts(configStore: ConfigStore): () => void {
  let registered = '';
  let rollingBack = false;
  const register = (accelerator: string): boolean => {
    if (registered) globalShortcut.unregister(registered);
    const success = globalShortcut.register(accelerator, () => togglePanel());
    if (success) registered = accelerator;
    return success;
  };

  const initial = configStore.get().hotkey;
  if (!register(initial)) {
    notifyError('전역 단축키를 등록하지 못했습니다. 설정에서 다른 조합을 지정해 주세요.');
  }

  const unsubscribe = configStore.onDidChange((config) => {
    if (rollingBack || config.hotkey === registered) return;
    const previous = registered;
    if (register(config.hotkey)) return;
    rollingBack = true;
    if (previous) register(previous);
    configStore.set({ ...config, hotkey: previous || initial });
    rollingBack = false;
    notifyError('다른 앱이 사용 중인 단축키입니다. 이전 단축키로 되돌렸습니다.');
  });

  const cleanup = () => {
    unsubscribe();
    globalShortcut.unregisterAll();
  };
  app.once('will-quit', cleanup);
  return cleanup;
}
