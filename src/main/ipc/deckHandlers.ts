import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { duplicateItem, moveItem, removeItem, upsertItem } from '../../shared/tree';
import type { ConfigStore } from '../store';
import {
  assertDeckMoveInput,
  assertDeckReferenceInput,
  assertDeckUpsertInput,
} from '../security/inputValidation';
import { validateAppConfig, validateDeckItemShallow } from '../security/validate';
import { cleanupOrphanIcons } from '../services/iconCleanup';

function saveConfig(configStore: ConfigStore, config: ReturnType<ConfigStore['get']>) {
  const saved = configStore.set(config);
  void cleanupOrphanIcons(saved.root, app.getPath('userData'));
  return saved;
}

export function registerDeckHandlers(configStore: ConfigStore): void {
  ipcMain.handle(IPC_CHANNELS.DECK_UPSERT, (_event, input: unknown) => {
    assertDeckUpsertInput(input);
    validateDeckItemShallow(input.item);
    const current = configStore.get();
    const candidate = { ...current, root: upsertItem(current.root, input.path, input.item) };
    validateAppConfig(candidate);
    return saveConfig(configStore, candidate);
  });
  ipcMain.handle(IPC_CHANNELS.DECK_REMOVE, (_event, input: unknown) => {
    assertDeckReferenceInput(input);
    const current = configStore.get();
    const candidate = { ...current, root: removeItem(current.root, input.path, input.id) };
    validateAppConfig(candidate);
    return saveConfig(configStore, candidate);
  });
  ipcMain.handle(IPC_CHANNELS.DECK_MOVE, (_event, input: unknown) => {
    assertDeckMoveInput(input);
    const current = configStore.get();
    const candidate = { ...current, root: moveItem(current.root, input.from, input.to) };
    validateAppConfig(candidate);
    return saveConfig(configStore, candidate);
  });
  ipcMain.handle(IPC_CHANNELS.DECK_DUPLICATE, (_event, input: unknown) => {
    assertDeckReferenceInput(input);
    const current = configStore.get();
    const candidate = { ...current, root: duplicateItem(current.root, input.path, input.id) };
    validateAppConfig(candidate);
    return saveConfig(configStore, candidate);
  });
}
