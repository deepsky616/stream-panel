import { realpath, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { ActionItem } from '../../../shared/types';
import { classifyMacosPath } from './macos';
import { classifyWindowsPath, readWindowsShortcut } from './windows';

export interface ShortcutDetails {
  target: string;
  args?: string;
  cwd?: string;
}

export interface DropClassifierDependencies {
  platform: NodeJS.Platform;
  realpath: (path: string) => Promise<string>;
  getStats: (path: string) => Promise<Pick<Stats, 'isDirectory'>>;
  readShortcut: (path: string) => ShortcutDetails;
}

export type DroppedAction = Partial<ActionItem>;

const defaultDependencies: DropClassifierDependencies = {
  platform: process.platform,
  realpath,
  getStats: stat,
  readShortcut: process.platform === 'win32' ? readWindowsShortcut : () => ({ target: '' }),
};

export function createDropClassifierDependencies(
  platform: NodeJS.Platform = process.platform,
): DropClassifierDependencies {
  return {
    platform,
    realpath,
    getStats: stat,
    readShortcut: platform === 'win32' ? readWindowsShortcut : () => ({ target: '' }),
  };
}

export function splitDroppedArguments(value: string | undefined): string[] {
  return value?.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

export function parseDroppedUrl(text: string | undefined): URL | null {
  if (!text) return null;
  const candidate = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export async function classifyDroppedItems(
  input: { paths: string[]; text?: string },
  dependencies: DropClassifierDependencies = defaultDependencies,
): Promise<DroppedAction[]> {
  const results: DroppedAction[] = [];

  for (const droppedPath of input.paths) {
    try {
      const item =
        dependencies.platform === 'win32'
          ? await classifyWindowsPath(droppedPath, dependencies)
          : dependencies.platform === 'darwin'
            ? await classifyMacosPath(droppedPath, dependencies)
            : null;
      if (item) results.push(item);
    } catch {
      continue;
    }
  }

  const url = parseDroppedUrl(input.text);
  if (url) {
    results.push({
      kind: 'action',
      type: 'url',
      target: url.href,
      label: url.hostname.slice(0, 24),
      args: [],
    });
  }
  return results;
}
