import { randomBytes } from 'node:crypto';
import { EDUCATION_OFFICES } from '../../../shared/educationOffices';
import type {
  EducationOfficeCode,
  WebConnectorBrowserId,
} from '../../../shared/types';

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

export interface ManagedHandshakeState {
  lastSeenAt: number;
}

export interface ManagedWebConnectorState {
  version: 1;
  offices: Partial<
    Record<
      EducationOfficeCode,
      Partial<Record<WebConnectorBrowserId, ManagedHandshakeState>>
    >
  >;
  legacyExtensionNoticeShown: boolean;
}

export interface LoadManagedWebConnectorStateOptions {
  read: () => Promise<string | undefined>;
  write: (text: string) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readHandshake(value: unknown): ManagedHandshakeState | undefined {
  if (!isRecord(value)) return undefined;
  return Number.isSafeInteger(value.lastSeenAt) && Number(value.lastSeenAt) >= 0
    ? { lastSeenAt: Number(value.lastSeenAt) }
    : undefined;
}

function parseManagedState(text: string): ManagedWebConnectorState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.offices)) return null;
  const offices: ManagedWebConnectorState['offices'] = {};
  for (const { code } of EDUCATION_OFFICES) {
    const officeValue = parsed.offices[code];
    if (!isRecord(officeValue)) continue;
    const edge = readHandshake(officeValue.edge);
    const chrome = readHandshake(officeValue.chrome);
    if (edge || chrome) {
      offices[code] = {
        ...(edge ? { edge } : {}),
        ...(chrome ? { chrome } : {}),
      };
    }
  }
  return {
    version: 1,
    offices,
    legacyExtensionNoticeShown: parsed.legacyExtensionNoticeShown === true,
  };
}

export async function loadManagedWebConnectorState({
  read,
  write,
}: LoadManagedWebConnectorStateOptions): Promise<ManagedWebConnectorState> {
  try {
    const text = await read();
    if (text) {
      const parsed = parseManagedState(text);
      if (parsed) {
        const raw = JSON.parse(text) as unknown;
        if (JSON.stringify(raw) !== JSON.stringify(parsed)) {
          await write(JSON.stringify(parsed, null, 2));
        }
        return parsed;
      }
    }
  } catch {
    // Unreadable or invalid state is replaced with non-sensitive defaults.
  }
  const state: ManagedWebConnectorState = {
    version: 1,
    offices: {},
    legacyExtensionNoticeShown: false,
  };
  await write(JSON.stringify(state, null, 2));
  return state;
}

export function markManagedHandshake(
  state: ManagedWebConnectorState,
  officeCode: EducationOfficeCode,
  browserId: WebConnectorBrowserId,
  lastSeenAt: number,
): ManagedWebConnectorState {
  if (!Number.isSafeInteger(lastSeenAt) || lastSeenAt < 0) {
    throw new TypeError('브라우저 연결 시각이 올바르지 않습니다. 연결을 다시 시험해 주세요.');
  }
  return {
    ...state,
    offices: {
      ...state.offices,
      [officeCode]: {
        ...state.offices[officeCode],
        [browserId]: { lastSeenAt },
      },
    },
  };
}
