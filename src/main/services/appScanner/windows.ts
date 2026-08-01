import { access, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import type { InstalledApp } from '../../../shared/types';
import type {
  AppScannerBackend,
  ScannerDirectoryEntry,
  ShortcutData,
  WindowsScannerDependencies,
} from './types';

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

export function shouldIncludeShortcut(linkPath: string, shortcut: ShortcutData): boolean {
  if (!shortcut.target || win32.extname(shortcut.target).toLowerCase() !== '.exe') return false;
  const haystack = `${win32.basename(linkPath)} ${shortcut.target}`.toLowerCase();
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
      return [{
        name: item.Name,
        type: 'uwp',
        target: item.AppID,
        args: [],
        source: 'store',
      }];
    });
  } catch {
    return [];
  }
}

async function defaultReadShortcut(path: string): Promise<ShortcutData> {
  const { shell } = await import('electron');
  return shell.readShortcutLink(path);
}

function defaultRunStoreCommand(): Promise<string | null> {
  const command =
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

const defaultDependencies: WindowsScannerDependencies = {
  readdir: async (path) => readdir(path, { withFileTypes: true }) as unknown as ScannerDirectoryEntry[],
  access,
  readShortcut: defaultReadShortcut,
  runStoreCommand: defaultRunStoreCommand,
};

async function collectLinks(
  directory: string,
  dependencies: WindowsScannerDependencies,
): Promise<string[]> {
  try {
    const entries = await dependencies.readdir(directory);
    const nested = await Promise.all(entries.map(async (entry): Promise<string[]> => {
      const path = win32.join(directory, entry.name);
      if (entry.isDirectory()) return collectLinks(path, dependencies);
      return entry.isFile?.() !== false && win32.extname(entry.name).toLowerCase() === '.lnk'
        ? [path]
        : [];
    }));
    return nested.flat();
  } catch {
    return [];
  }
}

export class WindowsAppScanner implements AppScannerBackend {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly dependencies: WindowsScannerDependencies = defaultDependencies,
  ) {}

  async scan(): Promise<InstalledApp[]> {
    const roots = [
      this.env.ProgramData
        ? win32.join(this.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        : null,
      this.env.APPDATA
        ? win32.join(this.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
        : null,
    ].filter((value): value is string => Boolean(value));

    const [links, storeOutput] = await Promise.all([
      Promise.all(roots.map((root) => collectLinks(root, this.dependencies))).then((items) => items.flat()),
      this.dependencies.runStoreCommand().catch(() => null),
    ]);
    const apps: InstalledApp[] = [];
    for (const linkPath of links) {
      try {
        const shortcut = await this.dependencies.readShortcut(linkPath);
        if (!shouldIncludeShortcut(linkPath, shortcut) || !shortcut.target) continue;
        await this.dependencies.access(shortcut.target);
        apps.push({
          name: win32.basename(linkPath, win32.extname(linkPath)),
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
    if (storeOutput) apps.push(...parseStoreApps(storeOutput));
    return apps;
  }
}
