import { posix } from 'node:path';
import type { DropClassifierDependencies, DroppedAction } from './index';

function labelFromPath(target: string): string {
  const extension = posix.extname(target);
  return posix.basename(target, extension).slice(0, 24) || '새 키';
}

export async function classifyMacosPath(
  droppedPath: string,
  dependencies: DropClassifierDependencies,
): Promise<DroppedAction> {
  const resolvedPath = await dependencies.realpath(droppedPath);
  const extension = posix.extname(resolvedPath).toLowerCase();

  if (extension === '.app') {
    return {
      kind: 'action',
      type: 'app',
      target: resolvedPath,
      label: labelFromPath(resolvedPath),
      args: [],
      workingDir: posix.dirname(resolvedPath),
    };
  }

  const details = await dependencies.getStats(resolvedPath);
  if (details.isDirectory()) {
    return {
      kind: 'action',
      type: 'folder',
      target: resolvedPath,
      label: posix.basename(resolvedPath).slice(0, 24) || '폴더',
      args: [],
    };
  }

  return {
    kind: 'action',
    type: 'file',
    target: resolvedPath,
    label: labelFromPath(resolvedPath),
    args: [],
  };
}
