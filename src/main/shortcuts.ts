import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import { normalizeAccelerator } from '../shared/accelerator';
import { assignHints } from '../shared/hintMap';
import { getPageSlots } from '../shared/layout';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { getItemsAtPath } from '../shared/tree';
import type { AppConfig, DeckItem, LaunchResult } from '../shared/types';
import { assertHotkeyValidateInput } from './security/inputValidation';
import { validateGlobalHotkey } from './security/validate';
import { launchDeckItem } from './services/launcher';
import type { ConfigStore } from './store';
import { getPanelWindow, showPanel, togglePanel } from './windows/panelWindow';

interface ActionReference {
  path: string[];
  id: string;
  label: string;
  accelerator?: string;
}

interface PanelLocation {
  path: string[];
  page: number;
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
  const modifier = normalizeAccelerator(config.keyboard.globalNumberModifier);
  return Array.from(
    { length: 10 },
    (_, index) => `${modifier}+${index === 9 ? 0 : index + 1}`,
  );
}

function readPanelLocation(): PanelLocation {
  const fallback = { path: [], page: 0 };
  const raw = getPanelWindow()?.webContents.getURL();
  if (!raw) return fallback;
  try {
    const marker = new URL(raw).hash.match(/^#panel=(.+)$/)?.[1];
    if (!marker) return fallback;
    const parsed = JSON.parse(decodeURIComponent(marker)) as Partial<PanelLocation>;
    if (
      !Array.isArray(parsed.path) ||
      parsed.path.some((id) => typeof id !== 'string' || id.length > 100) ||
      !Number.isInteger(parsed.page) ||
      Number(parsed.page) < 0
    ) {
      return fallback;
    }
    return { path: parsed.path, page: Number(parsed.page) };
  } catch {
    return fallback;
  }
}

async function reportShortcutLaunch(result: LaunchResult): Promise<void> {
  if (result.ok) return;
  showPanel();
  notifyError(result.message);
}

export function registerShortcuts(configStore: ConfigStore): () => void {
  let lastWorkingPanelHotkey = '';
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
    const location = readPanelLocation();
    let items: DeckItem[];
    try {
      items = getItemsAtPath(config.root, location.path);
    } catch {
      items = config.root;
      location.path = [];
      location.page = 0;
    }
    const assignments = assignHints(
      getPageSlots(items, config.grid, location.page, location.path.length > 0),
      config.keyboard.hintKeys,
    );
    const assignment = assignments[ordinal];
    if (!assignment) return;
    const item = items.find((candidate) => candidate.id === assignment.itemId);
    if (!item || item.kind === 'folder') return;
    await reportShortcutLaunch(
      await launchDeckItem(config.root, location.path, item.id),
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
      globalShortcut.unregisterAll();
      globalShortcut.register(previous, () => togglePanel());
      rollingBack = true;
      configStore.set({ ...config, hotkey: previous });
      rollingBack = false;
      notifyError('다른 앱이 사용 중인 단축키입니다. 이전 단축키로 되돌렸습니다.');
      return;
    } else {
      notifyError('패널 단축키를 등록하지 못했습니다. 설정에서 다른 조합을 지정해 주세요.');
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
      if (!success) failedNumberAccelerators.add(normalizeAccelerator(accelerator).toLowerCase());
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
    const normalizedInput = normalizeAccelerator(input.accelerator).toLowerCase();
    if (!input.itemId && config.keyboard.globalNumberHotkeys) {
      const numberIndex = numberAccelerators(config).findIndex(
        (accelerator) => normalizeAccelerator(accelerator).toLowerCase() === normalizedInput,
      );
      if (numberIndex >= 0) {
        return failedNumberAccelerators.has(normalizedInput)
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
        ...(config.keyboard.globalNumberHotkeys ? numberAccelerators(config) : []),
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
