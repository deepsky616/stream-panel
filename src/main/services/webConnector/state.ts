import { randomBytes } from 'node:crypto';
import type { WebConnectorBrowserId } from '../../../shared/types';

export interface WebConnectorPairing {
  extensionVersion: string;
}

export interface WebConnectorState {
  token: string;
  pairings: Partial<Record<WebConnectorBrowserId, WebConnectorPairing>>;
}

export interface LoadWebConnectorStateOptions {
  read: () => Promise<string | undefined>;
  write: (text: string) => Promise<void>;
  randomToken?: () => string;
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+){1,3}$/.test(value) && value.length <= 32;
}

function readPairing(value: unknown): WebConnectorPairing | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== 'extensionVersion') ||
    !validVersion(record.extensionVersion)
  ) {
    return undefined;
  }
  return { extensionVersion: record.extensionVersion };
}

export async function loadWebConnectorState({
  read,
  write,
  randomToken = () => randomBytes(32).toString('base64url'),
}: LoadWebConnectorStateOptions): Promise<WebConnectorState> {
  try {
    const text = await read();
    if (text) {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (validToken(record.token)) {
          const rawPairings =
            record.pairings && typeof record.pairings === 'object' && !Array.isArray(record.pairings)
              ? (record.pairings as Record<string, unknown>)
              : {};
          const edge = readPairing(rawPairings.edge);
          const chrome = readPairing(rawPairings.chrome);
          return {
            token: record.token,
            pairings: {
              ...(edge ? { edge } : {}),
              ...(chrome ? { chrome } : {}),
            },
          };
        }
      }
    }
  } catch {
    // Invalid state is replaced with a fresh local pairing token.
  }
  const state: WebConnectorState = { token: randomToken(), pairings: {} };
  await write(JSON.stringify(state, null, 2));
  return state;
}
