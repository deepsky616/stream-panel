import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ElectronStore from 'electron-store';
import { normalizeAccelerator } from '../shared/accelerator';
import { isEducationOfficeCode } from '../shared/educationOffices';
import { normalizeHintKeys } from '../shared/hintMap';
import { normalizeDeckPositions } from '../shared/layout';
import type {
  AppConfig,
  BehaviorConfig,
  DeckItem,
  GridConfig,
  KeyboardConfig,
  WindowConfig,
} from '../shared/types';

export const CURRENT_CONFIG_VERSION = 1;

export type RecoveryReason = 'future-version' | 'corrupt-json';

export interface ConfigRecoveryResult {
  config: AppConfig;
  recovered: boolean;
  reason?: RecoveryReason;
  backupText?: string;
}

function cloneConfig(config: AppConfig): AppConfig {
  return structuredClone(config) as AppConfig;
}

function looksLikeConfig(value: unknown): value is AppConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AppConfig>;
  return typeof candidate.version === 'number' && Array.isArray(candidate.root);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function partialObject<T extends object>(value: unknown): Partial<T> {
  return isRecord(value) ? (value as Partial<T>) : {};
}

function normalizeItemHotkeys(items: readonly DeckItem[]): DeckItem[] {
  return items.map((item): DeckItem => {
    const globalHotkey = item.globalHotkey
      ? normalizeAccelerator(item.globalHotkey)
      : item.globalHotkey;
    if (item.kind === 'action') return { ...item, globalHotkey };
    return {
      ...item,
      globalHotkey,
      children: normalizeItemHotkeys(item.children),
    };
  });
}

function migrateKnownConfig(parsed: AppConfig, defaultConfig: AppConfig): AppConfig {
  const behavior = partialObject<BehaviorConfig>(parsed.behavior);
  const keyboard = partialObject<KeyboardConfig>(parsed.keyboard);
  const grid = partialObject<GridConfig>(parsed.grid);
  const window = partialObject<WindowConfig>(parsed.window);
  const normalized = normalizeDeckPositions(parsed.root);
  const hintKeys = typeof keyboard.hintKeys === 'string' ? keyboard.hintKeys : defaultConfig.keyboard.hintKeys;
  const globalNumberModifier =
    typeof keyboard.globalNumberModifier === 'string'
      ? keyboard.globalNumberModifier
      : defaultConfig.keyboard.globalNumberModifier;

  return {
    ...defaultConfig,
    ...parsed,
    platform:
      parsed.platform === 'win32' || parsed.platform === 'darwin'
        ? parsed.platform
        : defaultConfig.platform,
    educationOfficeCode: isEducationOfficeCode(parsed.educationOfficeCode)
      ? parsed.educationOfficeCode
      : defaultConfig.educationOfficeCode,
    root: normalizeItemHotkeys(normalized.items),
    grid: { ...defaultConfig.grid, ...grid },
    window: { ...defaultConfig.window, ...window },
    behavior: { ...defaultConfig.behavior, ...behavior },
    keyboard: {
      ...defaultConfig.keyboard,
      ...keyboard,
      hintKeys: normalizeHintKeys(hintKeys),
      globalNumberModifier,
    },
    hotkey: normalizeAccelerator(
      typeof parsed.hotkey === 'string' ? parsed.hotkey : defaultConfig.hotkey,
    ),
  } as AppConfig;
}

export function recoverConfigText(
  text: string | undefined,
  defaultConfig: AppConfig,
): ConfigRecoveryResult {
  if (text === undefined) return { config: cloneConfig(defaultConfig), recovered: false };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!looksLikeConfig(parsed)) throw new SyntaxError('Invalid config shape');
    if (parsed.version > CURRENT_CONFIG_VERSION) {
      return {
        config: cloneConfig(defaultConfig),
        recovered: true,
        reason: 'future-version',
        backupText: text,
      };
    }
    const normalized = normalizeDeckPositions(parsed.root);
    return {
      config: migrateKnownConfig(parsed, defaultConfig),
      recovered: normalized.repaired,
    };
  } catch {
    return {
      config: cloneConfig(defaultConfig),
      recovered: true,
      reason: 'corrupt-json',
      backupText: text,
    };
  }
}

export interface ConfigStoreOptions {
  userDataPath: string;
  defaultConfig: AppConfig;
  now?: () => number;
  onWarning?: (message: string) => void;
}

export class ConfigStore {
  private readonly store: ElectronStore<AppConfig>;
  private readonly defaultConfig: AppConfig;

  constructor({
    userDataPath,
    defaultConfig,
    now = Date.now,
    onWarning = console.warn,
  }: ConfigStoreOptions) {
    this.defaultConfig = cloneConfig(defaultConfig);
    const configPath = join(userDataPath, 'config.json');
    const existingText = existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined;
    const recovery = recoverConfigText(existingText, defaultConfig);
    if (recovery.backupText !== undefined) {
      const backupPath = join(userDataPath, `config.backup-${now()}.json`);
      if (existsSync(configPath)) copyFileSync(configPath, backupPath);
      writeFileSync(configPath, JSON.stringify(recovery.config, null, 2), 'utf8');
      onWarning(
        recovery.reason === 'future-version'
          ? '더 높은 버전의 설정을 백업하고 기본값으로 복원했습니다.'
          : '손상된 설정을 백업하고 기본값으로 복원했습니다.',
      );
    }

    this.store = new ElectronStore<AppConfig>({
      cwd: userDataPath,
      name: 'config',
      defaults: recovery.config,
      migrations: {},
      clearInvalidConfig: false,
      watch: true,
    });
    this.store.store = recovery.config;
    if (recovery.recovered && !recovery.reason) {
      onWarning('손상된 키 위치를 앞에서부터 다시 배치했습니다.');
    }
  }

  get(): AppConfig {
    return cloneConfig(this.store.store);
  }

  set(config: AppConfig): AppConfig {
    this.store.store = cloneConfig(config);
    return this.get();
  }

  patch(patch: Partial<AppConfig>): AppConfig {
    return this.set({ ...this.get(), ...cloneConfig(patch as AppConfig) });
  }

  reset(defaultConfig: AppConfig = this.defaultConfig): AppConfig {
    return this.set(defaultConfig);
  }

  onDidChange(listener: (config: AppConfig) => void): () => void {
    return this.store.onDidAnyChange((config) => {
      if (config) listener(cloneConfig(config));
    });
  }
}
