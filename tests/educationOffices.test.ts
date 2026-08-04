import { describe, expect, it } from 'vitest';
import {
  EDUCATION_OFFICES,
  getEducationOffice,
  isAllowedOfficeHost,
  isEducationOfficeCode,
} from '../src/shared/educationOffices';

describe('education office catalog', () => {
  it('contains each supported office exactly once with its official hosts', () => {
    expect(EDUCATION_OFFICES).toHaveLength(17);
    expect(new Set(EDUCATION_OFFICES.map(({ code }) => code)).size).toBe(17);
    expect(getEducationOffice('goe')).toMatchObject({
      name: '경기도교육청',
      portalUrl: 'https://goe.eduptl.kr/',
      neisUrl: 'https://goe.neis.go.kr/',
      edufineUrl: 'https://klef.goe.go.kr/',
    });
    expect(getEducationOffice('gbe').edufineUrl).toBe('https://klef.gbe.kr/');
  });

  it('accepts only exact office codes and exact secure office hosts', () => {
    expect(isEducationOfficeCode('sen')).toBe(true);
    expect(isEducationOfficeCode('goe')).toBe(true);
    expect(isEducationOfficeCode('GOE')).toBe(false);
    expect(isEducationOfficeCode('wrong')).toBe(false);

    expect(isAllowedOfficeHost('goe', 'https://goe.eduptl.kr/')).toBe(true);
    expect(isAllowedOfficeHost('goe', 'https://goe.neis.go.kr/path?token=secret')).toBe(true);
    expect(isAllowedOfficeHost('goe', 'https://klef.goe.go.kr/path')).toBe(true);
    expect(isAllowedOfficeHost('goe', 'http://goe.neis.go.kr/')).toBe(false);
    expect(isAllowedOfficeHost('goe', 'https://goe.neis.go.kr:444/')).toBe(false);
    expect(isAllowedOfficeHost('goe', 'https://user:secret@goe.neis.go.kr/')).toBe(false);
    expect(isAllowedOfficeHost('goe', 'https://goe.neis.go.kr.evil.test/')).toBe(false);
    expect(isAllowedOfficeHost('goe', 'https://sen.neis.go.kr/')).toBe(false);
  });
});
