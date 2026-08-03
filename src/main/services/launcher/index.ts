import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipcChannels';
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
import { launchWindowsBrowser } from '../browserService/windows';
import { launchMacosBrowser, resolveMacBrowserExecutable } from '../browserService/macos';
import { queueActiveWebWorkflow } from '../webConnector';

export type { LauncherDependencies } from './common';

const defaultDependencies: LauncherDependencies = {
  exists: existsSync,
  openExternal: (target) => shell.openExternal(target),
  openPath: (target) => shell.openPath(target),
  spawnProcess: (command, args, options) => spawn(command, [...args], options),
  resolveMacBundleExecutable: resolveMacBrowserExecutable,
  notifyWarning: (message) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.TOAST, { level: 'info', message });
    }
  },
  queueWebWorkflow: queueActiveWebWorkflow,
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
    if (item.webWorkflow) {
      if (!item.browser) {
        dependencies.notifyWarning(
          '웹 업무 자동 이동에는 엣지나 크롬 선택이 필요합니다. 사이트만 열었습니다.',
        );
      } else {
        const queued = dependencies.queueWebWorkflow(item);
        if (!queued.queued) {
          dependencies.notifyWarning(
            queued.message ??
              '웹 업무 연결을 시작하지 못했습니다. 설정의 웹 업무 연결에서 다시 연결해 주세요.',
          );
        }
      }
    }
    if (item.type === 'url' && item.browser) {
      return platform === 'win32'
        ? await launchWindowsBrowser(item as typeof item & { browser: NonNullable<typeof item.browser> }, dependencies)
        : await launchMacosBrowser(item as typeof item & { browser: NonNullable<typeof item.browser> }, dependencies);
    }
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
