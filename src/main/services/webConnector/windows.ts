import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import type { WebConnectorBrowserId } from '../../../shared/types';

export interface ResolveWindowsManagedBrowserOptions {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

export function resolveWindowsManagedBrowserExecutable(
  browserId: WebConnectorBrowserId,
  {
    env = process.env,
    exists = existsSync,
  }: ResolveWindowsManagedBrowserOptions = {},
): string | null {
  const roots = browserId === 'edge'
    ? [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA]
    : [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA];
  const relative = browserId === 'edge'
    ? 'Microsoft/Edge/Application/msedge.exe'
    : 'Google/Chrome/Application/chrome.exe';
  for (const root of roots) {
    if (!root) continue;
    const candidate = win32.join(root, relative);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function resolveWindowsConnectorBrowserExecutable(
  browserPath: string,
  exists: (path: string) => boolean,
): string | null {
  return exists(browserPath) ? browserPath : null;
}
