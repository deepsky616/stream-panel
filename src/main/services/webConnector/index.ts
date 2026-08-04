import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  ActionItem,
  WebConnectorBrowserId,
  WebConnectorStatus,
} from '../../../shared/types';
import { resolveMacBrowserExecutable } from '../browserService/macos';
import {
  WebConnectorBroker,
  type WebConnectorEnqueueResult,
} from './core';
import {
  createWebConnectorServer,
  type WebConnectorServer,
  type WebConnectorServerStartResult,
} from './server';
import {
  loadWebConnectorState,
  type LoadWebConnectorStateOptions,
  type WebConnectorState,
} from './state';
import { resolveMacosConnectorBrowserExecutable } from './macos';
import { resolveWindowsConnectorBrowserExecutable } from './windows';

export interface ResolveWebConnectorBrowserExecutableOptions {
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  resolveMacExecutable?: (bundlePath: string) => Promise<string | null>;
}

export async function resolveWebConnectorBrowserExecutable(
  browserPath: string,
  {
    platform = process.platform,
    exists = existsSync,
    resolveMacExecutable = resolveMacBrowserExecutable,
  }: ResolveWebConnectorBrowserExecutableOptions = {},
): Promise<string | null> {
  try {
    if (platform === 'win32') {
      return resolveWindowsConnectorBrowserExecutable(browserPath, exists);
    }
    if (platform === 'darwin') {
      return await resolveMacosConnectorBrowserExecutable(browserPath, exists, resolveMacExecutable);
    }
    return null;
  } catch {
    return null;
  }
}

export interface WebConnectorService {
  readonly extensionDirectory: string;
  start(): Promise<WebConnectorServerStartResult>;
  stop(): Promise<void>;
  queue(item: ActionItem): WebConnectorEnqueueResult;
  getStatuses(): WebConnectorStatus[];
  getSetupUrl(browserId: WebConnectorBrowserId): string | null;
}

export interface CreateWebConnectorServiceOptions {
  userDataPath?: string;
  extensionDirectory: string;
  port?: number;
  notify?: (message: string, level: 'info' | 'error') => void;
  stateIo?: LoadWebConnectorStateOptions;
}

function diskStateIo(userDataPath: string): LoadWebConnectorStateOptions {
  const statePath = join(userDataPath, 'web-connector', 'state.json');
  return {
    read: async () => {
      try {
        return await readFile(statePath, 'utf8');
      } catch {
        return undefined;
      }
    },
    write: async (text) => {
      await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
      await writeFile(statePath, text, { encoding: 'utf8', mode: 0o600 });
    },
  };
}

export function createWebConnectorService({
  userDataPath,
  extensionDirectory,
  port = 38_473,
  notify = () => undefined,
  stateIo = diskStateIo(userDataPath ?? '.'),
}: CreateWebConnectorServiceOptions): WebConnectorService {
  let state: WebConnectorState | null = null;
  let broker: WebConnectorBroker | null = null;
  let server: WebConnectorServer | null = null;
  let startResult: WebConnectorServerStartResult | null = null;
  let starting: Promise<WebConnectorServerStartResult> | null = null;

  const persist = async (): Promise<void> => {
    if (!state) return;
    try {
      await stateIo.write(JSON.stringify(state, null, 2));
    } catch (error) {
      const detail = error instanceof Error ? error.message : '알 수 없는 오류';
      notify(`브라우저 연결 상태를 저장하지 못했습니다. 다음 실행에서 다시 연결해 주세요: ${detail}`, 'error');
    }
  };

  const start = async (): Promise<WebConnectorServerStartResult> => {
    if (startResult?.ok) return startResult;
    if (starting) return starting;
    starting = (async () => {
      try {
        state = await loadWebConnectorState(stateIo);
      } catch (error) {
        const detail = error instanceof Error ? error.message : '알 수 없는 오류';
        return {
          ok: false as const,
          message: `브라우저 연결 인증값을 준비하지 못했습니다. 설정 폴더 권한을 확인해 주세요: ${detail}`,
        };
      }
      broker = new WebConnectorBroker({
        onResult: (_command, result) => notify(result.message, result.ok ? 'info' : 'error'),
        onExpired: () =>
          notify(
            '웹 업무 자동 이동 시간이 끝났습니다. 로그인 후 스트림 패널 키를 다시 눌러 주세요.',
            'error',
          ),
      });
      for (const browserId of ['edge', 'chrome'] as const) {
        const pairing = state.pairings[browserId];
        if (pairing) broker.restorePaired(browserId, pairing.extensionVersion);
      }
      server = createWebConnectorServer({
        broker,
        token: state.token,
        port,
        onPaired: (browserId, extensionVersion) => {
          if (!state) return;
          state.pairings[browserId] = { extensionVersion };
          void persist();
        },
      });
      startResult = await server.start();
      return startResult;
    })();
    const result = await starting;
    starting = null;
    return result;
  };

  return {
    extensionDirectory,
    start,
    async stop() {
      await server?.stop();
      server = null;
      startResult = null;
      starting = null;
    },
    queue(item) {
      if (!item.webWorkflow) {
        return {
          queued: false,
          message: '웹 업무 종류가 지정되지 않았습니다. 편집기에서 업무 키를 다시 만들어 주세요.',
        };
      }
      if (!broker || !startResult?.ok) {
        return {
          queued: false,
          message: '웹 업무 연결부가 준비되지 않았습니다. 설정의 웹 업무 연결에서 다시 시험해 주세요.',
        };
      }
      return broker.enqueue(item.webWorkflow, item.target);
    },
    getStatuses() {
      return broker?.getStatuses() ?? [
        { browserId: 'edge', paired: false, connected: false },
        { browserId: 'chrome', paired: false, connected: false },
      ];
    },
    getSetupUrl(browserId) {
      if (!state || !startResult?.ok) return null;
      const fragment = new URLSearchParams({ token: state.token, browserId });
      return `${startResult.origin}/setup#${fragment.toString()}`;
    },
  };
}

let activeService: WebConnectorService | null = null;

export function setActiveWebConnectorService(service: WebConnectorService | null): void {
  activeService = service;
}

export function queueActiveWebWorkflow(item: ActionItem): WebConnectorEnqueueResult {
  return activeService?.queue(item) ?? {
    queued: false,
    message: '웹 업무 연결부가 시작되지 않았습니다. 앱을 다시 시작한 뒤 연결을 시험해 주세요.',
  };
}
