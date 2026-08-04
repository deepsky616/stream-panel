import { readFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import type { CdpTransport, CdpTransportMessageListener } from './transport';

export interface DevToolsActivePort {
  port: number;
  browserPath: string;
}

export interface ReadDevToolsActivePortOptions {
  platform?: 'win32' | 'darwin';
  readText?: (path: string) => Promise<string>;
}

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: { data?: unknown }) => void): void;
  removeEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: { data?: unknown }) => void): void;
}

export interface OpenWebSocketTransportOptions {
  createSocket?: (url: string) => WebSocketLike;
  timeoutMs?: number;
}

export function parseDevToolsActivePort(text: string): DevToolsActivePort {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.length !== 2) {
    throw new TypeError('업무용 브라우저 제어 포트 파일 형식이 올바르지 않습니다. 브라우저를 다시 열어 주세요.');
  }
  if (!/^[0-9]{1,5}$/.test(lines[0])) {
    throw new TypeError('업무용 브라우저 제어 포트 파일 형식이 올바르지 않습니다. 브라우저를 다시 열어 주세요.');
  }
  const port = Number(lines[0]);
  if (port < 1024 || port > 65_535) {
    throw new TypeError('업무용 브라우저 제어 포트가 허용 범위를 벗어났습니다. 브라우저를 다시 열어 주세요.');
  }
  const browserPath = lines[1];
  if (!/^\/devtools\/browser\/[A-Za-z0-9._-]{1,128}$/.test(browserPath)) {
    throw new TypeError('업무용 브라우저 제어 주소 형식이 올바르지 않습니다. 브라우저를 다시 열어 주세요.');
  }
  return { port, browserPath };
}

export async function readDevToolsActivePort(
  profilePath: string,
  {
    platform = process.platform === 'win32' ? 'win32' : 'darwin',
    readText = (path) => readFile(path, 'utf8'),
  }: ReadDevToolsActivePortOptions = {},
): Promise<DevToolsActivePort> {
  const api = platform === 'win32' ? win32 : posix;
  return parseDevToolsActivePort(await readText(api.join(profilePath, 'DevToolsActivePort')));
}

export function buildLoopbackWebSocketUrl(activePort: DevToolsActivePort): string {
  return `ws://127.0.0.1:${activePort.port}${activePort.browserPath}`;
}

function messageToString(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return null;
}

function createWebSocketTransport(socket: WebSocketLike): CdpTransport {
  const messageListeners = new Set<CdpTransportMessageListener>();
  const closeListeners = new Set<(reason?: Error) => void>();
  const onMessage = (event: { data?: unknown }): void => {
    const message = messageToString(event.data);
    if (message !== null) {
      for (const listener of messageListeners) listener(message);
    }
  };
  const onClose = (): void => {
    for (const listener of closeListeners) listener();
  };
  const onError = (): void => {
    const reason = new Error('업무용 브라우저 로컬 제어 통로가 끊겼습니다. 브라우저를 다시 열어 주세요.');
    for (const listener of closeListeners) listener(reason);
  };
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  socket.addEventListener('error', onError);
  return {
    send(message) {
      if (socket.readyState !== 1) throw new Error('업무용 브라우저 로컬 제어 통로가 열려 있지 않습니다.');
      socket.send(message);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close() {
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
      socket.close();
    },
  };
}

function defaultSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

export async function openWebSocketTransport(
  url: string,
  {
    createSocket = defaultSocket,
    timeoutMs = 5_000,
  }: OpenWebSocketTransportOptions = {},
): Promise<CdpTransport> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1') {
    throw new TypeError('업무용 브라우저 제어 주소는 이 컴퓨터 안에서만 열 수 있습니다.');
  }
  const socket = createSocket(url);
  if (socket.readyState !== 1) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(new Error('업무용 브라우저 로컬 제어 통로를 열지 못했습니다. 브라우저를 다시 열어 주세요.'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('업무용 브라우저 로컬 제어 통로의 응답 시간이 지났습니다.'));
      }, timeoutMs);
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
  }
  return createWebSocketTransport(socket);
}

export async function waitForDevToolsActivePort(
  profilePath: string,
  timeoutMs = 5_000,
): Promise<DevToolsActivePort> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await readDevToolsActivePort(profilePath, { platform: 'win32' });
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : '파일을 찾을 수 없습니다.';
  throw new Error(`업무용 브라우저 제어 포트를 확인하지 못했습니다. 브라우저를 다시 열어 주세요: ${detail}`);
}
