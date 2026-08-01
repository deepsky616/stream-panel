import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { InstalledApp } from '../../../shared/types';
import { MacAppScanner } from './macos';
import type {
  AppScanner,
  AppScannerBackend,
  MacScannerDependencies,
  WindowsScannerDependencies,
} from './types';
import { WindowsAppScanner } from './windows';

export { parseStoreApps, shouldIncludeShortcut } from './windows';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheDocument {
  timestamp: number;
  apps: InstalledApp[];
}

export interface CreateAppScannerOptions {
  userDataPath: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homePath?: string;
  now?: () => number;
  windowsDependencies?: WindowsScannerDependencies;
  macDependencies?: MacScannerDependencies;
}

export function deduplicateApps(apps: readonly InstalledApp[]): InstalledApp[] {
  const seen = new Set<string>();
  return apps.filter((app) => {
    const key = app.name.trim().toLocaleLowerCase('ko-KR');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

class NullAppScanner implements AppScannerBackend {
  async scan(): Promise<InstalledApp[]> {
    return [];
  }
}

class CachedAppScanner implements AppScanner {
  private readonly cachePath: string;
  private memoryCache: CacheDocument | null = null;

  constructor(
    private readonly backend: AppScannerBackend,
    userDataPath: string,
    private readonly now: () => number,
  ) {
    this.cachePath = join(userDataPath, 'cache', 'apps.json');
  }

  async list(refresh = false): Promise<InstalledApp[]> {
    if (!refresh) {
      const cached = await this.readCache();
      if (cached) return cached;
    }
    let scanned: InstalledApp[] = [];
    try {
      scanned = await this.backend.scan();
    } catch {
      scanned = [];
    }
    const apps = deduplicateApps(scanned).sort((left, right) =>
      left.name.localeCompare(right.name, 'ko-KR'),
    );
    const document = { timestamp: this.now(), apps };
    this.memoryCache = document;
    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      await writeFile(this.cachePath, JSON.stringify(document), 'utf8');
    } catch {
      // Cache failures must not block the library.
    }
    return apps;
  }

  private async readCache(): Promise<InstalledApp[] | null> {
    if (this.memoryCache && this.now() - this.memoryCache.timestamp < CACHE_TTL_MS) {
      return this.memoryCache.apps;
    }
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, 'utf8')) as CacheDocument;
      if (
        !Number.isFinite(parsed.timestamp) ||
        !Array.isArray(parsed.apps) ||
        this.now() - parsed.timestamp >= CACHE_TTL_MS
      ) {
        return null;
      }
      this.memoryCache = parsed;
      return parsed.apps;
    } catch {
      return null;
    }
  }
}

export function createAppScanner({
  userDataPath,
  platform = process.platform,
  env = process.env,
  homePath = homedir(),
  now = Date.now,
  windowsDependencies,
  macDependencies,
}: CreateAppScannerOptions): AppScanner {
  const backend =
    platform === 'win32'
      ? new WindowsAppScanner(env, windowsDependencies)
      : platform === 'darwin'
        ? new MacAppScanner(homePath, macDependencies)
        : new NullAppScanner();
  return new CachedAppScanner(backend, userDataPath, now);
}
