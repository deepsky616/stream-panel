import { describe, expect, it } from 'vitest';
import {
  loadManagedWebConnectorState,
  markManagedHandshake,
} from '../src/main/services/webConnector/state';

describe('managed web connector state', () => {
  it('replaces legacy extension pairing data without carrying secrets forward', async () => {
    const writes: string[] = [];
    const legacy = JSON.stringify({
      token: 'secret-pairing-token',
      pairings: { edge: { extensionVersion: '1.2.1' } },
      port: 38_473,
      websocket: 'ws://127.0.0.1:38473/devtools/browser/secret',
    });

    const state = await loadManagedWebConnectorState({
      read: async () => legacy,
      write: async (text) => { writes.push(text); },
    });

    expect(state).toEqual({
      version: 1,
      offices: {},
      legacyExtensionNoticeShown: false,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toMatch(/secret|token|pairings|port|websocket/i);
  });

  it('keeps only valid office and browser handshake timestamps', async () => {
    const writes: string[] = [];
    const state = await loadManagedWebConnectorState({
      read: async () => JSON.stringify({
        version: 1,
        offices: {
          goe: {
            edge: { lastSeenAt: 1_800_000_000_000, pid: 4242 },
            safari: { lastSeenAt: 1_800_000_000_001 },
          },
          wrong: { chrome: { lastSeenAt: 1_800_000_000_002 } },
        },
        legacyExtensionNoticeShown: true,
        token: 'must-not-survive',
      }),
      write: async (text) => { writes.push(text); },
    });

    expect(state).toEqual({
      version: 1,
      offices: { goe: { edge: { lastSeenAt: 1_800_000_000_000 } } },
      legacyExtensionNoticeShown: true,
    });
    expect(JSON.stringify(state)).not.toMatch(/pid|token|safari|wrong/);
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toMatch(/pid|token|safari|wrong/);
  });

  it('updates one office and browser without mutating another handshake', () => {
    const initial = {
      version: 1 as const,
      offices: { goe: { edge: { lastSeenAt: 100 } } },
      legacyExtensionNoticeShown: false,
    };

    const updated = markManagedHandshake(initial, 'sen', 'chrome', 200);

    expect(updated).toEqual({
      version: 1,
      offices: {
        goe: { edge: { lastSeenAt: 100 } },
        sen: { chrome: { lastSeenAt: 200 } },
      },
      legacyExtensionNoticeShown: false,
    });
    expect(initial).toEqual({
      version: 1,
      offices: { goe: { edge: { lastSeenAt: 100 } } },
      legacyExtensionNoticeShown: false,
    });
  });
});
