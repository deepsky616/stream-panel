import { appendFile, mkdir } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { isEducationOfficeCode } from '../../../shared/educationOffices';
import type {
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebWorkflowSystem,
  WebWorkflowId,
} from '../../../shared/types';
import {
  isWebConnectorBrowserId,
  isWebWorkflowId,
} from '../../../shared/webWorkflows';

export type WebConnectorDiagnosticOutcome = 'success' | 'failed' | 'cancelled';

export interface WebConnectorDiagnosticInput {
  at: number;
  browserId: WebConnectorBrowserId;
  officeCode: EducationOfficeCode;
  system?: WebWorkflowSystem;
  workflowId?: WebWorkflowId;
  stepId: string;
  sequence: number;
  outcome: WebConnectorDiagnosticOutcome;
  durationMs: number;
  currentUrl?: string;
}

export interface WebConnectorDiagnosticEntry {
  at: number;
  browserId: WebConnectorBrowserId;
  officeCode: EducationOfficeCode;
  system?: WebWorkflowSystem;
  workflowId?: WebWorkflowId;
  stepId: string;
  sequence: number;
  outcome: WebConnectorDiagnosticOutcome;
  durationMs: number;
  host?: string;
}

export interface CreateWebConnectorDiagnosticsOptions {
  userDataPath: string;
  platform?: 'win32' | 'darwin';
  makeDirectory?: (
    path: string,
    options: { recursive: true; mode: number },
  ) => Promise<unknown>;
  appendText?: (path: string, text: string) => Promise<void>;
}

export interface WebConnectorDiagnostics {
  readonly directory: string;
  record(input: WebConnectorDiagnosticInput): Promise<void>;
}

function diagnosticHost(currentUrl: string | undefined): string | undefined {
  if (!currentUrl || currentUrl.length > 4_096) return undefined;
  try {
    const url = new URL(currentUrl);
    return url.hostname || undefined;
  } catch {
    return undefined;
  }
}

export function createDiagnosticEntry(
  input: WebConnectorDiagnosticInput,
): WebConnectorDiagnosticEntry {
  if (
    !Number.isSafeInteger(input.at) ||
    input.at < 0 ||
    !isWebConnectorBrowserId(input.browserId) ||
    !isEducationOfficeCode(input.officeCode) ||
    (input.system !== undefined && !['neis', 'edufine'].includes(input.system)) ||
    (input.workflowId !== undefined && !isWebWorkflowId(input.workflowId)) ||
    typeof input.stepId !== 'string' ||
    !/^[a-z0-9-]{1,64}$/.test(input.stepId) ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 0 ||
    !['success', 'failed', 'cancelled'].includes(input.outcome) ||
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs < 0 ||
    input.durationMs > 86_400_000
  ) {
    throw new TypeError('웹 업무 진단 값이 올바르지 않습니다. 연결을 다시 시험해 주세요.');
  }
  const host = diagnosticHost(input.currentUrl);
  return {
    at: input.at,
    browserId: input.browserId,
    officeCode: input.officeCode,
    ...(input.system ? { system: input.system } : {}),
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    stepId: input.stepId,
    sequence: input.sequence,
    outcome: input.outcome,
    durationMs: input.durationMs,
    ...(host ? { host } : {}),
  };
}

export function createWebConnectorDiagnostics({
  userDataPath,
  platform = process.platform === 'win32' ? 'win32' : 'darwin',
  makeDirectory = (path, options) => mkdir(path, options),
  appendText = (path, text) => appendFile(path, text, { encoding: 'utf8', mode: 0o600 }),
}: CreateWebConnectorDiagnosticsOptions): WebConnectorDiagnostics {
  const api = platform === 'win32' ? win32 : posix;
  if (!api.isAbsolute(userDataPath)) {
    throw new TypeError('웹 업무 진단 폴더는 절대 경로여야 합니다. 앱 설정 폴더를 확인해 주세요.');
  }
  const root = api.resolve(userDataPath, 'web-connector');
  const directory = api.resolve(root, 'diagnostics');
  if (!directory.startsWith(`${root}${api.sep}`)) {
    throw new TypeError('웹 업무 진단 폴더가 허용된 위치를 벗어났습니다. 앱을 다시 시작해 주세요.');
  }
  const logPath = api.join(directory, 'events.jsonl');
  return {
    directory,
    async record(input) {
      const entry = createDiagnosticEntry(input);
      await makeDirectory(directory, { recursive: true, mode: 0o700 });
      await appendText(logPath, `${JSON.stringify(entry)}\n`);
    },
  };
}
