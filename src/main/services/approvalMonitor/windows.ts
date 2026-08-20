import { getEducationOffice, isAllowedOfficeHost } from '../../../shared/educationOffices';
import type {
  WebWorkflowSystem,
} from '../../../shared/types';
import { isAllowedWebWorkflowTarget } from '../../../shared/webWorkflows';
import type { ManagedBrowserSession } from '../webConnector/sessionManager';
import type { WorkflowPageAdapter } from '../webConnector/workflows/engine';
import { runWorkflow } from '../webConnector/workflows/engine';
import { APPROVAL_INBOX_WORKFLOW_ROUTES, type ApprovalScanInput } from './definitions';
import { throwIfApprovalCheckCancelled } from './cancellation';

export interface WindowsApprovalPage extends WorkflowPageAdapter {
  currentOrigin(): Promise<string>;
  activate?(): Promise<void>;
  release?(options?: { keepCreatedTargets?: boolean }): Promise<void>;
  readApprovalCount(system: WebWorkflowSystem): Promise<number>;
}

export interface WindowsApprovalScanDependencies {
  openPage(
    session: ManagedBrowserSession,
    input: ApprovalScanInput,
    signal?: AbortSignal,
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
  previous?: ApprovalCounterSignal;
  next?: ApprovalCounterSignal;
  parent?: ApprovalCounterSignal;
}

interface ApprovalListSnapshot {
  candidates: ApprovalCounterCandidate[];
  rowCounts: ApprovalRowCountCandidate[];
  emptyList: boolean;
  listReady: boolean;
}

interface ApprovalRowCountCandidate {
  count: number;
  area: number;
  relevant: boolean;
  source: 'dom' | 'nexacro';
}

const COUNTER_LABELS: Record<WebWorkflowSystem, readonly string[]> = {
  neis: ['Total', 'TOTAL', 'total'],
  edufine: ['총', 'Total', 'TOTAL', 'total'],
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
      remainder.match(/^(?:[:：·])?(\d{1,4})건$/) ??
      remainder.match(/^(?:[:：·]|총)?(\d{1,4})건(?:$|[^\d])/) ??
      remainder.match(/^(?:[:：·])?(\d{1,4})(?:건)?(?:[([/]|$)/) ??
      remainder.match(/^(?:[:：·])?(\d{1,4})$/);
    if (match) return Number(match[1]);
  }
  if (compact.endsWith(compactLabel)) {
    const match = compact.slice(0, -compactLabel.length).match(/^(\d{1,4})건$/);
    if (match) return Number(match[1]);
  }
  return null;
}

function bareSignalCount(
  signal: ApprovalCounterSignal,
  allowUnmarked = false,
): number | null {
  const match = [signal.text, signal.ariaLabel, signal.title].map(compactText).map((text) => (
    text.match(/^(?:[([{])?(\d{1,4})(?:[)\]}]|건)?$/)
  )).find(Boolean);
  if (!match) return null;
  const markedAsCount = /badge|count|counter|cnt|number|num|alarm|noti/i.test(signal.className) ||
    signal.role === 'status' ||
    signal.ariaLabel !== '' ||
    signal.title !== '';
  return markedAsCount || allowUnmarked ? Number(match[1]) : null;
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
    (record.previous === undefined || isCounterSignal(record.previous)) &&
    (record.next === undefined || isCounterSignal(record.next)) &&
    (record.parent === undefined || isCounterSignal(record.parent));
}

function isRowCountCandidate(value: unknown): value is ApprovalRowCountCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isSafeInteger(record.count) && Number(record.count) >= 0 && Number(record.count) <= 9_999 &&
    typeof record.area === 'number' && Number.isFinite(record.area) && record.area >= 0 && record.area <= 100_000_000 &&
    typeof record.relevant === 'boolean' &&
    (record.source === 'dom' || record.source === 'nexacro');
}

function readApprovalListSnapshot(value: unknown): ApprovalListSnapshot {
  if (Array.isArray(value)) {
    if (value.length > 100 || !value.every(isCounterCandidate)) {
      throw new Error('결재 목록 자료가 올바르지 않습니다. 결재함 화면을 직접 확인해 주세요.');
    }
    return { candidates: value, rowCounts: [], emptyList: false, listReady: false };
  }
  if (!value || typeof value !== 'object') {
    throw new Error('결재 목록 자료가 올바르지 않습니다. 결재함 화면을 직접 확인해 주세요.');
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.candidates) ||
    record.candidates.length > 100 ||
    !record.candidates.every(isCounterCandidate) ||
    !Array.isArray(record.rowCounts) ||
    record.rowCounts.length > 50 ||
    !record.rowCounts.every((count) => (
      isRowCountCandidate(count) ||
      (Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 9_999)
    )) ||
    typeof record.emptyList !== 'boolean' ||
    (record.listReady !== undefined && typeof record.listReady !== 'boolean')
  ) {
    throw new Error('결재 목록 자료가 올바르지 않습니다. 결재함 화면을 직접 확인해 주세요.');
  }
  const rowCounts = record.rowCounts.map((candidate): ApprovalRowCountCandidate => (
    isRowCountCandidate(candidate)
      ? candidate
      : { count: Number(candidate), area: 0, relevant: true, source: 'dom' }
  ));
  return {
    candidates: record.candidates,
    rowCounts,
    emptyList: record.emptyList,
    listReady: record.listReady === true || rowCounts.some((candidate) => candidate.relevant),
  };
}

export function parseApprovalCounterCandidates(
  system: WebWorkflowSystem,
  value: unknown,
  requireListReady = false,
): number {
  const snapshot = readApprovalListSnapshot(value);
  if (requireListReady && !snapshot.listReady) {
    throw new Error('결재 목록이 아직 준비되지 않았습니다. 결재함 화면이 열릴 때까지 기다려 주세요.');
  }
  // The actual approval table is authoritative. This prevents page-size
  // controls such as "전체 100" or a stale summary badge from overriding the
  // rows that are really present in the opened inbox.
  const relevantRows = snapshot.rowCounts.filter((candidate) => candidate.relevant);
  if (relevantRows.length > 0) {
    const largestArea = Math.max(...relevantRows.map((candidate) => candidate.area));
    const counts = new Set(relevantRows.filter((candidate) => candidate.area === largestArea).map(
      (candidate) => parseApprovalCounterValue(candidate.count),
    ));
    if (counts.size === 1) return [...counts][0];
    if (counts.size > 1) {
      throw new Error('결재 목록 표가 둘 이상 보여 대기 건수를 안전하게 고를 수 없습니다. 결재함 화면을 직접 확인해 주세요.');
    }
  }
  if (snapshot.listReady && snapshot.emptyList) return 0;
  for (const label of COUNTER_LABELS[system]) {
    const counts = new Set<number>();
    for (const candidate of snapshot.candidates) {
      const candidateTexts = [candidate.text, candidate.ariaLabel, candidate.title];
      for (const text of candidateTexts) {
        const count = inlineCount(text, label);
        if (count !== null) counts.add(parseApprovalCounterValue(count));
      }
      const relatedSignals = [
        candidate,
        ...candidate.children,
        ...(candidate.previous ? [candidate.previous] : []),
        ...(candidate.next ? [candidate.next] : []),
        ...(candidate.parent ? [candidate.parent] : []),
      ];
      for (const signal of relatedSignals) {
        for (const text of [signal.text, signal.ariaLabel, signal.title]) {
          const count = inlineCount(text, label);
          if (count !== null) counts.add(parseApprovalCounterValue(count));
        }
      }
      const hasExactLabel = relatedSignals.some((signal) => (
        [signal.text, signal.ariaLabel, signal.title].some((text) => (
          compactText(text).replace(/[:：·]$/, '') === compactText(label)
        ))
      ));
      if (!hasExactLabel) continue;
      const signals = [
        ...candidate.children,
        ...(candidate.previous ? [candidate.previous] : []),
        ...(candidate.next ? [candidate.next] : []),
      ];
      for (const signal of signals) {
        const count = bareSignalCount(signal, true);
        if (count !== null) counts.add(parseApprovalCounterValue(count));
      }
    }
    if (counts.size > 1) {
      throw new Error(`'${label}' 결재 대기 수가 둘 이상 보여 안전하게 고를 수 없습니다. 결재함 화면을 직접 확인해 주세요.`);
    }
    if (counts.size === 1) return [...counts][0];
  }
  throw new Error('결재 대기 수를 안전하게 읽지 못했습니다. 결재함 화면을 직접 확인해 주세요.');
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
  signal?: AbortSignal,
): Promise<number> {
  throwIfApprovalCheckCancelled(signal);
  if (session.officeCode !== input.officeCode || session.browserId !== input.browserId) {
    throw new Error('결재 대기 확인 요청과 업무용 브라우저 세션이 다릅니다. 브라우저 연결을 다시 시험해 주세요.');
  }
  const page = await dependencies.openPage(session, input, signal);
  let releaseHandled = false;
  try {
    const assertOrigin = async () => {
      throwIfApprovalCheckCancelled(signal);
      assertApprovalOrigin(await page.currentOrigin(), input);
      throwIfApprovalCheckCancelled(signal);
    };
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
      async checkCurrentState(step) {
        await assertOrigin();
        return page.checkCurrentState?.(step) ?? false;
      },
      async checkPostcondition(step) {
        await assertOrigin();
        return page.checkPostcondition(step);
      },
      async wait(delayMs) {
        throwIfApprovalCheckCancelled(signal);
        await page.wait(delayMs);
        throwIfApprovalCheckCancelled(signal);
      },
    };
    const routes = APPROVAL_INBOX_WORKFLOW_ROUTES[input.system];
    let completed = routes.length === 0;
    let routeError: unknown;
    for (const [index, route] of routes.entries()) {
      try {
        await runWorkflow(route, guardedPage, { signal });
        completed = true;
        routeError = undefined;
        break;
      } catch (error) {
        routeError = error;
        const recoverable = error instanceof Error &&
          /메뉴를 찾지 못했습니다|기대한 화면을 확인하지 못했습니다|같은 이름의 메뉴가 둘 이상/.test(
            error.message,
          );
        if (index === routes.length - 1 || !recoverable) throw error;
      }
    }
    if (!completed) throw routeError;
    let countError: unknown;
    let stableEdufineCount: number | undefined;
    let stableEdufineReads = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      throwIfApprovalCheckCancelled(signal);
      await assertOrigin();
      try {
        const count = parseApprovalCounterValue(await page.readApprovalCount(input.system));
        await assertOrigin();
        if (input.system === 'edufine') {
          stableEdufineReads = count === stableEdufineCount ? stableEdufineReads + 1 : 1;
          stableEdufineCount = count;
          if (stableEdufineReads < 2) {
            countError = new Error('에듀파인 결재대기 목록 건수가 아직 안정되지 않았습니다.');
            if (attempt < 19) await page.wait(250);
            continue;
          }
        }
        if (input.interactive && input.system !== 'edufine') {
          try {
            await page.activate?.();
          } catch {
            // The verified count remains valid even if Windows refuses focus.
          }
        }
        return count;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!/결재 대기 수|업무 화면을 읽지 못했습니다/.test(message)) throw error;
        countError = error;
      }
      if (attempt < 19) await page.wait(250);
    }
    throw countError;
  } catch (error) {
    if (input.interactive && input.system !== 'edufine' && !signal?.aborted) {
      try {
        await page.activate?.();
      } catch {
        // The original check error is more useful than a best-effort focus failure.
      }
      if (page.release) {
        releaseHandled = true;
        try {
          await page.release({ keepCreatedTargets: true });
        } catch {
          // Preserve the original check error.
        }
      }
    }
    throw error;
  } finally {
    if (!releaseHandled) await page.release?.();
  }
}
