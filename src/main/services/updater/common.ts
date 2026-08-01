import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipcChannels';
import type { UpdateStatusPayload } from './types';

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function broadcastUpdateStatus(payload: UpdateStatusPayload): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.UPDATE_STATUS, payload);
  }
}
