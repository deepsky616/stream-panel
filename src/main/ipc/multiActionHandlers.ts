import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { assertMultiActionCancelInput } from '../security/inputValidation';
import { cancelActiveMultiAction } from '../services/multiAction';

export function registerMultiActionHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MULTI_ACTION_CANCEL, (_event, input: unknown) => {
    assertMultiActionCancelInput(input);
    return cancelActiveMultiAction(input.itemId);
  });
}
