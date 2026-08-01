import { win32 } from 'node:path';
import type {
  ExecutablePickerDependencies,
  ExecutableSelection,
} from './index';

function splitArguments(value: string | undefined): string[] {
  return value?.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

export function resolveWindowsExecutable(
  selectedPath: string,
  dependencies: ExecutablePickerDependencies,
): ExecutableSelection | null {
  const extension = win32.extname(selectedPath).toLowerCase();
  if (extension === '.lnk') {
    try {
      const shortcut = dependencies.readShortcutLink(selectedPath);
      return {
        target: shortcut.target,
        args: splitArguments(shortcut.args),
        workingDir: shortcut.cwd || win32.dirname(shortcut.target),
        name: win32.basename(selectedPath, extension),
      };
    } catch {
      return null;
    }
  }
  if (extension !== '.exe') return null;
  return {
    target: selectedPath,
    args: [],
    workingDir: win32.dirname(selectedPath),
    name: win32.basename(selectedPath, extension),
  };
}
