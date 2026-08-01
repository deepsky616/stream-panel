import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ConfigStore } from '../store';
import { assertLaunchInput } from '../security/inputValidation';
import { launchDeckItem } from '../services/launcher';
import { createVisibilityService } from '../services/visibility';
import { getEditorWindow } from '../windows/editorWindow';
import { hidePanel } from '../windows/panelWindow';

export function registerLaunchHandlers(configStore: ConfigStore): void {
  const visibility = createVisibilityService({
    hidePanel,
    setTimer: (handler, delay) => setTimeout(handler, delay),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  ipcMain.handle(IPC_CHANNELS.BUTTON_LAUNCH, async (event, input: unknown) => {
    assertLaunchInput(input);
    const config = configStore.get();
    const result = await launchDeckItem(config.root, input.path, input.id);
    if (!result.ok) {
      event.sender.send(IPC_CHANNELS.TOAST, { level: 'error', message: result.message });
    }
    const editor = getEditorWindow();
    visibility.afterLaunch(config, result, {
      keepOpen: input.keepOpen,
      editorOpen: Boolean(editor && !editor.isDestroyed()),
    });
    return result;
  });
}
