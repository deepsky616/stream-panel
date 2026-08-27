import { describe, expect, it } from 'vitest';
import {
  parsePortalApprovalCount,
  PORTAL_APPROVAL_SUMMARY_EXPRESSION,
} from '../src/main/services/approvalMonitor/portalSummary';

function candidate(
  system: 'neis' | 'edufine',
  value: number,
  controlContext = 'approval-count badge',
) {
  return {
    system,
    value,
    panelLabel: system === 'neis' ? '승인사항' : '전자결재 현황',
    itemLabel: system === 'neis' ? '미결/협조함' : '결재(긴급)',
    relation: 'right-adjacent',
    controlContext,
  };
}

describe('portal approval summary', () => {
  it('reads only the exact count beside each portal dashboard item', () => {
    const values = [{ candidates: [candidate('neis', 2), candidate('edufine', 1)] }];

    expect(parsePortalApprovalCount(values, 'neis')).toBe(2);
    expect(parsePortalApprovalCount(values, 'edufine')).toBe(1);
  });

  it('rejects page size, page number, per-page, pager, and pagination numbers', () => {
    const excluded = [{ candidates: [
      candidate('edufine', 100, '페이지 크기 100'),
      candidate('edufine', 2, '페이지 번호 2'),
      candidate('edufine', 50, '페이지당 50건'),
      candidate('edufine', 3, 'pagination pager page number 3'),
      candidate('edufine', 100, 'cboPageRow pageSize'),
      candidate('edufine', 4, 'totalPageCount'),
      candidate('edufine', 50, 'recordPerPage'),
      candidate('edufine', 4, '페이지 수 4'),
      candidate('edufine', 1, '1 / 4 페이지'),
    ] }];

    expect(() => parsePortalApprovalCount(excluded, 'edufine')).toThrow(/숫자를 찾지 못했습니다/);
  });

  it('allows a real count of 100 when it is in the exact approval badge context', () => {
    expect(parsePortalApprovalCount([
      { candidates: [candidate('edufine', 100, '전자결재 현황 결재 긴급 badge')] },
    ], 'edufine')).toBe(100);
  });

  it('accepts an explicit zero and rejects conflicting adjacent values', () => {
    expect(parsePortalApprovalCount([
      { candidates: [candidate('neis', 0)] },
    ], 'neis')).toBe(0);
    expect(() => parsePortalApprovalCount([
      { candidates: [candidate('neis', 1), candidate('neis', 2)] },
    ], 'neis')).toThrow(/서로 다른 숫자/);
  });

  it('keeps the injected dashboard scanner syntactically valid', () => {
    expect(PORTAL_APPROVAL_SUMMARY_EXPRESSION).toContain('right-adjacent');
    expect(PORTAL_APPROVAL_SUMMARY_EXPRESSION).toContain('페이지|쪽');
    expect(PORTAL_APPROVAL_SUMMARY_EXPRESSION).toContain('pageControlElement');
    expect(() => new Function(`return ${PORTAL_APPROVAL_SUMMARY_EXPRESSION}`)).not.toThrow();
  });
});
