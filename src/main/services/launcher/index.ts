import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '../../../shared/ipcChannels';
import type { ActionItem, DeckItem, LaunchResult } from '../../../shared/types';
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
import { isWebConnectorSupportedPlatform } from '../../../shared/webWorkflows';
import { startActiveMultiAction } from '../multiAction';

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
  startMultiAction: startActiveMultiAction,
};

async function launchResolvedAction(
  item: ActionItem,
  dependencies: LauncherDependencies,
  platform: NodeJS.Platform,
): Promise<LaunchResult> {
  try {
    validateActionTarget(item, platform);
  } catch (error) {
    const message =
      error instanceof ValidationError
        ? error.message
        : '실행 대상이 올바르지 않습니다. 편집기에서 다시 확인해 주세요.';
    return launchFailure('BLOCKED', message);
  }

  if (item.webWorkflow) {
    if (!isWebConnectorSupportedPlatform(platform)) {
      return launchFailure(
        'BLOCKED',
        '나이스와 에듀파인 자동 이동은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 실행해 주세요.',
      );
    }
    try {
      const queued = dependencies.queueWebWorkflow(item);
      return queued.queued
        ? { ok: true }
        : launchFailure('FAILED', queued.message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : '알 수 없는 오류';
      return launchFailure(
        'FAILED',
        `업무용 브라우저 요청을 접수하지 못했습니다. 설정에서 연결을 시험해 주세요: ${detail}`,
      );
    }
  }

  if (['folder', 'file', 'app'].includes(item.type) && !dependencies.exists(item.target)) {
    return launchFailure(
      'NOT_FOUND',
      `대상을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다: ${item.target}`,
    );
  }

  try {
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

  if (item.type === 'multi') {
    return dependencies.startMultiAction(item, root, (target) =>
      launchResolvedAction(target, dependencies, platform),
    );
  }
  return launchResolvedAction(item, dependencies, platform);
}
