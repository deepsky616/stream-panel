import { describe, expect, it } from 'vitest';
import {
  neisAssessmentApplyExpression,
  parseNeisAssessmentClipboard,
  readNeisAssessmentApplyResult,
} from '../src/main/services/webConnector/neisAssessment';

const validClipboard = `[NEIS 성취기준별 평가 입력 확인표]
수업: 5학년 3반 수학
평가: 분수의 곱셈
학급: 5학년 3반

번호\t이름\t단계\t교사확정총점\t총배점\t비율
1\t강로\t매우잘함\t8\t10\t80%
2\t고사\t잘함\t7\t10\t70%`;

describe('NEIS assessment clipboard bridge', () => {
  it('parses only the explicit essay-grader transfer format', () => {
    expect(parseNeisAssessmentClipboard(validClipboard)).toEqual({
      course: '5학년 3반 수학',
      assessment: '분수의 곱셈',
      classLabel: '5학년 3반',
      records: [
        { number: '1', name: '강로', level: '매우잘함', score: 8, maxScore: 10, percentage: 80 },
        { number: '2', name: '고사', level: '잘함', score: 7, maxScore: 10, percentage: 70 },
      ],
    });
  });

  it('rejects unknown levels, duplicate numbers and inconsistent percentages', () => {
    expect(() => parseNeisAssessmentClipboard(validClipboard.replace('매우잘함', '최우수'))).toThrow(/단계/);
    expect(() => parseNeisAssessmentClipboard(`${validClipboard}\n2\t다온\t보통\t5\t10\t50%`)).toThrow(/두 번/);
    expect(() => parseNeisAssessmentClipboard(validClipboard.replace('80%', '81%'))).toThrow(/서로 맞지/);
  });

  it('encodes student data and returns a guarded page expression', () => {
    const expression = neisAssessmentApplyExpression(parseNeisAssessmentClipboard(validClipboard));
    expect(expression).toContain('성취기준별 평가');
    expect(expression).toContain("status:'not-on-page'");
    expect(expression).toContain('setColumn');
    expect(expression.indexOf('for(const current of documents)')).toBeLessThan(
      expression.indexOf('if(!pageReady)return nativeResult'),
    );
    expect(expression).not.toContain('강로');
    expect(expression).not.toContain('.click(');
  });

  it('accepts only a bounded structured apply result', () => {
    expect(readNeisAssessmentApplyResult({
      status: 'ok',
      method: 'nexacro',
      matched: 2,
      updated: 1,
      already: 1,
      missing: [],
    })).toEqual({
      status: 'ok',
      method: 'nexacro',
      matched: 2,
      updated: 1,
      already: 1,
      missing: [],
    });
    expect(() => readNeisAssessmentApplyResult({ status: 'ok', matched: -1 })).toThrow(/건수/);
  });
});
