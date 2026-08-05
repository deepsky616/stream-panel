import { describe, expect, it } from 'vitest';
import type { CandidateSummary } from '../src/main/services/webConnector/workflows/common';
import {
  parseApprovalCounterValue,
  scanWindowsApprovalCount,
  type WindowsApprovalPage,
} from '../src/main/services/approvalMonitor/windows';

function candidate(index: number, text: string): CandidateSummary {
  return {
    index,
    text,
    visible: true,
    enabled: true,
    width: 100,
    height: 30,
    navigation: true,
  };
}

function page(origin: string, count = 3): WindowsApprovalPage {
  return {
    currentOrigin: async () => origin,
    inspectCandidates: async (step) => [candidate(0, step.candidateLabels[0])],
    pressCandidate: async () => undefined,
    checkPostcondition: async () => true,
    wait: async () => undefined,
    readApprovalCount: async () => count,
  };
}

describe('Windows approval count reader', () => {
  it('accepts only a bounded non-negative integer returned by the page', () => {
    expect(parseApprovalCounterValue(0)).toBe(0);
    expect(parseApprovalCounterValue(9999)).toBe(9999);
    for (const invalid of [-1, 1.2, 10_000, '3', null, { count: 3 }]) {
      expect(() => parseApprovalCounterValue(invalid)).toThrow(/대기 수/);
    }
  });

  it('reads the NEIS inbox count without activating the browser or pressing a decision button', async () => {
    const pressed: string[] = [];
    const workflowPage = page('https://goe.neis.go.kr', 7);
    workflowPage.pressCandidate = async (selected, step) => {
      pressed.push(`${step.id}:${selected.text}`);
    };

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => workflowPage },
    )).resolves.toBe(7);

    expect(pressed.length).toBeGreaterThan(0);
    expect(pressed.join(' ')).toMatch(/결재함|대기문서|미결문서/);
    expect(pressed.join(' ')).not.toMatch(/승인|반려|서명|처리/);
  });

  it('rejects a login portal or another host before inspecting or reading page content', async () => {
    let inspections = 0;
    let reads = 0;
    const loginPage = page('https://goe.eduptl.kr');
    loginPage.inspectCandidates = async () => { inspections += 1; return []; };
    loginPage.readApprovalCount = async () => { reads += 1; return 1; };

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => loginPage },
    )).rejects.toThrow(/로그인/);

    const foreignPage = page('https://evil.example');
    foreignPage.inspectCandidates = async () => { inspections += 1; return []; };
    foreignPage.readApprovalCount = async () => { reads += 1; return 1; };
    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => foreignPage },
    )).rejects.toThrow(/허용되지 않은/);

    expect(inspections).toBe(0);
    expect(reads).toBe(0);
  });

  it('rejects a session that belongs to another office or browser', async () => {
    await expect(scanWindowsApprovalCount(
      { officeCode: 'sen', browserId: 'chrome', isAlive: () => true, close: async () => undefined },
      { system: 'edufine', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => page('https://klef.goe.go.kr') },
    )).rejects.toThrow(/세션/);
  });
});
