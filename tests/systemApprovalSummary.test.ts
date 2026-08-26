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
  relation: 'inline' | 'same-control' | 'row' | 'sibling' | 'nexacro' | 'dataset' = 'inline',
) {
  return {
    system,
    value,
    itemLabel: system === 'neis' ? '미결/협조함' : '결재(긴급)',
    relation,
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

  it('accepts the exact number in the row to the right of the NEIS inbox label', () => {
    expect(parseSystemApprovalCount([{ candidates: [
      candidate('neis', 0, 99, 'approval-summary-row 미결/협조함', 'row'),
      candidate('neis', 100, 80, 'unrelated page size', 'sibling'),
    ] }], 'neis')).toBe(0);
  });

  it('accepts an exact Edufine Dataset count and rejects weak nearby numbers', () => {
    expect(parseSystemApprovalCount([{ candidates: [
      candidate('edufine', 1, 97, 'dataset dsApproval approvalCnt 결재(긴급)', 'dataset'),
    ] }], 'edufine')).toBe(1);
    expect(() => parseSystemApprovalCount([{ candidates: [
      candidate('edufine', 100, 88, 'nearby number', 'sibling'),
    ] }], 'edufine')).toThrow(/전역 건수를 찾지 못했습니다/);
  });

  it('reads the total before the urgent subset from an Edufine 2(0) badge', () => {
    const bounds = { left: 490, top: 45, width: 105, height: 20, right: 595, bottom: 65 };
    const element = {
      hidden: false,
      id: 'approval-status',
      className: 'top-status',
      innerText: '결재(긴급) 2(0)',
      textContent: '결재(긴급) 2(0)',
      parentElement: null,
      nextElementSibling: null,
      previousElementSibling: null,
      children: [],
      getAttribute: () => '',
      getBoundingClientRect: () => bounds,
      querySelectorAll: () => [],
      contains: () => false,
    };
    const defaultView = {
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        content: 'none',
      }),
    };
    const fakeDocument = {
      defaultView,
      querySelectorAll: (selector: string) => selector === 'iframe,frame' ? [] : [element],
    };
    Object.assign(element, { ownerDocument: fakeDocument });
    const fakeWindow = { document: fakeDocument };
    const value = new Function(
      'window',
      'document',
      `return ${SYSTEM_APPROVAL_SUMMARY_EXPRESSION}`,
    )(fakeWindow, fakeDocument);

    expect(value.candidates).toContainEqual(expect.objectContaining({
      system: 'edufine',
      value: 2,
      itemLabel: '결재(긴급)',
      relation: 'inline',
      confidence: 100,
    }));
    expect(parseSystemApprovalCount([value], 'edufine')).toBe(2);
  });

  it('reads a label-anchored Edufine count directly from a Nexacro Dataset', () => {
    const dataset = {
      id: 'dsApprovalSummary',
      getRowCount: () => 1,
      getColCount: () => 2,
      getColumnInfo: (index: number) => ({ id: index === 0 ? 'menuNm' : 'approvalCnt' }),
      getColumn: (_row: number, column: string) => (
        column === 'menuNm' ? '결재(긴급)' : '1'
      ),
    };
    const mainframe = { objects: [dataset] };
    const fakeDocument = { querySelectorAll: () => [] };
    const fakeWindow = {
      document: fakeDocument,
      nexacro: { getApplication: () => ({ mainframe }) },
    };
    const value = new Function(
      'window',
      'document',
      `return ${SYSTEM_APPROVAL_SUMMARY_EXPRESSION}`,
    )(fakeWindow, fakeDocument);

    expect(value).toMatchObject({ candidates: [expect.objectContaining({
      system: 'edufine',
      value: 1,
      relation: 'dataset',
    })] });
    expect(parseSystemApprovalCount([value], 'edufine')).toBe(1);
  });

  it('keeps the read-only DOM and Nexacro scanner syntactically valid', () => {
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain("'row'");
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain('approval-summary-row');
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain('labelRect');
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain("relation:'nexacro'");
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain("relation:'dataset'");
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain('dataset.getColumn');
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).toContain('data-count');
    expect(SYSTEM_APPROVAL_SUMMARY_EXPRESSION).not.toContain('.click(');
    expect(() => new Function(`return ${SYSTEM_APPROVAL_SUMMARY_EXPRESSION}`)).not.toThrow();
  });
});
