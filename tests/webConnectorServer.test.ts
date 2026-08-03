import { afterEach, describe, expect, it } from 'vitest';
import { WebConnectorBroker } from '../src/main/services/webConnector/core';
import { createWebConnectorServer } from '../src/main/services/webConnector/server';

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()));
});

async function jsonRequest(
  url: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('web connector loopback server', () => {
  it('binds only to loopback and rejects unauthenticated or malformed pairing input', async () => {
    const broker = new WebConnectorBroker();
    const server = createWebConnectorServer({ broker, token: 'secret-token', port: 0 });
    running.push(server);
    const started = await server.start();
    expect(started).toMatchObject({ ok: true, host: '127.0.0.1' });
    if (!started.ok) throw new Error(started.message);

    const setup = await fetch(`${started.origin}/setup`);
    expect(setup.status).toBe(200);
    expect(setup.headers.get('content-type')).toContain('text/html');
    const setupHtml = await setup.text();
    expect(setupHtml).toContain('data-stream-panel-setup');
    expect(setupHtml).not.toContain('secret-token');

    const unauthenticated = await fetch(`${started.origin}/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ browserId: 'edge', extensionVersion: '1.0.0' }),
    });
    expect(unauthenticated.status).toBe(401);

    const malformed = await jsonRequest(`${started.origin}/v1/pair`, 'secret-token', {
      browserId: 'edge',
      extensionVersion: '1.0.0',
      arbitraryCommand: 'run',
    });
    expect(malformed.status).toBe(400);
    expect(broker.getStatus('edge').paired).toBe(false);

    const paired = await jsonRequest(`${started.origin}/v1/pair`, 'secret-token', {
      browserId: 'edge',
      extensionVersion: '1.0.0',
    });
    expect(paired.status).toBe(200);
    expect(broker.getStatus('edge')).toMatchObject({ paired: true, connected: true });
  });

  it('returns only a matching fixed command and accepts one validated result', async () => {
    const broker = new WebConnectorBroker({ id: () => 'command-1' });
    broker.markPaired('chrome', '1.0.0');
    broker.enqueue(
      { id: 'neis-trip', browserId: 'chrome' },
      'https://goe.neis.go.kr',
    );
    const server = createWebConnectorServer({ broker, token: 'secret-token', port: 0 });
    running.push(server);
    const started = await server.start();
    if (!started.ok) throw new Error(started.message);

    const claimUrl = new URL('/v1/claim', started.origin);
    claimUrl.searchParams.set('browserId', 'chrome');
    claimUrl.searchParams.set('origin', 'https://goe.neis.go.kr');
    const claim = await fetch(claimUrl, {
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(claim.status).toBe(200);
    await expect(claim.json()).resolves.toMatchObject({
      commandId: 'command-1',
      workflowId: 'neis-trip',
    });

    const completed = await jsonRequest(`${started.origin}/v1/result`, 'secret-token', {
      browserId: 'chrome',
      commandId: 'command-1',
      ok: true,
      message: '출장 화면을 열었습니다.',
    });
    expect(completed.status).toBe(200);
    const duplicate = await jsonRequest(`${started.origin}/v1/result`, 'secret-token', {
      browserId: 'chrome',
      commandId: 'command-1',
      ok: true,
      message: '중복 결과',
    });
    expect(duplicate.status).toBe(409);
  });
});
