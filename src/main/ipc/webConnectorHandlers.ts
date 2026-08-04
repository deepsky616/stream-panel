import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ActionItem, DetectedBrowser, WebConnectorBrowserId } from '../../shared/types';
import { getBrowserExtensionManagementUrl } from '../../shared/webWorkflows';
import {
  assertWebConnectorBrowserInput,
  assertWebConnectorSetupInput,
  assertWebConnectorStatusInput,
} from '../security/inputValidation';
import { createBrowserService } from '../services/browserService';
import { launchDeckItem } from '../services/launcher';
import {
  resolveWebConnectorBrowserExecutable,
  type WebConnectorService,
} from '../services/webConnector';

type ConnectorReply = { ok: true } | { ok: false; message: string };

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function registerWebConnectorHandlers(service: WebConnectorService): void {
  const browsers = createBrowserService({
    userDataPath: app.getPath('userData'),
    homePath: app.getPath('home'),
  });

  const findBrowser = async (
    browserId: WebConnectorBrowserId,
  ): Promise<DetectedBrowser | null> => {
    const installed = await browsers.list();
    return installed.find((browser) => browser.id === browserId) ?? null;
  };

  const openHttpUrl = async (
    browser: DetectedBrowser,
    url: string,
  ): Promise<ConnectorReply> => {
    const item: ActionItem = {
      id: 'web-connector-setup',
      kind: 'action',
      type: 'url',
      label: '웹 업무 연결',
      target: url,
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      browser: { path: browser.path, appMode: false },
    };
    const result = await launchDeckItem([item], [], item.id);
    return result.ok ? { ok: true } : { ok: false, message: result.message };
  };

  const openFixedInternalPage = async (
    browser: DetectedBrowser,
    browserId: WebConnectorBrowserId,
  ): Promise<ConnectorReply> => {
    try {
      const target = getBrowserExtensionManagementUrl(browserId);
      const executable = await resolveWebConnectorBrowserExecutable(browser.path);
      if (!executable) {
        return {
          ok: false,
          message: '선택한 브라우저 실행 파일을 찾을 수 없습니다. 브라우저를 다시 설치하거나 목록을 새로고침해 주세요.',
        };
      }
      const child = spawn(executable, [target], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : '알 수 없는 오류';
      return {
        ok: false,
        message: `브라우저 확장 관리 화면을 열지 못했습니다. 브라우저 설정에서 직접 열어 주세요: ${detail}`,
      };
    }
  };

  const openPairPage = async (
    browserId: WebConnectorBrowserId,
  ): Promise<ConnectorReply> => {
    const started = await service.start();
    if (!started.ok) return started;
    const browser = await findBrowser(browserId);
    if (!browser) {
      const name = browserId === 'edge' ? '엣지' : '크롬';
      return {
        ok: false,
        message: `${name}를 찾을 수 없습니다. 브라우저를 설치한 뒤 목록을 새로고침해 주세요.`,
      };
    }
    const setupUrl = service.getSetupUrl(browserId);
    if (!setupUrl) {
      return {
        ok: false,
        message: '웹 업무 연결 페이지를 만들지 못했습니다. 스트림 패널을 다시 시작해 주세요.',
      };
    }
    return openHttpUrl(browser, setupUrl);
  };

  ipcMain.handle(IPC_CHANNELS.WEB_CONNECTOR_STATUS, (_event, input: unknown) => {
    assertWebConnectorStatusInput(input);
    return service.getStatuses();
  });

  ipcMain.handle(IPC_CHANNELS.WEB_CONNECTOR_TEST, async (_event, input: unknown) => {
    assertWebConnectorBrowserInput(input);
    const opened = await openPairPage(input.browserId);
    if (!opened.ok) return opened;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (service.getStatuses().find((status) => status.browserId === input.browserId)?.connected) {
        return { ok: true } as const;
      }
      await delay(250);
    }
    const name = input.browserId === 'edge' ? '엣지' : '크롬';
    return {
      ok: false,
      message: `${name} 확장 기능의 응답이 없습니다. 확장 기능을 설치하고 켠 뒤 다시 시험해 주세요.`,
    } as const;
  });

  ipcMain.handle(IPC_CHANNELS.WEB_CONNECTOR_OPEN_SETUP, async (_event, input: unknown) => {
    assertWebConnectorSetupInput(input);
    if (input.target === 'folder') {
      const manifestPath = join(service.extensionDirectory, 'manifest.json');
      if (!existsSync(manifestPath)) {
        return {
          ok: false,
          message: '포함된 브라우저 확장 기능을 찾을 수 없습니다. 스트림 패널을 다시 설치해 주세요.',
        } as const;
      }
      shell.showItemInFolder(manifestPath);
      return { ok: true } as const;
    }
    const browser = await findBrowser(input.browserId);
    if (!browser) {
      const name = input.browserId === 'edge' ? '엣지' : '크롬';
      return {
        ok: false,
        message: `${name}를 찾을 수 없습니다. 브라우저를 설치한 뒤 다시 시도해 주세요.`,
      } as const;
    }
    return input.target === 'extensions'
      ? openFixedInternalPage(browser, input.browserId)
      : openPairPage(input.browserId);
  });
}
