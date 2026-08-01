import { posix, win32 } from 'node:path';
import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import type { ActionItem } from '../../shared/types';

export interface ShortcutDetails {
  target: string;
  args?: string;
  cwd?: string;
}

export interface DropClassifierDependencies {
  platform: NodeJS.Platform;
  getStats: (path: string) => Promise<Pick<Stats, 'isDirectory'>>;
  readShortcut: (path: string) => ShortcutDetails;
}

const defaultDependencies: DropClassifierDependencies = {
  platform: process.platform,
  getStats: stat,
  readShortcut: () => {
    throw new Error('Shortcut reading is not available');
  },
};

function splitArguments(value: string | undefined): string[] {
  return value?.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

function labelFromPath(target: string): string {
  const path = win32.isAbsolute(target) ? win32 : posix;
  const extension = path.extname(target);
  return path.basename(target, extension).slice(0, 24) || '새 키';
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
): Promise<Partial<ActionItem>[]> {
  const results: Partial<ActionItem>[] = [];
  for (const droppedPath of input.paths) {
    try {
      const path = win32.isAbsolute(droppedPath) ? win32 : posix;
      const details = await dependencies.getStats(droppedPath);
      if (details.isDirectory()) {
        results.push({
          kind: 'action',
          type: 'folder',
          target: droppedPath,
          label: path.basename(droppedPath).slice(0, 24) || '폴더',
          args: [],
        });
        continue;
      }
      const extension = path.extname(droppedPath).toLowerCase();
      if (extension === '.lnk') {
        if (dependencies.platform !== 'win32') continue;
        const shortcut = dependencies.readShortcut(droppedPath);
        const shortcutPath = win32.isAbsolute(shortcut.target) ? win32 : posix;
        if (shortcutPath.extname(shortcut.target).toLowerCase() !== '.exe') continue;
        results.push({
          kind: 'action',
          type: 'app',
          target: shortcut.target,
          label: labelFromPath(droppedPath),
          args: splitArguments(shortcut.args),
          workingDir: shortcut.cwd || shortcutPath.dirname(shortcut.target),
        });
      } else if (extension === '.exe') {
        results.push({
          kind: 'action',
          type: 'app',
          target: droppedPath,
          label: labelFromPath(droppedPath),
          args: [],
          workingDir: path.dirname(droppedPath),
        });
      } else {
        results.push({
          kind: 'action',
          type: 'file',
          target: droppedPath,
          label: labelFromPath(droppedPath),
          args: [],
        });
      }
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
