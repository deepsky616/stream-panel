import type { WebWorkflowId, WebWorkflowSpec } from '../../../../shared/types';

export interface CandidateSummary {
  index: number;
  text: string;
  visible: boolean;
  enabled: boolean;
  width: number;
  height: number;
  navigation?: boolean;
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
  navigationOnly?: boolean;
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

const FORBIDDEN_ACTION_TOKENS = [
  '저장',
  '제출',
  '결재',
  '상신',
  '승인',
  '확정',
  '삭제',
  '취소',
  '확인',
  '지급',
  '송금',
  '이체',
  '발송',
  '인증서',
  '비밀번호',
  '암호',
  '등록',
  '신청',
  '요청',
  '완료',
  '반려',
  '서명',
  '동의',
  '전송',
  '처리',
] as const;
const APPROVED_NON_ACTION_LABELS = new Set([
  '신청',
  '품의등록',
  '표준서식(결재4인,협조4인)',
  '결재함',
  '결재 대기',
  '결재대기',
  '미결',
  '미결문서',
  '대기문서',
  '결재할 문서',
]);

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
  navigationOnly = false,
): CandidateSummary | null {
  const approved = new Set(labels.map(normalizeCandidateText).filter(Boolean));
  const exact = candidates.filter((candidate) => (
    candidate.visible &&
    candidate.enabled &&
    candidate.width > 0 &&
    candidate.height > 0 &&
    (!navigationOnly || candidate.navigation === true) &&
    approved.has(normalizeCandidateText(candidate.text))
  ));
  const forbidden = exact.filter((candidate) => isForbiddenActionText(candidate.text));
  if (forbidden.length > 0) {
    throw new Error('저장·제출·상신·승인·결재·확정·삭제·취소·확인·지급·송금·이체·발송·등록·신청·요청·완료·반려·서명·동의·전송·처리와 인증 입력은 자동으로 누를 수 없는 안전 제한 대상입니다. 화면에서 직접 진행해 주세요.');
  }
  if (exact.length > 1) {
    throw new Error('같은 이름의 메뉴가 둘 이상 보여 안전하게 고를 수 없습니다. 업무용 브라우저에서 직접 메뉴를 선택해 주세요.');
  }
  return exact[0] ?? null;
}

export function createCustomManagedWorkflowDefinition(
  spec: WebWorkflowSpec,
): ManagedWorkflowDefinition {
  if (spec.id !== 'custom') {
    throw new Error('사용자 지정 웹 업무 자료가 아닙니다. 편집기에서 업무 키를 다시 만들어 주세요.');
  }
  return {
    id: 'custom',
    label: spec.custom.name,
    finalState: 'custom-target-ready',
    steps: spec.custom.steps.map((step, index) => ({
      id: step.id,
      candidateLabels: [step.label],
      interaction: 'mouse',
      navigationOnly: true,
      postcondition: {
        kind: 'visible-any',
        labels: [spec.custom.steps[index + 1]?.label ?? spec.custom.finalText],
      },
      maxChecks: 3,
      checkDelayMs: 250,
    })),
  };
}
