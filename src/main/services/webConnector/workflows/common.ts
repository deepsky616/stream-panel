import type { WebWorkflowId } from '../../../../shared/types';

export interface CandidateSummary {
  index: number;
  text: string;
  visible: boolean;
  enabled: boolean;
  width: number;
  height: number;
}

export type WorkflowPostcondition =
  | { kind: 'visible-any'; labels: readonly string[] }
  | { kind: 'visible-all'; labels: readonly string[] }
  | { kind: 'dialog-title-any'; labels: readonly string[] }
  | { kind: 'tab-selected-any'; labels: readonly string[] }
  | { kind: 'new-window'; processName: 'WXSClient'; titleIncludes: string };

export interface WorkflowStep {
  id: string;
  candidateLabels: readonly string[];
  interaction: 'mouse' | 'dom-click';
  postcondition: WorkflowPostcondition;
  maxChecks: 3;
  checkDelayMs: number;
}

export interface ManagedWorkflowDefinition {
  id: WebWorkflowId;
  label: string;
  finalState: string;
  steps: readonly WorkflowStep[];
}

const FORBIDDEN_ACTION_TOKENS = ['저장', '제출', '결재', '상신', '승인', '확정'] as const;
const APPROVED_NON_ACTION_LABELS = new Set(['표준서식(결재4인,협조4인)']);

export function normalizeCandidateText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function isForbiddenActionText(text: string): boolean {
  const normalized = normalizeCandidateText(text);
  if (APPROVED_NON_ACTION_LABELS.has(normalized)) return false;
  return FORBIDDEN_ACTION_TOKENS.some((token) => normalized.includes(token));
}

export function selectSafeCandidate(
  candidates: readonly CandidateSummary[],
  labels: readonly string[],
): CandidateSummary | null {
  const approved = new Set(labels.map(normalizeCandidateText).filter(Boolean));
  const exact = candidates.filter((candidate) => (
    candidate.visible &&
    candidate.enabled &&
    candidate.width > 0 &&
    candidate.height > 0 &&
    approved.has(normalizeCandidateText(candidate.text))
  ));
  const forbidden = exact.filter((candidate) => isForbiddenActionText(candidate.text));
  if (forbidden.length > 0) {
    throw new Error('저장·제출·상신·승인·결재·확정 동작은 자동으로 누를 수 없는 안전 제한 대상입니다. 화면에서 직접 진행해 주세요.');
  }
  if (exact.length > 1) {
    throw new Error('같은 이름의 메뉴가 둘 이상 보여 안전하게 고를 수 없습니다. 업무용 브라우저에서 직접 메뉴를 선택해 주세요.');
  }
  return exact[0] ?? null;
}
