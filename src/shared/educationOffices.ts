import type { EducationOfficeCode } from './types';

export interface EducationOffice {
  code: EducationOfficeCode;
  name: string;
  portalUrl: string;
  neisUrl: string;
  edufineUrl: string;
}

export const EDUCATION_OFFICES: readonly EducationOffice[] = [
  { code: 'sen', name: '서울특별시교육청', portalUrl: 'https://sen.eduptl.kr/', neisUrl: 'https://sen.neis.go.kr/', edufineUrl: 'https://klef.sen.go.kr/' },
  { code: 'goe', name: '경기도교육청', portalUrl: 'https://goe.eduptl.kr/', neisUrl: 'https://goe.neis.go.kr/', edufineUrl: 'https://klef.goe.go.kr/' },
  { code: 'gne', name: '경상남도교육청', portalUrl: 'https://gne.eduptl.kr/', neisUrl: 'https://gne.neis.go.kr/', edufineUrl: 'https://klef.gne.go.kr/' },
  { code: 'pen', name: '부산광역시교육청', portalUrl: 'https://pen.eduptl.kr/', neisUrl: 'https://pen.neis.go.kr/', edufineUrl: 'https://klef.pen.go.kr/' },
  { code: 'dge', name: '대구광역시교육청', portalUrl: 'https://dge.eduptl.kr/', neisUrl: 'https://dge.neis.go.kr/', edufineUrl: 'https://klef.dge.go.kr/' },
  { code: 'dje', name: '대전광역시교육청', portalUrl: 'https://dje.eduptl.kr/', neisUrl: 'https://dje.neis.go.kr/', edufineUrl: 'https://klef.dje.go.kr/' },
  { code: 'gbe', name: '경상북도교육청', portalUrl: 'https://gbe.eduptl.kr/', neisUrl: 'https://gbe.neis.go.kr/', edufineUrl: 'https://klef.gbe.kr/' },
  { code: 'sje', name: '세종특별자치시교육청', portalUrl: 'https://sje.eduptl.kr/', neisUrl: 'https://sje.neis.go.kr/', edufineUrl: 'https://klef.sje.go.kr/' },
  { code: 'use', name: '울산광역시교육청', portalUrl: 'https://use.eduptl.kr/', neisUrl: 'https://use.neis.go.kr/', edufineUrl: 'https://klef.use.go.kr/' },
  { code: 'ice', name: '인천광역시교육청', portalUrl: 'https://ice.eduptl.kr/', neisUrl: 'https://ice.neis.go.kr/', edufineUrl: 'https://klef.ice.go.kr/' },
  { code: 'gen', name: '광주광역시교육청', portalUrl: 'https://gen.eduptl.kr/', neisUrl: 'https://gen.neis.go.kr/', edufineUrl: 'https://klef.gen.go.kr/' },
  { code: 'jne', name: '전라남도교육청', portalUrl: 'https://jne.eduptl.kr/', neisUrl: 'https://jne.neis.go.kr/', edufineUrl: 'https://klef.jne.go.kr/' },
  { code: 'jbe', name: '전북특별자치도교육청', portalUrl: 'https://jbe.eduptl.kr/', neisUrl: 'https://jbe.neis.go.kr/', edufineUrl: 'https://klef.jbe.go.kr/' },
  { code: 'cne', name: '충청남도교육청', portalUrl: 'https://cne.eduptl.kr/', neisUrl: 'https://cne.neis.go.kr/', edufineUrl: 'https://klef.cne.go.kr/' },
  { code: 'cbe', name: '충청북도교육청', portalUrl: 'https://cbe.eduptl.kr/', neisUrl: 'https://cbe.neis.go.kr/', edufineUrl: 'https://klef.cbe.go.kr/' },
  { code: 'gwe', name: '강원특별자치도교육청', portalUrl: 'https://gwe.eduptl.kr/', neisUrl: 'https://gwe.neis.go.kr/', edufineUrl: 'https://klef.gwe.go.kr/' },
  { code: 'jje', name: '제주특별자치도교육청', portalUrl: 'https://jje.eduptl.kr/', neisUrl: 'https://jje.neis.go.kr/', edufineUrl: 'https://klef.jje.go.kr/' },
] as const;

const OFFICE_BY_CODE = new Map(
  EDUCATION_OFFICES.map((office) => [office.code, office] as const),
);

export function isEducationOfficeCode(value: unknown): value is EducationOfficeCode {
  return typeof value === 'string' && OFFICE_BY_CODE.has(value as EducationOfficeCode);
}

export function getEducationOffice(code: EducationOfficeCode): EducationOffice {
  return OFFICE_BY_CODE.get(code)!;
}

export function isAllowedOfficeHost(code: EducationOfficeCode, target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (
    url.protocol !== 'https:' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return false;
  }
  const office = getEducationOffice(code);
  const allowedHosts = [office.portalUrl, office.neisUrl, office.edufineUrl].map(
    (value) => new URL(value).hostname,
  );
  return allowedHosts.includes(url.hostname.toLowerCase());
}
