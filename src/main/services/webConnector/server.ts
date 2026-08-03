import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  isWebConnectorBrowserId,
} from '../../../shared/webWorkflows';
import type { WebConnectorBrowserId } from '../../../shared/types';
import {
  isAuthorizedWebConnectorToken,
  type WebConnectorBroker,
} from './core';

const MAX_BODY_BYTES = 16 * 1024;
const EXTENSION_ORIGIN = /^(?:chrome-extension|extension):\/\/[a-p]{32}$/;

export interface WebConnectorServerOptions {
  broker: WebConnectorBroker;
  token: string;
  host?: '127.0.0.1';
  port?: number;
  onPaired?: (browserId: WebConnectorBrowserId, extensionVersion: string) => void;
}

export type WebConnectorServerStartResult =
  | { ok: true; host: '127.0.0.1'; port: number; origin: string }
  | { ok: false; message: string };

export interface WebConnectorServer {
  start(): Promise<WebConnectorServerStartResult>;
  stop(): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isSafeVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+){1,3}$/.test(value) && value.length <= 32;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(text);
}

function sendSetupPage(response: ServerResponse): void {
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>스트림 패널 웹 업무 연결</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 620px; margin: 12vh auto; padding: 24px; line-height: 1.6; }
    main { border: 1px solid #7783; border-radius: 16px; padding: 28px; }
    #connection-status { font-weight: 700; color: #5b8cff; }
    .notice { opacity: .75; }
  </style>
</head>
<body data-stream-panel-setup>
  <main>
    <h1>스트림 패널 웹 업무 연결</h1>
    <p id="connection-status" role="status">확장 기능의 응답을 기다리고 있습니다.</p>
    <ol>
      <li>확장 기능이 설치되어 있으면 이 페이지에서 자동으로 연결됩니다.</li>
      <li>연결이 끝나면 스트림 패널 설정으로 돌아가 상태를 확인하세요.</li>
      <li>연결되지 않으면 확장 관리 화면에서 스트림 패널 웹 업무 도우미가 켜져 있는지 확인하세요.</li>
    </ol>
    <p class="notice">암호와 인증서 정보는 읽거나 저장하지 않습니다.</p>
  </main>
</body>
</html>`;
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  response.end(html);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new RangeError('요청 자료가 너무 큽니다.');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function bearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice(7);
}

function configureCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!EXTENSION_ORIGIN.test(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  return true;
}

function pairingInput(value: unknown): { browserId: WebConnectorBrowserId; extensionVersion: string } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['browserId', 'extensionVersion'])) return null;
  if (!isWebConnectorBrowserId(value.browserId) || !isSafeVersion(value.extensionVersion)) return null;
  return { browserId: value.browserId, extensionVersion: value.extensionVersion };
}

function resultInput(value: unknown): {
  browserId: WebConnectorBrowserId;
  commandId: string;
  ok: boolean;
  message: string;
} | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['browserId', 'commandId', 'ok', 'message'])) return null;
  if (
    !isWebConnectorBrowserId(value.browserId) ||
    typeof value.commandId !== 'string' ||
    value.commandId.length < 1 ||
    value.commandId.length > 100 ||
    typeof value.ok !== 'boolean' ||
    typeof value.message !== 'string' ||
    value.message.length < 1 ||
    value.message.length > 500
  ) {
    return null;
  }
  return {
    browserId: value.browserId,
    commandId: value.commandId,
    ok: value.ok,
    message: value.message,
  };
}

export function createWebConnectorServer({
  broker,
  token,
  host = '127.0.0.1',
  port = 38_473,
  onPaired = () => undefined,
}: WebConnectorServerOptions): WebConnectorServer {
  let server: Server | null = null;
  let started: Extract<WebConnectorServerStartResult, { ok: true }> | null = null;

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!configureCors(request, response)) {
      sendJson(response, 403, { message: '허용되지 않은 브라우저 출처입니다.' });
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    const requestUrl = new URL(request.url ?? '/', `http://${host}:${started?.port ?? port}`);
    if (request.method === 'GET' && requestUrl.pathname === '/setup') {
      sendSetupPage(response);
      return;
    }
    if (!requestUrl.pathname.startsWith('/v1/')) {
      sendJson(response, 404, { message: '요청한 연결 경로를 찾을 수 없습니다.' });
      return;
    }
    if (!isAuthorizedWebConnectorToken(bearerToken(request), token)) {
      sendJson(response, 401, { message: '브라우저 연결 인증값이 올바르지 않습니다.' });
      return;
    }

    try {
      if (request.method === 'POST' && requestUrl.pathname === '/v1/pair') {
        const input = pairingInput(await readJsonBody(request));
        if (!input) {
          sendJson(response, 400, { message: '브라우저 연결 정보가 올바르지 않습니다.' });
          return;
        }
        broker.markPaired(input.browserId, input.extensionVersion);
        onPaired(input.browserId, input.extensionVersion);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/heartbeat') {
        const input = pairingInput(await readJsonBody(request));
        if (!input) {
          sendJson(response, 400, { message: '브라우저 상태 정보가 올바르지 않습니다.' });
          return;
        }
        broker.markSeen(input.browserId, input.extensionVersion);
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/v1/claim') {
        const browserId = requestUrl.searchParams.get('browserId');
        const origin = requestUrl.searchParams.get('origin');
        if (!isWebConnectorBrowserId(browserId) || !origin || requestUrl.searchParams.size !== 2) {
          sendJson(response, 400, { message: '웹 업무 요청 정보가 올바르지 않습니다.' });
          return;
        }
        const command = broker.claim(browserId, origin);
        sendJson(response, 200, command);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/result') {
        const input = resultInput(await readJsonBody(request));
        if (!input) {
          sendJson(response, 400, { message: '웹 업무 결과 정보가 올바르지 않습니다.' });
          return;
        }
        const accepted = broker.complete(input.browserId, input.commandId, {
          ok: input.ok,
          message: input.message,
        });
        sendJson(response, accepted ? 200 : 409, {
          ok: accepted,
          ...(accepted ? {} : { message: '이미 끝났거나 시간이 지난 웹 업무입니다.' }),
        });
        return;
      }

      sendJson(response, 404, { message: '요청한 연결 경로를 찾을 수 없습니다.' });
    } catch (error) {
      const message = error instanceof RangeError
        ? error.message
        : '요청 내용을 읽지 못했습니다. 확장 기능을 다시 연결해 주세요.';
      sendJson(response, 400, { message });
    }
  };

  return {
    async start() {
      if (started) return started;
      if (server) {
        return { ok: false, message: '웹 업무 연결부를 시작하는 중입니다. 잠시 후 다시 시도해 주세요.' };
      }
      const candidate = createServer((request, response) => {
        void handle(request, response);
      });
      server = candidate;
      return new Promise<WebConnectorServerStartResult>((resolve) => {
        const onError = (error: Error) => {
          candidate.removeListener('listening', onListening);
          server = null;
          resolve({
            ok: false,
            message: `웹 업무 연결부를 시작하지 못했습니다. 다른 앱이 연결 포트를 쓰는지 확인해 주세요: ${error.message}`,
          });
        };
        const onListening = () => {
          candidate.removeListener('error', onError);
          const address = candidate.address() as AddressInfo;
          started = {
            ok: true,
            host,
            port: address.port,
            origin: `http://${host}:${address.port}`,
          };
          resolve(started);
        };
        candidate.once('error', onError);
        candidate.once('listening', onListening);
        candidate.listen(port, host);
      });
    },
    async stop() {
      const active = server;
      server = null;
      started = null;
      if (!active?.listening) return;
      await new Promise<void>((resolve) => active.close(() => resolve()));
    },
  };
}
