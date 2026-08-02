import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import { buildNumberAccelerators, normalizeAccelerator } from '../shared/accelerator';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { searchDeckItems } from '../shared/search';
import type { AppConfig, DeckItem, LaunchResult } from '../shared/types';
import { assertHotkeyValidateInput } from './security/inputValidation';
import { validateGlobalHotkey } from './security/validate';
import { launchDeckItem } from './services/launcher';
import type { ConfigStore } from './store';
import { showLauncherWindow } from './windows/launcherWindow';
import { showPanel, togglePanel } from './windows/panelWindow';

interface ActionReference {
  path: string[];
  id: string;
  label: string;
  accelerator?: string;
}

function notifyError(message: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.TOAST, { level: 'error', message });
  }
}

function collectActions(items: readonly DeckItem[], path: readonly string[] = []): ActionReference[] {
  const references: ActionReference[] = [];
  for (const item of items) {
    if (item.kind === 'folder') {
      references.push(...collectActions(item.children, [...path, item.id]));
    } else {
      references.push({
        path: [...path],
        id: item.id,
        label: item.label,
        accelerator: item.globalHotkey,
      });
    }
  }
  return references;
}

function numberAccelerators(config: AppConfig): string[] {
  return buildNumberAccelerators(config.keyboard.globalNumberModifier);
}

function reservedNumberAccelerators(config: AppConfig): string[] {
  if (!config.keyboard.globalNumberHotkeys) return [];
  if (config.platform === 'darwin' && config.keyboard.globalNumberModifier === 'Control+Alt') {
    return [];
  }
  return numberAccelerators(config);
}

async function reportShortcutLaunch(result: LaunchResult): Promise<void> {
  if (result.ok) return;
  showPanel();
  notifyError(result.message);
}

export function registerShortcuts(configStore: ConfigStore): () => void {
  let lastWorkingPanelHotkey = '';
  let lastWorkingLauncherHotkey = '';
  let rollingBack = false;
  let disposed = false;
  const failedItemIds = new Set<string>();
  const failedNumberAccelerators = new Set<string>();

  const executeReference = async (reference: ActionReference): Promise<void> => {
    const config = configStore.get();
    await reportShortcutLaunch(
      await launchDeckItem(config.root, reference.path, reference.id),
    );
  };

  const executeNumber = async (ordinal: number): Promise<void> => {
    const config = configStore.get();
    const hint = ordinal === 9 ? '0' : String(ordinal + 1);
    const item = searchDeckItems(config.root, '', config.grid).find(
      (candidate) => candidate.hint === hint,
    );
    if (!item) return;
    await reportShortcutLaunch(
      await launchDeckItem(config.root, [], item.id),
    );
  };

  const registerAll = (config: AppConfig): void => {
    globalShortcut.unregisterAll();
    failedItemIds.clear();
    failedNumberAccelerators.clear();
    const panelAccelerator = normalizeAccelerator(config.hotkey);
    const panelRegistered = globalShortcut.register(panelAccelerator, () => togglePanel());
    if (panelRegistered) {
      lastWorkingPanelHotkey = panelAccelerator;
    } else if (!rollingBack && lastWorkingPanelHotkey && panelAccelerator !== lastWorkingPanelHotkey) {
      const previous = lastWorkingPanelHotkey;
      rollingBack = true;
      const restored = { ...config, hotkey: previous };
      configStore.set(restored);
      registerAll(restored);
      rollingBack = false;
      notifyError('다른 앱이 사용 중인 단축키입니다. 이전 단축키로 되돌렸습니다.');
      return;
    } else {
      notifyError('패널 단축키를 등록하지 못했습니다. 설정에서 다른 조합을 지정해 주세요.');
    }

    if (config.keyboard.quickLauncher) {
      const launcherAccelerator = normalizeAccelerator(config.keyboard.quickLauncherHotkey);
      const launcherRegistered = globalShortcut.register(launcherAccelerator, () => {
        void showLauncherWindow();
      });
      if (launcherRegistered) {
        lastWorkingLauncherHotkey = launcherAccelerator;
      } else if (
        !rollingBack &&
        lastWorkingLauncherHotkey &&
        launcherAccelerator !== lastWorkingLauncherHotkey
      ) {
        rollingBack = true;
        const restored = {
          ...config,
          keyboard: {
            ...config.keyboard,
            quickLauncherHotkey: lastWorkingLauncherHotkey,
          },
        };
        configStore.set(restored);
        registerAll(restored);
        rollingBack = false;
        notifyError('퀵 런처 단축키가 다른 앱과 충돌해 이전 단축키로 되돌렸습니다.');
        return;
      } else {
        notifyError('퀵 런처 단축키를 등록하지 못했습니다. 설정에서 다른 조합을 지정해 주세요.');
      }
    }

    const actions = collectActions(config.root);
    for (const reference of actions) {
      if (!reference.accelerator) continue;
      const accelerator = normalizeAccelerator(reference.accelerator);
      const success = globalShortcut.register(accelerator, () => {
        void executeReference(reference);
      });
      if (!success) {
        failedItemIds.add(reference.id);
        notifyError(`'${reference.label}' 키의 전역 단축키가 다른 프로그램과 충돌합니다.`);
      }
    }

    if (!config.keyboard.globalNumberHotkeys) return;
    numberAccelerators(config).forEach((accelerator, index) => {
      const success = globalShortcut.register(accelerator, () => {
        void executeNumber(index);
      });
      if (!success) failedNumberAccelerators.add(accelerator.toLowerCase());
    });
  };

  registerAll(configStore.get());
  const unsubscribe = configStore.onDidChange((config) => {
    if (!rollingBack && !disposed) registerAll(config);
  });

  ipcMain.handle(IPC_CHANNELS.HOTKEY_VALIDATE, (_event, input: unknown) => {
    assertHotkeyValidateInput(input);
    const config = configStore.get();
    const actions = collectActions(config.root);
    const current = actions.find((reference) => reference.id === input.itemId);
    if (!input.itemId && config.keyboard.globalNumberHotkeys) {
      const numberIndex = numberAccelerators(config).findIndex(
        (accelerator) => accelerator.toLowerCase() === input.accelerator.toLowerCase(),
      );
      if (numberIndex >= 0) {
        return failedNumberAccelerators.has(input.accelerator.toLowerCase())
          ? { ok: false, reason: '다른 프로그램이 이미 사용 중인 단축키입니다.' } as const
          : { ok: true } as const;
      }
    }
    const conflicts = actions
      .filter((reference) => reference.accelerator && reference.id !== input.itemId)
      .map((reference) => ({
        accelerator: reference.accelerator!,
        label: reference.label,
      }));
    const validation = validateGlobalHotkey(input.accelerator, {
      conflicts,
      reserved: [
        config.hotkey,
        config.keyboard.quickLauncherHotkey,
        ...reservedNumberAccelerators(config),
      ],
      assignedCount: input.itemId
        ? actions.filter(
            (reference) => reference.accelerator && reference.id !== input.itemId,
          ).length
        : 0,
    });
    if (!validation.ok) return validation;
    if (
      current?.accelerator &&
      normalizeAccelerator(current.accelerator).toLowerCase() ===
        validation.accelerator.toLowerCase()
    ) {
      return failedItemIds.has(current.id)
        ? { ok: false, reason: '다른 프로그램이 이미 사용 중인 단축키입니다.' } as const
        : { ok: true } as const;
    }
    const available = globalShortcut.register(validation.accelerator, () => undefined);
    if (!available) {
      return { ok: false, reason: '다른 프로그램이 이미 사용 중인 단축키입니다.' } as const;
    }
    globalShortcut.unregister(validation.accelerator);
    return { ok: true } as const;
  });

  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    ipcMain.removeHandler(IPC_CHANNELS.HOTKEY_VALIDATE);
    globalShortcut.unregisterAll();
  };
  app.once('will-quit', cleanup);
  return cleanup;
}
