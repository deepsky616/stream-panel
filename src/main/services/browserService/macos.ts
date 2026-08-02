import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import type { ActionItem, DetectedBrowser, LaunchResult } from '../../../shared/types';
import type { LauncherDependencies } from '../launcher/common';
import { buildBrowserFlags } from './flags';
import { inferBrowserFamily } from './detect';
import type { BrowserCandidate } from './types';

const FALLBACK_MESSAGE = '지정한 브라우저를 찾을 수 없어 기본 브라우저로 열었습니다.';

export function getMacosBrowserCandidates(homePath: string): BrowserCandidate[] {
  const applications = ['/Applications', posix.join(homePath, 'Applications')];
  const candidates: BrowserCandidate[] = [];
  const addChromium = (
    id: 'chrome' | 'edge' | 'whale',
    name: string,
    bundleName: string,
    profileRelative: string,
  ) => {
    for (const root of applications) {
      candidates.push({
        id,
        name,
        path: posix.join(root, bundleName),
        family: 'chromium',
        supportsAppMode: true,
        supportsProfiles: true,
        localStatePath: posix.join(
          homePath,
          'Library',
          'Application Support',
          profileRelative,
          'Local State',
        ),
      });
    }
  };
  addChromium('chrome', 'Google Chrome', 'Google Chrome.app', 'Google/Chrome');
  addChromium('edge', 'Microsoft Edge', 'Microsoft Edge.app', 'Microsoft Edge');
  addChromium('whale', 'Naver Whale', 'Naver Whale.app', 'Naver/Whale');
  for (const root of applications) {
    candidates.push({
      id: 'firefox',
      name: 'Firefox',
      path: posix.join(root, 'Firefox.app'),
      family: 'firefox',
      supportsAppMode: false,
      supportsProfiles: false,
    });
  }
  for (const path of ['/Applications/Safari.app', '/System/Applications/Safari.app']) {
    candidates.push({
      id: 'safari',
      name: 'Safari',
      path,
      family: 'safari',
      supportsAppMode: false,
      supportsProfiles: false,
    });
  }
  return candidates;
}

export async function resolveMacBrowserExecutable(bundlePath: string): Promise<string | null> {
  const plistPath = posix.join(bundlePath, 'Contents', 'Info.plist');
  const executable = await new Promise<string>((resolve) => {
    execFile(
      'plutil',
      ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plistPath],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout.trim()),
    );
  });
  if (!executable || executable.length > 255 || /[\\/]/.test(executable)) return null;
  return posix.join(bundlePath, 'Contents', 'MacOS', executable);
}

async function fallback(item: ActionItem, dependencies: LauncherDependencies): Promise<LaunchResult> {
  await dependencies.openExternal(item.target);
  dependencies.notifyWarning(FALLBACK_MESSAGE);
  return { ok: true };
}

export async function launchMacosBrowser(
  item: ActionItem & { browser: NonNullable<ActionItem['browser']> },
  dependencies: LauncherDependencies,
): Promise<LaunchResult> {
  if (!dependencies.exists(item.browser.path)) return fallback(item, dependencies);
  const executable = await dependencies.resolveMacBundleExecutable(item.browser.path);
  if (!executable || !dependencies.exists(executable)) return fallback(item, dependencies);
  const family = inferBrowserFamily(item.browser.path);
  const browser: Pick<DetectedBrowser, 'family'> = { family };
  try {
    const child = dependencies.spawnProcess(
      executable,
      buildBrowserFlags(browser, item.browser, item.target),
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    return { ok: true };
  } catch {
    return fallback(item, dependencies);
  }
}
