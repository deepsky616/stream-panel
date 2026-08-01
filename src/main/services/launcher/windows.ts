import { win32 } from 'node:path';
import type { ActionItem, LaunchResult } from '../../../shared/types';
import { launchFailure, type LauncherDependencies } from './common';

export async function launchWindowsAction(
  item: ActionItem,
  dependencies: LauncherDependencies,
): Promise<LaunchResult> {
  if (item.type === 'app') {
    const child = dependencies.spawnProcess(item.target, item.args, {
      detached: true,
      stdio: 'ignore',
      cwd: item.workingDir ?? win32.dirname(item.target),
      windowsHide: false,
    });
    child.unref();
    return { ok: true };
  }
  if (item.type === 'uwp') {
    const child = dependencies.spawnProcess(
      'explorer.exe',
      [`shell:AppsFolder\\${item.target}`],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    return { ok: true };
  }
  return launchFailure('BLOCKED', '이 실행 종류는 Windows에서 사용할 수 없습니다.');
}
