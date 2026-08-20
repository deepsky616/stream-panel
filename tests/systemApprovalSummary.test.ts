import { describe, expect, it } from 'vitest';
import {
  parseSystemApprovalCount,
  SYSTEM_APPROVAL_SUMMARY_EXPRESSION,
} from '../src/main/services/approvalMonitor/systemSummary';

function candidate(
  system: 'neis' | 'edufine',
  value: number,
  confidence = 100,
  controlContext = 'global approval badge',
) {
  return {
    system,
    value,
    itemLabel: system === 'neis' ? '미결/협조함' : '결재(긴급)',
    relation: 'inline',
    confidence,
    controlContext,
  };
}

describe('connected system approval summary', () => {
  it('prefers the exact system badge over weaker nearby numbers', () => {
    expect(parseSystemApprovalCount([{ candidates: [
      candidate('edufine', 1, 100),
      candidate('edufine', 100, 80),
    ] }], 'edufine')).toBe(1);
  });

  it('accepts zero and rejects page controls and conflicting exact badges', () => {
    expect(parseSystemApprovalCount([
      { candidates: [candidate('neis', 0)] },
    ], 'neis')).toBe(0);
    expect(() => parseSystemApprovalCount([{ candidates: [
      candidate('edufine', 100, 100, '페이지당 100건'),
    ] }], 'edufine')).toThrow(/전역 건수를 찾지 못했습니다/);
    expect(() => parseSystemApprovalCount([{ candidates: [
      candidate('neis', 1),
      candidate('neis', 2),
    ] }], 'neis')).toThrow(/서로 다른 전역 건수/);
  });

  it('keeps the read-only DOM and Nexacro scanner syntactically valid', () => {
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain("relation:'nexacro'");
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain('data-count');
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).not.toContain('.click(');
    expect(() => new Function(`return ${SYSTEM_APPROVAL_SUMMARY_EXPRESSION}`)).not.toThrow();
  });
});
