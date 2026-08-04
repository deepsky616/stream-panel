import { describe, expect, it, vi } from 'vitest';
import {
  WebConnectorBroker,
  isAuthorizedWebConnectorToken,
} from '../src/main/services/webConnector/core';
import { loadWebConnectorState } from '../src/main/services/webConnector/state';

describe('web connector broker', () => {
  it('keeps Edge and Chrome commands separate and binds a command to its exact origin', () => {
    let now = 1_000;
    const broker = new WebConnectorBroker({ now: () => now, id: () => 'command-1' });
    broker.markPaired('edge', '1.0.0');

    expect(
      broker.enqueue(
        { id: 'neis-leave', browserId: 'edge' },
        'https://goe.neis.go.kr/main',
      ),
    ).toEqual({ queued: true, commandId: 'command-1' });
    expect(broker.claim('chrome', 'https://goe.neis.go.kr')).toBeNull();
    expect(broker.claim('edge', 'https://goe.neis.go.kr.evil.test')).toBeNull();
    expect(broker.claim('edge', 'https://goe.neis.go.kr')).toMatchObject({
      commandId: 'command-1',
      workflowId: 'neis-leave',
      browserId: 'edge',
      target: 'https://goe.neis.go.kr/main',
      origin: 'https://goe.neis.go.kr',
    });
    expect(broker.claim('edge', 'https://goe.neis.go.kr')).toBeNull();

    now += 1;
  });

  it('does not queue automation until that browser extension has paired', () => {
    const broker = new WebConnectorBroker({ id: () => 'command-1' });

    expect(
      broker.enqueue(
        { id: 'edufine-draft', browserId: 'chrome' },
        'https://klef.goe.go.kr',
      ),
    ).toMatchObject({ queued: false, message: expect.stringMatching(/크롬.*연결/) });
  });

  it('expires stale commands and permits each result only once', () => {
    let now = 10_000;
    const onResult = vi.fn();
    const onExpired = vi.fn();
    const broker = new WebConnectorBroker({
      now: () => now,
      id: () => 'command-1',
      commandTtlMs: 60_000,
      onResult,
      onExpired,
    });
    broker.markPaired('chrome', '1.2.0');
    broker.enqueue(
      { id: 'edufine-purchase', browserId: 'chrome' },
      'https://klef.goe.go.kr',
    );
    const command = broker.claim('chrome', 'https://klef.goe.go.kr');
    expect(command?.commandId).toBe('command-1');
    expect(
      broker.complete('chrome', 'command-1', {
        ok: true,
        message: '품의 작성 화면을 열었습니다.',
      }),
    ).toBe(true);
    expect(broker.complete('chrome', 'command-1', { ok: true, message: '중복' })).toBe(false);
    expect(onResult).toHaveBeenCalledOnce();

    broker.enqueue(
      { id: 'edufine-purchase', browserId: 'chrome' },
      'https://klef.goe.go.kr',
    );
    now += 60_001;
    expect(broker.claim('chrome', 'https://klef.goe.go.kr')).toBeNull();
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it('reports pairing separately from a recent live connection', () => {
    let now = 5_000;
    const broker = new WebConnectorBroker({ now: () => now, connectedWindowMs: 5_000 });
    broker.markPaired('edge', '1.0.0');

    expect(broker.getStatus('edge')).toMatchObject({
      browserId: 'edge',
      paired: true,
      connected: true,
      extensionVersion: '1.0.0',
      lastSeenAt: 5_000,
    });
    now += 5_001;
    expect(broker.getStatus('edge')).toMatchObject({ paired: true, connected: false });
    expect(broker.getStatus('chrome')).toEqual({
      browserId: 'chrome',
      paired: false,
      connected: false,
    });
  });
});

describe('web connector token', () => {
  it('accepts only the exact non-empty token', () => {
    expect(isAuthorizedWebConnectorToken('safe-token', 'safe-token')).toBe(true);
    expect(isAuthorizedWebConnectorToken('safe-token-x', 'safe-token')).toBe(false);
    expect(isAuthorizedWebConnectorToken('', '')).toBe(false);
  });

  it('creates one persistent token and restores only validated browser pairings', async () => {
    const write = vi.fn(async () => undefined);
    const created = await loadWebConnectorState({
      read: async () => undefined,
      write,
      randomToken: () => 'a'.repeat(43),
    });
    expect(created).toEqual({ token: 'a'.repeat(43), pairings: {} });
    expect(write).toHaveBeenCalledWith(JSON.stringify(created, null, 2));

    write.mockClear();
    const restored = await loadWebConnectorState({
      read: async () => JSON.stringify({
        token: 'b'.repeat(43),
        pairings: {
          edge: { extensionVersion: '1.2.0' },
          chrome: { extensionVersion: '../bad' },
          safari: { extensionVersion: '1.0.0' },
        },
      }),
      write,
      randomToken: () => 'c'.repeat(43),
    });
    expect(restored).toEqual({
      token: 'b'.repeat(43),
      pairings: { edge: { extensionVersion: '1.2.0' } },
    });
    expect(write).not.toHaveBeenCalled();
  });
});
