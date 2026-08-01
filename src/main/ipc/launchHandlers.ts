import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ConfigStore } from '../store';
import { assertDeckReferenceInput } from '../security/inputValidation';
import { launchDeckItem } from '../services/launcher';

export function registerLaunchHandlers(configStore: ConfigStore): void {
  ipcMain.handle(IPC_CHANNELS.BUTTON_LAUNCH, async (event, input: unknown) => {
    assertDeckReferenceInput(input);
    const result = await launchDeckItem(configStore.get().root, input.path, input.id);
    if (!result.ok) {
      event.sender.send(IPC_CHANNELS.TOAST, { level: 'error', message: result.message });
    }
    return result;
  });
}
