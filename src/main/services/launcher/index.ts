import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { shell } from 'electron';
import type { DeckItem, LaunchResult } from '../../../shared/types';
import { findItemAtPath, TreeError } from '../../../shared/tree';
import { validateActionTarget, ValidationError } from '../../security/validate';
import {
  launchCommonAction,
  launchFailure,
  type LauncherDependencies,
} from './common';
import { launchMacosAction } from './macos';
import { launchWindowsAction } from './windows';

export type { LauncherDependencies } from './common';

const defaultDependencies: LauncherDependencies = {
  exists: existsSync,
  openExternal: (target) => shell.openExternal(target),
  openPath: (target) => shell.openPath(target),
  spawnProcess: (command, args, options) => spawn(command, [...args], options),
};

export async function launchDeckItem(
  root: readonly DeckItem[],
  path: readonly string[],
  id: string,
  dependencies: LauncherDependencies = defaultDependencies,
  platform: NodeJS.Platform = process.platform,
): Promise<LaunchResult> {
  let item: DeckItem | undefined;
  try {
    item = findItemAtPath(root, path, id);
  } catch (error) {
    if (!(error instanceof TreeError)) throw error;
  }
  if (!item) {
    return launchFailure('NOT_FOUND', '실행할 키를 찾을 수 없습니다. 편집기에서 다시 확인해 주세요.');
  }
  if (item.kind === 'folder') {
    return launchFailure('BLOCKED', '폴더 키는 실행 대상이 아닙니다. 키를 눌러 폴더 안으로 들어가세요.');
  }
  if (platform !== 'win32' && platform !== 'darwin') {
    return launchFailure('BLOCKED', '이 운영체제에서는 항목을 실행할 수 없습니다.');
  }

  try {
    validateActionTarget(item, platform);
  } catch (error) {
    const message =
      error instanceof ValidationError
        ? error.message
        : '실행 대상이 올바르지 않습니다. 편집기에서 다시 확인해 주세요.';
    return launchFailure('BLOCKED', message);
  }

  if (['folder', 'file', 'app'].includes(item.type) && !dependencies.exists(item.target)) {
    return launchFailure(
      'NOT_FOUND',
      `대상을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다: ${item.target}`,
    );
  }

  try {
    const commonResult = await launchCommonAction(item, dependencies);
    if (commonResult) return commonResult;
    return platform === 'win32'
      ? await launchWindowsAction(item, dependencies)
      : await launchMacosAction(item, dependencies);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '알 수 없는 오류';
    return launchFailure('FAILED', `대상을 실행하지 못했습니다. 설정을 확인해 주세요: ${detail}`);
  }
}
