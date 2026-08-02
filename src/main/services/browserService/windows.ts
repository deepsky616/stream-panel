import type { ActionItem, DetectedBrowser, LaunchResult } from '../../../shared/types';
import type { LauncherDependencies } from '../launcher/common';
import { buildBrowserFlags } from './flags';
import { inferBrowserFamily } from './detect';
import { win32 } from 'node:path';
import type { BrowserCandidate } from './types';

const FALLBACK_MESSAGE = '지정한 브라우저를 찾을 수 없어 기본 브라우저로 열었습니다.';

export function getWindowsBrowserCandidates(env: NodeJS.ProcessEnv): BrowserCandidate[] {
  const local = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env['ProgramFiles(x86)'];
  const candidates: BrowserCandidate[] = [];
  const add = (
    id: BrowserCandidate['id'],
    name: string,
    path: string | undefined,
    relativePath: string,
    profileRelative?: string,
  ) => {
    if (!path) return;
    candidates.push({
      id,
      name,
      path: win32.join(path, relativePath),
      family: id === 'firefox' ? 'firefox' : 'chromium',
      supportsAppMode: id !== 'firefox',
      supportsProfiles: id !== 'firefox',
      ...(profileRelative && local
        ? { localStatePath: win32.join(local, profileRelative, 'Local State') }
        : {}),
    });
  };
  add('chrome', 'Google Chrome', programFiles, 'Google/Chrome/Application/chrome.exe', 'Google/Chrome/User Data');
  add('chrome', 'Google Chrome', programFilesX86, 'Google/Chrome/Application/chrome.exe', 'Google/Chrome/User Data');
  add('chrome', 'Google Chrome', local, 'Google/Chrome/Application/chrome.exe', 'Google/Chrome/User Data');
  add('edge', 'Microsoft Edge', programFilesX86, 'Microsoft/Edge/Application/msedge.exe', 'Microsoft/Edge/User Data');
  add('edge', 'Microsoft Edge', programFiles, 'Microsoft/Edge/Application/msedge.exe', 'Microsoft/Edge/User Data');
  add('whale', 'Naver Whale', programFilesX86, 'Naver/Naver Whale/Application/whale.exe', 'Naver/Naver Whale/User Data');
  add('whale', 'Naver Whale', local, 'Naver/Naver Whale/Application/whale.exe', 'Naver/Naver Whale/User Data');
  add('firefox', 'Firefox', programFiles, 'Mozilla Firefox/firefox.exe');
  add('firefox', 'Firefox', programFilesX86, 'Mozilla Firefox/firefox.exe');
  return candidates;
}

async function fallback(item: ActionItem, dependencies: LauncherDependencies): Promise<LaunchResult> {
  await dependencies.openExternal(item.target);
  dependencies.notifyWarning(FALLBACK_MESSAGE);
  return { ok: true };
}

export async function launchWindowsBrowser(
  item: ActionItem & { browser: NonNullable<ActionItem['browser']> },
  dependencies: LauncherDependencies,
): Promise<LaunchResult> {
  if (!dependencies.exists(item.browser.path)) return fallback(item, dependencies);
  const family = inferBrowserFamily(item.browser.path);
  const browser: Pick<DetectedBrowser, 'family'> = { family };
  try {
    const child = dependencies.spawnProcess(
      item.browser.path,
      buildBrowserFlags(browser, item.browser, item.target),
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    return { ok: true };
  } catch {
    return fallback(item, dependencies);
  }
}
