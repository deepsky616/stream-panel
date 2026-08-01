import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { ActionItem, LaunchResult } from '../../../shared/types';

export interface LauncherDependencies {
  exists: (target: string) => boolean;
  openExternal: (target: string) => Promise<void>;
  openPath: (target: string) => Promise<string>;
  spawnProcess: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => Pick<ChildProcess, 'unref'>;
}

export function launchFailure(
  code: 'NOT_FOUND' | 'BLOCKED' | 'FAILED',
  message: string,
): LaunchResult {
  return { ok: false, code, message };
}

export async function launchCommonAction(
  item: ActionItem,
  dependencies: LauncherDependencies,
): Promise<LaunchResult | null> {
  if (item.type === 'url') {
    await dependencies.openExternal(item.target);
    return { ok: true };
  }
  if (item.type === 'folder' || item.type === 'file') {
    const errorMessage = await dependencies.openPath(item.target);
    return errorMessage
      ? launchFailure('FAILED', `대상을 열지 못했습니다. 원인을 확인해 주세요: ${errorMessage}`)
      : { ok: true };
  }
  return null;
}
