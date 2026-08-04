import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const engine = require('../browser-extension/workflow-engine.js') as {
  getWorkflowSteps(id: string): readonly (readonly string[])[];
  isForbiddenActionText(text: string): boolean;
  selectMenuCandidate<T extends { text: string; hidden?: boolean; disabled?: boolean }>(
    candidates: readonly T[],
    labels: readonly string[],
  ): T | null;
};

describe('browser extension workflow engine', () => {
  it('prefers an exact visible enabled menu label over a partial match', () => {
    const candidates = [
      { id: 'hidden', text: '개인근무상황관리', hidden: true },
      { id: 'partial', text: '즐겨찾기 개인근무상황관리' },
      { id: 'exact', text: ' 개인근무상황관리 ' },
      { id: 'disabled', text: '개인근무상황관리', disabled: true },
    ];

    expect(engine.selectMenuCandidate(candidates, ['개인근무상황관리'])?.id).toBe('exact');
  });

  it('never chooses a save, submit, approval, or confirmation action', () => {
    for (const text of ['저장', '제출', '결재 요청', '상신', '승인', '최종 확정']) {
      expect(engine.isForbiddenActionText(text)).toBe(true);
    }
    expect(
      engine.selectMenuCandidate(
        [
          { id: 'unsafe', text: '품의 저장' },
          { id: 'safe', text: '품의작성' },
        ],
        ['품의'],
      )?.id,
    ).toBe('safe');
  });

  it('contains only fixed navigation steps for the four approved workflows', () => {
    expect(engine.getWorkflowSteps('neis-leave')).toEqual([
      ['복무'],
      ['개인근무상황관리', '개인근무상황'],
    ]);
    expect(engine.getWorkflowSteps('neis-trip')).toEqual([
      ['복무'],
      ['개인출장관리', '출장관리'],
    ]);
    expect(engine.getWorkflowSteps('edufine-draft')).toEqual([
      ['업무관리'],
      ['문서관리'],
      ['문서작성', '기안작성', '기안'],
    ]);
    expect(engine.getWorkflowSteps('edufine-purchase')).toEqual([
      ['학교회계'],
      ['사업관리'],
      ['품의작성', '품의'],
    ]);
    expect(() => engine.getWorkflowSteps('arbitrary-script')).toThrow(/지원하지 않는/);
  });
});
