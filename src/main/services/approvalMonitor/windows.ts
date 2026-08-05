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
}
