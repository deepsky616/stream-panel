import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ElectronStore from 'electron-store';
import { normalizeDeckPositions } from '../shared/layout';
import type { AppConfig } from '../shared/types';

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
    return { config: { ...parsed, root: normalized.items }, recovered: normalized.repaired };
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

  constructor({
    userDataPath,
    defaultConfig,
    now = Date.now,
    onWarning = console.warn,
  }: ConfigStoreOptions) {
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

  reset(defaultConfig: AppConfig): AppConfig {
    return this.set(defaultConfig);
  }
}
