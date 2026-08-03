import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem } from '../src/shared/types';
import {
  createWebConnectorService,
  resolveWebConnectorBrowserExecutable,
} from '../src/main/services/webConnector';

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((service) => service.stop()));
});

function workflowAction(): ActionItem {
  return {
    id: 'leave',
    kind: 'action',
    type: 'url',
    label: '나이스 복무',
    target: 'https://goe.neis.go.kr',
    args: [],
    icon: { kind: 'auto' },
    color: '#5B8CFF',
    position: 0,
    browser: {
      path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      appMode: false,
    },
    webWorkflow: { id: 'neis-leave', browserId: 'edge' },
  };
}

describe('web connector service', () => {
  it('resolves Windows and macOS browser executables through injected platform adapters', async () => {
    await expect(resolveWebConnectorBrowserExecutable('C:\\Edge\\msedge.exe', {
      platform: 'win32',
      exists: (path) => path === 'C:\\Edge\\msedge.exe',
    })).resolves.toBe('C:\\Edge\\msedge.exe');

    await expect(resolveWebConnectorBrowserExecutable('/Applications/Google Chrome.app', {
      platform: 'darwin',
      exists: (path) => path.endsWith('/Google Chrome'),
      resolveMacExecutable: async () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    })).resolves.toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

    await expect(resolveWebConnectorBrowserExecutable('/missing', {
      platform: 'linux',
      exists: () => true,
    })).resolves.toBeNull();

    await expect(resolveWebConnectorBrowserExecutable('/broken.app', {
      platform: 'darwin',
      exists: () => true,
      resolveMacExecutable: async () => { throw new Error('broken plist'); },
    })).resolves.toBeNull();
  });

  it('persists pairing, exposes a fragment-only setup token, and queues a fixed action', async () => {
    const writes: string[] = [];
    const notify = vi.fn();
    const service = createWebConnectorService({
      port: 0,
      extensionDirectory: '/app/browser-extension',
      notify,
      stateIo: {
        read: async () => undefined,
        write: async (text) => { writes.push(text); },
        randomToken: () => 't'.repeat(43),
      },
    });
    running.push(service);
    const started = await service.start();
    expect(started.ok).toBe(true);

    const setupUrl = service.getSetupUrl('edge');
    expect(setupUrl).not.toBeNull();
    const parsed = new URL(setupUrl!);
    expect(parsed.pathname).toBe('/setup');
    expect(parsed.search).toBe('');
    expect(parsed.hash).toContain(`token=${'t'.repeat(43)}`);
    expect(parsed.hash).toContain('browserId=edge');

    const token = new URLSearchParams(parsed.hash.slice(1)).get('token');
    const paired = await fetch(new URL('/v1/pair', parsed.origin), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ browserId: 'edge', extensionVersion: '1.0.0' }),
    });
    expect(paired.status).toBe(200);
    expect(service.getStatuses().find((status) => status.browserId === 'edge')).toMatchObject({
      paired: true,
      connected: true,
    });
    expect(JSON.parse(writes.at(-1)!)).toMatchObject({
      pairings: { edge: { extensionVersion: '1.0.0' } },
    });
    expect(service.queue(workflowAction())).toMatchObject({ queued: true });
    expect(service.extensionDirectory).toBe('/app/browser-extension');
    expect(notify).not.toHaveBeenCalled();
  });
});
