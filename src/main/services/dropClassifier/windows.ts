import { win32 } from 'node:path';
import { shell } from 'electron';
import type { DropClassifierDependencies, DroppedAction } from './index';
import type { ShortcutDetails } from './index';
import { splitDroppedArguments } from './index';

function labelFromPath(target: string): string {
  const extension = win32.extname(target);
  return win32.basename(target, extension).slice(0, 24) || '새 키';
}

export function readWindowsShortcut(path: string): ShortcutDetails {
  return shell.readShortcutLink(path);
}

export async function classifyWindowsPath(
  droppedPath: string,
  dependencies: DropClassifierDependencies,
): Promise<DroppedAction | null> {
  const details = await dependencies.getStats(droppedPath);
  if (details.isDirectory()) {
    return {
      kind: 'action',
      type: 'folder',
      target: droppedPath,
      label: win32.basename(droppedPath).slice(0, 24) || '폴더',
      args: [],
    };
  }

  const extension = win32.extname(droppedPath).toLowerCase();
  if (extension === '.lnk') {
    const shortcut = dependencies.readShortcut(droppedPath);
    if (win32.extname(shortcut.target).toLowerCase() !== '.exe') return null;
    return {
      kind: 'action',
      type: 'app',
      target: shortcut.target,
      label: labelFromPath(droppedPath),
      args: splitDroppedArguments(shortcut.args),
      workingDir: shortcut.cwd || win32.dirname(shortcut.target),
    };
  }

  if (extension === '.exe') {
    return {
      kind: 'action',
      type: 'app',
      target: droppedPath,
      label: labelFromPath(droppedPath),
      args: [],
      workingDir: win32.dirname(droppedPath),
    };
  }

  return {
    kind: 'action',
    type: 'file',
    target: droppedPath,
    label: labelFromPath(droppedPath),
    args: [],
  };
}
