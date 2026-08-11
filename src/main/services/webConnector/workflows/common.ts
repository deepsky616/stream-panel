import type { WebWorkflowId, WebWorkflowSpec } from '../../../../shared/types';
import { customWorkflowStepRequiresConfirmation } from '../../../../shared/webWorkflows';

export interface CandidateSummary {
  index: number;
  text: string;
  visible: boolean;
  enabled: boolean;
  width: number;
  height: number;
  left?: number;
  top?: number;
  navigation?: boolean;
  safeNavigation?: boolean;
  tag?: string;
  inputType?: string;
  href?: string;
  formAssociated?: boolean;
  inlineHandler?: boolean;
  visibleText?: string;
  accessibleName?: string;
  titleText?: string;
  valueText?: string;
  contextText?: string;
  shadowedByEquivalentDescendant?: boolean;
}

export type WorkflowPostcondition =
  | { kind: 'visible-any'; labels: readonly string[] }
  | { kind: 'edufine-mega-menu-any'; labels: readonly string[] }
  | { kind: 'visible-all'; labels: readonly string[] }
  | { kind: 'visible-groups'; groups: readonly (readonly string[])[] }
  | { kind: 'dialog-title-any'; labels: readonly string[] }
  | { kind: 'tab-selected-any'; labels: readonly string[] }
  | { kind: 'new-page-any'; labels: readonly string[] }
  | { kind: 'new-window'; processName: 'WXSClient'; titleIncludes: string };

export interface WorkflowStep {
  id: string;
  candidateLabels: readonly string[];
  interaction:
    | 'mouse'
    | 'dom-click'
    | 'frame-exact-text'
    | 'edufine-job'
    | 'edufine-job-toggle'
    | 'edufine-job-option'
    | 'edufine-left-menu'
    | 'edufine-left-toggle'
    | 'edufine-top-menu'
    | 'edufine-mega-menu'
    | 'edufine-exact-text';
  selection?: 'unique-any' | 'first-available';
  navigationOnly?: boolean;
  menuOnly?: boolean;
  contextLabels?: readonly string[];
  requiresConfirmation?: boolean;
  allowActionText?: boolean;
  /** Resume a built-in workflow when this step's destination is already visible. */
  skipWhenSatisfied?: boolean;
  postcondition: WorkflowPostcondition;
  maxChecks: number;
  checkDelayMs: number;
}

export interface ManagedWorkflowDefinition {
  id: WebWorkflowId;
  label: string;
  finalState: string;
  steps: readonly WorkflowStep[];
}

export const FORBIDDEN_ACTION_TOKENS = [
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
export const APPROVED_NON_ACTION_LABELS = new Set([
  '신청',
  '신청(새 창 열기)',
  '품의등록',
  '품의 등록',
  '표준서식(결재4인,협조4인)',
  '표준서식(결재 4인, 협조 4인)',
  '표준서식(결재4인, 협조4인)',
  '표준서식(결재 4인,협조 4인)',
  '결재함',
  '결재 대기',
  '결재대기',
  '결재대기함',
  '결재 대기함',
  '미결',
  '미결문서',
  '대기문서',
  '결재할 문서',
  '내 결재함',
  '결재문서함',
  '미결/협조함',
  '미결 / 협조함',
  '결재(긴급)',
  '결재 (긴급)',
]);

export function normalizeCandidateText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function isForbiddenActionText(text: string): boolean {
  const normalized = normalizeCandidateText(text);
  if (APPROVED_NON_ACTION_LABELS.has(normalized)) return false;
  return FORBIDDEN_ACTION_TOKENS.some((token) => normalized.includes(token));
}

function candidateMatchesLabel(candidate: CandidateSummary, label: string): boolean {
  const expected = normalizeCandidateText(label);
  return normalizeCandidateText(candidate.text) === expected;
}

function candidateOwnActionTexts(candidate: CandidateSummary): string[] {
  return [
    candidate.text,
    candidate.accessibleName,
    candidate.titleText,
    candidate.valueText,
  ].filter((text): text is string => typeof text === 'string' && text.trim() !== '');
}

function candidateMatchesContext(
  candidate: CandidateSummary,
  contextLabels: readonly string[],
): boolean {
  if (contextLabels.length === 0) return true;
  const context = normalizeCandidateText(candidate.contextText);
  return contextLabels.every((label) => context.includes(normalizeCandidateText(label)));
}

export function selectSafeCandidate(
  candidates: readonly CandidateSummary[],
  labels: readonly string[],
  navigationOnly = false,
  selection: WorkflowStep['selection'] = 'unique-any',
  contextLabels: readonly string[] = [],
  menuOnly = false,
  allowConfirmedAction = false,
): CandidateSummary | null {
  const eligible = candidates.filter((candidate) => (
    candidate.visible &&
    candidate.enabled &&
    candidate.width > 0 &&
    candidate.height > 0 &&
    candidate.shadowedByEquivalentDescendant !== true &&
    candidateMatchesContext(candidate, contextLabels) &&
    (!menuOnly || (
      candidate.navigation === true &&
      candidate.formAssociated !== true &&
      candidate.inputType !== 'submit' &&
      candidate.inputType !== 'image'
    )) &&
    (!navigationOnly || (
      candidate.navigation === true &&
      candidate.safeNavigation === true
    ))
  ));
  const exact = selection === 'first-available'
    ? labels.reduce<CandidateSummary[]>((selected, label) => {
        if (selected.length > 0) return selected;
        const matches = eligible.filter((candidate) => candidateMatchesLabel(candidate, label));
        if (matches.length === 0) return selected;
        return [[...matches].sort((left, right) => (
          (left.top ?? Number.MAX_SAFE_INTEGER) - (right.top ?? Number.MAX_SAFE_INTEGER) ||
          (left.left ?? Number.MAX_SAFE_INTEGER) - (right.left ?? Number.MAX_SAFE_INTEGER) ||
          left.index - right.index
        ))[0]];
      }, [])
    : eligible.filter((candidate) => labels.some((label) => candidateMatchesLabel(candidate, label)));
  const allowedConfirmedLabels = new Set(labels.map(normalizeCandidateText));
  const forbidden = exact.filter((candidate) => candidateOwnActionTexts(candidate).some((text) => (
    isForbiddenActionText(text) &&
    (!allowConfirmedAction || !allowedConfirmedLabels.has(normalizeCandidateText(text)))
  )));
  if (forbidden.length > 0) {
    throw new Error('지금 누르려는 항목 자체가 저장·제출·상신·승인·결재·삭제·송금·인증 입력 같은 중요 동작이어서 자동 실행을 중단했습니다. 화면에서 직접 확인해 주세요.');
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
    steps: spec.custom.steps.map((step, index) => {
      const requiresConfirmation = customWorkflowStepRequiresConfirmation(step.label);
      const interaction: WorkflowStep['interaction'] = spec.custom.system === 'edufine'
        ? {
            'edufine-job': 'edufine-job' as const,
            'edufine-top-menu': 'edufine-top-menu' as const,
            'edufine-mega-menu': 'edufine-mega-menu' as const,
            'edufine-left-menu': 'edufine-left-menu' as const,
            'exact-text': 'frame-exact-text' as const,
          }[step.kind ?? 'exact-text']
        : 'frame-exact-text';
      const nextLabel = spec.custom.steps[index + 1]?.label ?? spec.custom.finalText;
      const constrainedEdufineMenu = interaction.startsWith('edufine-');
      return {
        id: step.id,
        candidateLabels: [step.label],
        interaction,
        selection: 'first-available',
        navigationOnly: false,
        ...(requiresConfirmation && !constrainedEdufineMenu ? { requiresConfirmation: true } : {}),
        ...(requiresConfirmation && constrainedEdufineMenu ? { allowActionText: true } : {}),
        skipWhenSatisfied: interaction !== 'edufine-top-menu',
        postcondition: interaction === 'edufine-top-menu'
          ? { kind: 'edufine-mega-menu-any' as const, labels: [nextLabel] }
          : { kind: 'visible-any' as const, labels: [nextLabel] },
        maxChecks: 67,
        checkDelayMs: 150,
      };
    }),
  };
}
