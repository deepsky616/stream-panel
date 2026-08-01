import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { shell } from 'electron';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { DeckItem, LaunchResult } from '../../shared/types';
import { findItemAtPath, TreeError } from '../../shared/tree';
import { validateActionTarget, ValidationError } from '../security/validate';

export interface LauncherDependencies {
  exists: (target: string) => boolean;
  openExternal: (target: string) => Promise<void>;
  openPath: (target: string) => Promise<string>;
  spawnProcess: (command: string, args: readonly string[], options: SpawnOptions) => Pick<ChildProcess, 'unref'>;
}

const defaultDependencies: LauncherDependencies = {
  exists: existsSync,
  openExternal: (target) => shell.openExternal(target),
  openPath: (target) => shell.openPath(target),
  spawnProcess: (command, args, options) => spawn(command, [...args], options),
};

function failure(code: 'NOT_FOUND' | 'BLOCKED' | 'FAILED', message: string): LaunchResult {
  return { ok: false, code, message };
}

export async function launchDeckItem(
  root: readonly DeckItem[],
  path: readonly string[],
  id: string,
  dependencies: LauncherDependencies = defaultDependencies,
): Promise<LaunchResult> {
  let item: DeckItem | undefined;
  try {
    item = findItemAtPath(root, path, id);
  } catch (error) {
    if (!(error instanceof TreeError)) throw error;
  }
  if (!item) return failure('NOT_FOUND', '실행할 키를 찾을 수 없습니다. 편집기에서 다시 확인해 주세요.');
  if (item.kind === 'folder') {
    return failure('BLOCKED', '폴더 키는 실행 대상이 아닙니다. 키를 눌러 폴더 안으로 들어가세요.');
  }

  try {
    validateActionTarget(item);
  } catch (error) {
    const message =
      error instanceof ValidationError
        ? error.message
        : '실행 대상이 올바르지 않습니다. 편집기에서 다시 확인해 주세요.';
    return failure('BLOCKED', message);
  }

  if (['folder', 'file', 'app'].includes(item.type) && !dependencies.exists(item.target)) {
    return failure('NOT_FOUND', `대상을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다: ${item.target}`);
  }

  try {
    if (item.type === 'url') {
      await dependencies.openExternal(item.target);
    } else if (item.type === 'folder' || item.type === 'file') {
      const errorMessage = await dependencies.openPath(item.target);
      if (errorMessage) return failure('FAILED', `대상을 열지 못했습니다. ${errorMessage}`);
    } else if (item.type === 'app') {
      const child = dependencies.spawnProcess(item.target, item.args, {
        detached: true,
        stdio: 'ignore',
        cwd: item.workingDir ?? dirname(item.target),
        windowsHide: false,
      });
      child.unref();
    } else {
      const child = dependencies.spawnProcess(
        'explorer.exe',
        [`shell:AppsFolder\\${item.target}`],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
    }
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : '알 수 없는 오류';
    return failure('FAILED', `대상을 실행하지 못했습니다. 설정을 확인해 주세요: ${detail}`);
  }
}
