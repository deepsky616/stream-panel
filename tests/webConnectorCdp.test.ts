import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { WebConnectorBrowserId } from '../src/shared/types';
import {
  CdpProtocol,
  validateManagedBrowserIdentity,
} from '../src/main/services/webConnector/cdp/protocol';
import {
  createPipeTransport,
} from '../src/main/services/webConnector/cdp/pipeTransport';
import {
  buildLoopbackWebSocketUrl,
  parseDevToolsActivePort,
  readDevToolsActivePort,
} from '../src/main/services/webConnector/cdp/portTransport';
import type {
  CdpTransport,
  CdpTransportMessageListener,
} from '../src/main/services/webConnector/cdp/transport';
import { connectManagedBrowser } from '../src/main/services/webConnector/cdp/transport';

class MemoryTransport implements CdpTransport {
  private readonly messageListeners = new Set<CdpTransportMessageListener>();
  private readonly closeListeners = new Set<(reason?: Error) => void>();

  constructor(
    private readonly respond: (request: { id: number; method: string; params: Record<string, unknown> }) => unknown,
  ) {}

  send(message: string): void {
    const request = JSON.parse(message) as { id: number; method: string; params: Record<string, unknown> };
    const result = this.respond(request);
    queueMicrotask(() => {
      const response = JSON.stringify({ id: request.id, result });
      for (const listener of this.messageListeners) listener(response);
    });
  }

  onMessage(listener: CdpTransportMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: (reason?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    for (const listener of this.closeListeners) listener();
  }
}

function versionResponse(browserId: WebConnectorBrowserId): {
  protocolVersion: string;
  product: string;
  revision: string;
  userAgent: string;
  jsVersion: string;
} {
  return {
    protocolVersion: '1.3',
    product: 'Chrome/140.0.0.0',
    revision: '@revision',
    userAgent: browserId === 'edge'
      ? 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
      : 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36',
    jsVersion: '14.0.0',
  };
}

describe('managed browser CDP transport', () => {
  it('parses only a bounded random local port and browser websocket path', () => {
    expect(parseDevToolsActivePort('53421\n/devtools/browser/abc-123\n')).toEqual({
      port: 53421,
      browserPath: '/devtools/browser/abc-123',
    });
    expect(() => parseDevToolsActivePort('1023\n/devtools/browser/abc\n')).toThrow(/범위/);
    expect(() => parseDevToolsActivePort('65536\n/devtools/browser/abc\n')).toThrow(/범위/);
    expect(() => parseDevToolsActivePort(' 53421\n/devtools/browser/abc\n')).toThrow(/형식/);
    expect(() => parseDevToolsActivePort('53421\nws://evil.example/x\n')).toThrow(/형식/);
    expect(() => parseDevToolsActivePort('53421\n/devtools/browser/../../secret\n')).toThrow(/형식/);
    expect(buildLoopbackWebSocketUrl({
      port: 53421,
      browserPath: '/devtools/browser/abc-123',
    })).toBe('ws://127.0.0.1:53421/devtools/browser/abc-123');
  });

  it('reads the active port only from the exact managed profile root', async () => {
    const reads: string[] = [];
    await expect(readDevToolsActivePort(
      'C:\\StreamPanel\\web-browsers\\sen\\edge',
      {
        platform: 'win32',
        readText: async (path) => {
          reads.push(path);
          return '53421\n/devtools/browser/abc-123\n';
        },
      },
    )).resolves.toEqual({ port: 53421, browserPath: '/devtools/browser/abc-123' });
    expect(reads).toEqual([
      'C:\\StreamPanel\\web-browsers\\sen\\edge\\DevToolsActivePort',
    ]);
  });

  it('writes and reads null-terminated JSON messages through the pipe', async () => {
    const browserInput = new PassThrough();
    const browserOutput = new PassThrough();
    const written: Buffer[] = [];
    browserInput.on('data', (chunk: Buffer) => written.push(chunk));
    const transport = createPipeTransport(browserInput, browserOutput);
    const received: string[] = [];
    transport.onMessage((message) => received.push(message));

    transport.send('{"id":1,"method":"Browser.getVersion"}');
    browserOutput.write('{"id":1,"res');
    browserOutput.write('ult":{}}\0{"method":"Target.targetCreated"}\0');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(Buffer.concat(written).toString('utf8')).toBe(
      '{"id":1,"method":"Browser.getVersion"}\0',
    );
    expect(received).toEqual([
      '{"id":1,"result":{}}',
      '{"method":"Target.targetCreated"}',
    ]);
    transport.close();
  });

  it('correlates responses and rejects commands outside the fixed allowlist', async () => {
    const sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
    const transport = new MemoryTransport((request) => {
      sent.push(request);
      return request.method === 'Target.getTargets' ? { targetInfos: [] } : versionResponse('chrome');
    });
    const protocol = new CdpProtocol(transport);

    await expect(protocol.send('Target.getTargets', {})).resolves.toEqual({ targetInfos: [] });
    await expect(protocol.send('Browser.getVersion', {})).resolves.toMatchObject({
      product: 'Chrome/140.0.0.0',
    });
    await expect(protocol.send('Target.detachFromTarget' as never, {
      sessionId: 'session-1',
    })).resolves.toMatchObject({
      product: 'Chrome/140.0.0.0',
    });
    await expect(protocol.send('Target.closeTarget' as never, {
      targetId: 'target-1',
    })).resolves.toMatchObject({
      product: 'Chrome/140.0.0.0',
    });
    await expect(protocol.send('Page.close', {}, 'session-1')).resolves.toMatchObject({
      product: 'Chrome/140.0.0.0',
    });
    await expect(protocol.send('Page.handleJavaScriptDialog', {
      accept: true,
    }, 'session-1')).resolves.toMatchObject({
      product: 'Chrome/140.0.0.0',
    });
    expect(sent).toEqual([
      { id: 1, method: 'Target.getTargets', params: {} },
      { id: 2, method: 'Browser.getVersion', params: {} },
      { id: 3, method: 'Target.detachFromTarget', params: { sessionId: 'session-1' } },
      { id: 4, method: 'Target.closeTarget', params: { targetId: 'target-1' } },
      { id: 5, method: 'Page.close', params: {}, sessionId: 'session-1' },
      {
        id: 6,
        method: 'Page.handleJavaScriptDialog',
        params: { accept: true },
        sessionId: 'session-1',
      },
    ]);
    expect(() => protocol.send('Network.getAllCookies' as never, {})).toThrow(/허용/);
    protocol.close();
    await expect(protocol.send('Target.getTargets', {})).rejects.toThrow(/닫/);
  });

  it('marks a protocol closed when its transport closes unexpectedly', async () => {
    const transport = new MemoryTransport(() => ({ targetInfos: [] }));
    const protocol = new CdpProtocol(transport);

    transport.close();

    await expect(protocol.send('Target.getTargets', {})).rejects.toThrow(/닫/);
  });

  it('distinguishes Edge and Chrome without accepting another browser identity', () => {
    expect(() => validateManagedBrowserIdentity('edge', versionResponse('edge'))).not.toThrow();
    expect(() => validateManagedBrowserIdentity('chrome', versionResponse('chrome'))).not.toThrow();
    expect(() => validateManagedBrowserIdentity('edge', versionResponse('chrome'))).toThrow(/엣지/);
    expect(() => validateManagedBrowserIdentity('chrome', versionResponse('edge'))).toThrow(/크롬/);
  });

  it('closes the owned pipe child before retrying once with a random port', async () => {
    const attempts: string[] = [];
    const closed: string[] = [];
    const result = await connectManagedBrowser(
      {
        browserId: 'edge',
        executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        profilePath: 'C:\\StreamPanel\\web-browsers\\goe\\edge',
      },
      {
        spawnBrowser(launch) {
          attempts.push(launch.transport);
          return {
            launch,
            pid: launch.transport === 'pipe' ? 100 : 101,
            exited: false,
            inputPipe: null,
            outputPipe: null,
            close: async () => { closed.push(launch.transport); },
          };
        },
        connectPipe: async () => { throw new Error('pipe unavailable'); },
        connectPort: async () => new MemoryTransport(() => versionResponse('edge')),
      },
    );

    expect(result.transportKind).toBe('port');
    expect(result.process.pid).toBe(101);
    expect(attempts).toEqual(['pipe', 'port']);
    expect(closed).toEqual(['pipe']);
    result.protocol.close();
  });

  it('never retries beyond the single random-port fallback', async () => {
    const attempts: string[] = [];
    const closed: string[] = [];

    await expect(connectManagedBrowser(
      {
        browserId: 'chrome',
        executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        profilePath: 'C:\\StreamPanel\\web-browsers\\goe\\chrome',
      },
      {
        spawnBrowser(launch) {
          attempts.push(launch.transport);
          return {
            launch,
            pid: attempts.length,
            exited: false,
            inputPipe: null,
            outputPipe: null,
            close: async () => { closed.push(launch.transport); },
          };
        },
        connectPipe: async () => { throw new Error('pipe unavailable'); },
        connectPort: async () => { throw new Error('port unavailable'); },
      },
    )).rejects.toThrow(/파이프와 무작위 포트/);
    expect(attempts).toEqual(['pipe', 'port']);
    expect(closed).toEqual(['pipe', 'port']);
  });

  it('stops immediately when the connected browser identity is wrong', async () => {
    const attempts: string[] = [];
    const closed: string[] = [];

    await expect(connectManagedBrowser(
      {
        browserId: 'edge',
        executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        profilePath: 'C:\\StreamPanel\\web-browsers\\goe\\edge',
      },
      {
        spawnBrowser(launch) {
          attempts.push(launch.transport);
          return {
            launch,
            pid: 100,
            exited: false,
            inputPipe: null,
            outputPipe: null,
            close: async () => { closed.push(launch.transport); },
          };
        },
        connectPipe: async () => new MemoryTransport(() => versionResponse('chrome')),
        connectPort: async () => new MemoryTransport(() => versionResponse('edge')),
      },
    )).rejects.toThrow(/엣지/);
    expect(attempts).toEqual(['pipe']);
    expect(closed).toEqual(['pipe']);
  });
});
