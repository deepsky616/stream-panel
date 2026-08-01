import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { shell } from 'electron';
import type { InstalledApp } from '../../shared/types';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const EXCLUDED_WORDS = [
  'uninstall',
  '제거',
  'unins00',
  'readme',
  'help',
  '설명서',
  'license',
  'changelog',
  'website',
  '홈페이지',
];

export interface ShortcutData {
  target?: string;
  cwd?: string;
  args?: string;
}

export function shouldIncludeShortcut(linkPath: string, shortcut: ShortcutData): boolean {
  if (!shortcut.target || extname(shortcut.target).toLowerCase() !== '.exe') return false;
  const haystack = `${basename(linkPath)} ${shortcut.target}`.toLowerCase();
  return !EXCLUDED_WORDS.some((word) => haystack.includes(word.toLowerCase()));
}

function splitArguments(value: string | undefined): string[] {
  return value?.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

export function parseStoreApps(output: string): InstalledApp[] {
  try {
    const parsed: unknown = JSON.parse(output);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value): InstalledApp[] => {
      if (!value || typeof value !== 'object') return [];
      const item = value as { Name?: unknown; AppID?: unknown };
      if (typeof item.Name !== 'string' || typeof item.AppID !== 'string' || !item.AppID.includes('!')) {
        return [];
      }
      return [
        {
          name: item.Name,
          type: 'uwp',
          target: item.AppID,
          args: [],
          source: 'store',
        },
      ];
    });
  } catch {
    return [];
  }
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

async function collectLinks(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry): Promise<string[]> => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectLinks(path);
        return entry.isFile() && extname(entry.name).toLowerCase() === '.lnk' ? [path] : [];
      }),
    );
    return nested.flat();
  } catch {
    return [];
  }
}

interface CacheDocument {
  timestamp: number;
  apps: InstalledApp[];
}

export interface AppScannerOptions {
  userDataPath: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export class AppScanner {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly cachePath: string;
  private memoryCache: CacheDocument | null = null;

  constructor({
    userDataPath,
    platform = process.platform,
    env = process.env,
    now = Date.now,
  }: AppScannerOptions) {
    this.platform = platform;
    this.env = env;
    this.now = now;
    this.cachePath = join(userDataPath, 'cache', 'apps.json');
  }

  async list(refresh = false): Promise<InstalledApp[]> {
    if (this.platform !== 'win32') return [];
    if (!refresh) {
      const cached = await this.readCache();
      if (cached) return cached;
    }
    const [shortcuts, storeApps] = await Promise.all([this.scanShortcuts(), this.scanStoreApps()]);
    const apps = deduplicateApps([...shortcuts, ...storeApps]).sort((left, right) =>
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
      if (!Array.isArray(parsed.apps) || this.now() - parsed.timestamp >= CACHE_TTL_MS) return null;
      this.memoryCache = parsed;
      return parsed.apps;
    } catch {
      return null;
    }
  }

  private async scanShortcuts(): Promise<InstalledApp[]> {
    if (this.platform !== 'win32') return [];
    const roots = [
      this.env.ProgramData
        ? join(this.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        : null,
      this.env.APPDATA
        ? join(this.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        : null,
    ].filter((value): value is string => Boolean(value));
    const links = (await Promise.all(roots.map(collectLinks))).flat();
    const apps: InstalledApp[] = [];
    for (const linkPath of links) {
      try {
        const shortcut = shell.readShortcutLink(linkPath);
        if (!shouldIncludeShortcut(linkPath, shortcut)) continue;
        await access(shortcut.target);
        apps.push({
          name: basename(linkPath, extname(linkPath)),
          type: 'app',
          target: shortcut.target,
          args: splitArguments(shortcut.args),
          workingDir: shortcut.cwd || undefined,
          source: 'start-menu',
        });
      } catch {
        continue;
      }
    }
    return apps;
  }

  private scanStoreApps(): Promise<InstalledApp[]> {
    if (this.platform !== 'win32') return Promise.resolve([]);
    const command =
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress';
    return new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
        (error, stdout) => resolve(error ? [] : parseStoreApps(stdout)),
      );
    });
  }
}
