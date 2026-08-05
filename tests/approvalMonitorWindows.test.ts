import { describe, expect, it } from 'vitest';
import type { CandidateSummary } from '../src/main/services/webConnector/workflows/common';
import {
  parseApprovalCounterValue,
  scanWindowsApprovalCount,
  type WindowsApprovalPage,
} from '../src/main/services/approvalMonitor/windows';
import { APPROVAL_INBOX_WORKFLOWS } from '../src/main/services/approvalMonitor/definitions';
import * as approvalWindows from '../src/main/services/approvalMonitor/windows';

function candidate(index: number, text: string): CandidateSummary {
  return {
    index,
    text,
    visible: true,
    enabled: true,
    width: 100,
    height: 30,
    navigation: true,
    safeNavigation: true,
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
  it('reads one explicit badge count, rejects a year, and prioritizes the canonical label', () => {
    const parseApprovalCounterCandidates = (
      approvalWindows as unknown as {
        parseApprovalCounterCandidates?: (
          system: 'neis' | 'edufine',
          value: unknown,
        ) => number;
      }
    ).parseApprovalCounterCandidates;
    expect(parseApprovalCounterCandidates).toBeTypeOf('function');
    expect(parseApprovalCounterCandidates!('neis', [
      {
        text: '미결문서 (3)',
        ariaLabel: '',
        title: '',
        className: 'menu-item',
        role: 'link',
        children: [],
      },
    ])).toBe(3);
    expect(() => parseApprovalCounterCandidates!('neis', [
      {
        text: '미결문서 2026',
        ariaLabel: '',
        title: '',
        className: 'menu-item',
        role: 'link',
        children: [],
      },
    ])).toThrow(/안전하게 읽지 못했습니다/);
    expect(parseApprovalCounterCandidates!('edufine', [
      {
        text: '결재할 문서 (2)',
        ariaLabel: '',
        title: '',
        className: 'menu-item',
        role: 'link',
        children: [],
      },
      {
        text: '결재 대기 4건',
        ariaLabel: '',
        title: '',
        className: 'status',
        role: 'status',
        children: [],
      },
    ])).toBe(4);
  });

  it('never treats the generic approval action label as an inbox navigation target', () => {
    for (const workflow of Object.values(APPROVAL_INBOX_WORKFLOWS)) {
      expect(workflow.steps.flatMap((step) => step.candidateLabels)).not.toContain('결재');
    }
  });

  it('accepts only a bounded non-negative integer returned by the page', () => {
    expect(parseApprovalCounterValue(0)).toBe(0);
    expect(parseApprovalCounterValue(9999)).toBe(9999);
    for (const invalid of [-1, 1.2, 10_000, '3', null, { count: 3 }]) {
      expect(() => parseApprovalCounterValue(invalid)).toThrow(/대기 수/);
    }
  });

  it('reads the NEIS inbox count without activating the browser or pressing a decision button', async () => {
    const pressed: string[] = [];
    let releases = 0;
    const workflowPage = page('https://goe.neis.go.kr', 7);
    workflowPage.pressCandidate = async (selected, step) => {
      pressed.push(`${step.id}:${selected.text}`);
    };
    Object.assign(workflowPage, {
      release: async () => { releases += 1; },
    });

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => workflowPage },
    )).resolves.toBe(7);

    expect(pressed.length).toBeGreaterThan(0);
    expect(pressed.join(' ')).toMatch(/결재함|대기문서|미결문서/);
    expect(pressed.join(' ')).not.toMatch(/승인|반려|서명|처리/);
    expect(releases).toBe(1);
  });

  it('releases the browser page when approval navigation fails', async () => {
    let releases = 0;
    const workflowPage = page('https://evil.example');
    Object.assign(workflowPage, {
      release: async () => { releases += 1; },
    });

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => workflowPage },
    )).rejects.toThrow(/허용되지 않은/);
    expect(releases).toBe(1);
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

  it('rechecks the allowed host immediately after a click and after reading the count', async () => {
    for (const input of [
      { system: 'neis' as const, officeCode: 'goe' as const, browserId: 'edge' as const, origin: 'https://goe.neis.go.kr' },
      { system: 'edufine' as const, officeCode: 'goe' as const, browserId: 'edge' as const, origin: 'https://klef.goe.go.kr' },
    ]) {
      let clicked = false;
      let reads = 0;
      const redirectAfterClick = page(input.origin);
      redirectAfterClick.currentOrigin = async () => clicked ? 'https://evil.example' : input.origin;
      redirectAfterClick.pressCandidate = async () => { clicked = true; };
      redirectAfterClick.readApprovalCount = async () => { reads += 1; return 3; };

      await expect(scanWindowsApprovalCount(
        { officeCode: input.officeCode, browserId: input.browserId, isAlive: () => true, close: async () => undefined },
        input,
        { openPage: async () => redirectAfterClick },
      )).rejects.toThrow(/허용되지 않은/);
      expect(reads).toBe(0);

      let countRead = false;
      const redirectAfterRead = page(input.origin);
      redirectAfterRead.currentOrigin = async () => countRead ? 'https://evil.example' : input.origin;
      redirectAfterRead.readApprovalCount = async () => { countRead = true; return 3; };

      await expect(scanWindowsApprovalCount(
        { officeCode: input.officeCode, browserId: input.browserId, isAlive: () => true, close: async () => undefined },
        input,
        { openPage: async () => redirectAfterRead },
      )).rejects.toThrow(/허용되지 않은/);
      expect(countRead).toBe(true);
    }
  });

  it('rejects a session that belongs to another office or browser', async () => {
    await expect(scanWindowsApprovalCount(
      { officeCode: 'sen', browserId: 'chrome', isAlive: () => true, close: async () => undefined },
      { system: 'edufine', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => page('https://klef.goe.go.kr') },
    )).rejects.toThrow(/세션/);
  });
});
