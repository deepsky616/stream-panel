import { EDUCATION_OFFICES } from '../../../shared/educationOffices';
import type {
  EducationOfficeCode,
  WebConnectorBrowserId,
} from '../../../shared/types';

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
