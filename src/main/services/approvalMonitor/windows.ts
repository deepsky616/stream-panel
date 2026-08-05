import { getEducationOffice, isAllowedOfficeHost } from '../../../shared/educationOffices';
import type {
  WebWorkflowSystem,
} from '../../../shared/types';
import { isAllowedWebWorkflowTarget } from '../../../shared/webWorkflows';
import type { ManagedBrowserSession } from '../webConnector/sessionManager';
import type { WorkflowPageAdapter } from '../webConnector/workflows/engine';
import { runWorkflow } from '../webConnector/workflows/engine';
import { APPROVAL_INBOX_WORKFLOWS, type ApprovalScanInput } from './definitions';

export interface WindowsApprovalPage extends WorkflowPageAdapter {
  currentOrigin(): Promise<string>;
  release?(): Promise<void>;
  readApprovalCount(system: WebWorkflowSystem): Promise<number>;
}

export interface WindowsApprovalScanDependencies {
  openPage(
    session: ManagedBrowserSession,
    input: ApprovalScanInput,
  ): Promise<WindowsApprovalPage>;
}

export function parseApprovalCounterValue(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 9_999) {
    throw new Error('결재 대기 수를 안전하게 읽지 못했습니다. 결재함 화면을 직접 확인해 주세요.');
  }
  return Number(value);
}

interface ApprovalCounterSignal {
  text: string;
  ariaLabel: string;
  title: string;
  className: string;
  role: string;
}

interface ApprovalCounterCandidate extends ApprovalCounterSignal {
  children: ApprovalCounterSignal[];
  next?: ApprovalCounterSignal;
}

const COUNTER_LABELS: Record<WebWorkflowSystem, readonly string[]> = {
  neis: ['결재 대기', '결재대기', '미결문서', '대기문서', '미결'],
  edufine: ['결재 대기', '결재대기', '결재할 문서', '미결문서', '대기문서'],
};

function compactText(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function inlineCount(text: string, label: string): number | null {
  const compact = compactText(text);
  const compactLabel = compactText(label);
  if (compact.startsWith(compactLabel)) {
    const remainder = compact.slice(compactLabel.length);
    const match = remainder.match(/^(?:[:：·])?[([{](\d{1,4})[)\]}]$/) ??
      remainder.match(/^(?:[:：·])?(\d{1,4})건$/);
    if (match) return Number(match[1]);
  }
  if (compact.endsWith(compactLabel)) {
    const match = compact.slice(0, -compactLabel.length).match(/^(\d{1,4})건$/);
    if (match) return Number(match[1]);
  }
  return null;
}

function bareSignalCount(signal: ApprovalCounterSignal): number | null {
  const match = compactText(signal.text).match(/^(?:[([{])?(\d{1,4})(?:[)\]}]|건)?$/);
  if (!match) return null;
  const markedAsCount = /badge|count|counter|cnt|number|num|alarm|noti/i.test(signal.className) ||
    signal.role === 'status' ||
    signal.ariaLabel !== '' ||
    signal.title !== '';
  return markedAsCount ? Number(match[1]) : null;
}

function isCounterSignal(value: unknown): value is ApprovalCounterSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['text', 'ariaLabel', 'title', 'className', 'role'].every((key) => (
    typeof record[key] === 'string' && String(record[key]).length <= 256
  ));
}

function isCounterCandidate(value: unknown): value is ApprovalCounterCandidate {
  if (!isCounterSignal(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return Array.isArray(record.children) &&
    record.children.length <= 16 &&
    record.children.every(isCounterSignal) &&
    (record.next === undefined || isCounterSignal(record.next));
}

export function parseApprovalCounterCandidates(
  system: WebWorkflowSystem,
  value: unknown,
): number {
  if (!Array.isArray(value) || value.length > 100 || !value.every(isCounterCandidate)) {
    throw new Error('결재 대기 수 자료가 올바르지 않습니다. 결재함 화면을 직접 확인해 주세요.');
  }
  const counts = new Set<number>();
  for (const candidate of value) {
    const candidateTexts = [candidate.text, candidate.ariaLabel, candidate.title];
    for (const label of COUNTER_LABELS[system]) {
      for (const text of candidateTexts) {
        const count = inlineCount(text, label);
        if (count !== null) counts.add(parseApprovalCounterValue(count));
      }
      const hasExactLabel = candidateTexts.some((text) => compactText(text) === compactText(label));
      if (!hasExactLabel) continue;
      const signals = candidate.next
        ? [...candidate.children, candidate.next]
        : candidate.children;
      for (const signal of signals) {
        const count = bareSignalCount(signal);
        if (count !== null) counts.add(parseApprovalCounterValue(count));
      }
    }
  }
  if (counts.size === 0) {
    throw new Error('결재 대기 수를 안전하게 읽지 못했습니다. 결재함 화면을 직접 확인해 주세요.');
  }
  if (counts.size > 1) {
    throw new Error('결재 대기 수가 둘 이상 보여 안전하게 고를 수 없습니다. 결재함 화면을 직접 확인해 주세요.');
  }
  return [...counts][0];
}

function approvalWorkflowId(system: WebWorkflowSystem) {
  return system === 'neis' ? 'neis-approval-inbox' as const : 'edufine-approval-inbox' as const;
}

function assertApprovalOrigin(origin: string, input: ApprovalScanInput): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('결재함 주소를 확인하지 못했습니다. 업무용 브라우저를 닫고 다시 열어 주세요.');
  }
  if (url.origin === new URL(getEducationOffice(input.officeCode).portalUrl).origin) {
    throw new Error('업무 시스템 로그인이 필요합니다. 업무용 브라우저에서 직접 로그인한 뒤 다시 확인해 주세요.');
  }
  if (
    !isAllowedOfficeHost(input.officeCode, url.href) ||
    !isAllowedWebWorkflowTarget(approvalWorkflowId(input.system), url.href, input.officeCode)
  ) {
    throw new Error('허용되지 않은 주소로 이동해 결재 대기 확인을 중단했습니다. 업무용 브라우저 주소를 직접 확인해 주세요.');
  }
}

export async function scanWindowsApprovalCount(
  session: ManagedBrowserSession,
  input: ApprovalScanInput,
  dependencies: WindowsApprovalScanDependencies,
): Promise<number> {
  if (session.officeCode !== input.officeCode || session.browserId !== input.browserId) {
    throw new Error('결재 대기 확인 요청과 업무용 브라우저 세션이 다릅니다. 브라우저 연결을 다시 시험해 주세요.');
  }
  const page = await dependencies.openPage(session, input);
  try {
    const assertOrigin = async () => assertApprovalOrigin(await page.currentOrigin(), input);
    await assertOrigin();
    const guardedPage: WorkflowPageAdapter = {
      async inspectCandidates(step) {
        await assertOrigin();
        return page.inspectCandidates(step);
      },
      async pressCandidate(candidate, step) {
        await assertOrigin();
        await page.pressCandidate(candidate, step);
        await assertOrigin();
      },
      async checkPostcondition(step) {
        await assertOrigin();
        return page.checkPostcondition(step);
      },
      wait: (delayMs) => page.wait(delayMs),
    };
    await runWorkflow(APPROVAL_INBOX_WORKFLOWS[input.system], guardedPage);
    await assertOrigin();
    const count = parseApprovalCounterValue(await page.readApprovalCount(input.system));
    await assertOrigin();
    return count;
  } finally {
    await page.release?.();
  }
}
