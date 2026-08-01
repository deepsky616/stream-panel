import type { ActionItem, LaunchResult } from '../../../shared/types';
import { launchFailure, type LauncherDependencies } from './common';

export async function launchMacosAction(
  item: ActionItem,
  dependencies: LauncherDependencies,
): Promise<LaunchResult> {
  if (item.type === 'uwp') {
    return launchFailure('BLOCKED', '이 항목은 Windows에서만 실행할 수 있습니다.');
  }
  if (item.type !== 'app') {
    return launchFailure('BLOCKED', '이 실행 종류는 macOS에서 사용할 수 없습니다.');
  }
  if (item.args.length === 0) {
    const errorMessage = await dependencies.openPath(item.target);
    return errorMessage
      ? launchFailure('FAILED', `앱을 열지 못했습니다. 원인을 확인해 주세요: ${errorMessage}`)
      : { ok: true };
  }
  const child = dependencies.spawnProcess(
    'open',
    ['-a', item.target, '--args', ...item.args],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  return { ok: true };
}
