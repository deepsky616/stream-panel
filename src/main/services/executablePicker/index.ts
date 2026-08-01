import { resolveMacosExecutable } from './macos';
import { resolveWindowsExecutable } from './windows';

export interface ShortcutDetails {
  target: string;
  args?: string;
  cwd?: string;
}

export interface ExecutablePickerDependencies {
  readShortcutLink: (path: string) => ShortcutDetails;
}

export interface ExecutableSelection {
  target: string;
  args: string[];
  workingDir?: string;
  name: string;
}

export interface ExecutableDialogOptions {
  properties: Array<'openFile'>;
  filters?: Electron.FileFilter[];
}

export function getExecutableDialogOptions(
  platform: NodeJS.Platform = process.platform,
): ExecutableDialogOptions | null {
  switch (platform) {
    case 'win32':
      return {
        properties: ['openFile'],
        filters: [{ name: '실행 파일', extensions: ['exe', 'lnk'] }],
      };
    case 'darwin':
      return { properties: ['openFile'] };
    default:
      return null;
  }
}

export function resolveExecutableSelection(
  selectedPath: string,
  platform: NodeJS.Platform,
  dependencies: ExecutablePickerDependencies,
): ExecutableSelection | null {
  switch (platform) {
    case 'win32':
      return resolveWindowsExecutable(selectedPath, dependencies);
    case 'darwin':
      return resolveMacosExecutable(selectedPath);
    default:
      return null;
  }
}
