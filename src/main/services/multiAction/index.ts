import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipcChannels';
import type { ActionItem, DeckItem, LaunchResult, MultiActionProgress } from '../../../shared/types';
import { MultiActionRunner } from './core';

function broadcastProgress(progress: MultiActionProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.MULTI_ACTION_PROGRESS, progress);
  }
}

const activeRunner = new MultiActionRunner({ onProgress: broadcastProgress });

export function startActiveMultiAction(
  item: ActionItem,
  root: readonly DeckItem[],
  launch: (item: ActionItem) => Promise<LaunchResult>,
): LaunchResult {
  return activeRunner.start(item, root, launch);
}

export function cancelActiveMultiAction(
  itemId: string,
): { ok: true } | { ok: false; message: string } {
  return activeRunner.cancel(itemId);
}
