import { basename, dirname, extname } from 'node:path';
import type { ExecutableSelection } from './index';

export function resolveMacosExecutable(selectedPath: string): ExecutableSelection {
  const extension = extname(selectedPath);
  return {
    target: selectedPath,
    args: [],
    workingDir: dirname(selectedPath),
    name: basename(selectedPath, extension),
  };
}
