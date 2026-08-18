import { describe, expect, it } from 'vitest';
import type { CandidateSummary } from '../src/main/services/webConnector/workflows/common';
import {
  parseApprovalCounterValue,
  scanWindowsApprovalCount,
  type WindowsApprovalPage,
} from '../src/main/services/approvalMonitor/windows';
import { createApprovalCheckCancelledError } from '../src/main/services/approvalMonitor/cancellation';
import { APPROVAL_INBOX_WORKFLOWS } from '../src/main/services/approvalMonitor/definitions';
import * as approvalWindows from '../src/main/services/approvalMonitor/windows';

function candidate(index: number, text: string, contextText = ''): CandidateSummary {
  return {
    index,
    text,
    visible: true,
    enabled: true,
    width: 100,
    height: 30,
    navigation: true,
    safeNavigation: true,
    contextText,
  };
}

function page(origin: string, count = 3): WindowsApprovalPage {
  return {
    currentOrigin: async () => origin,
    inspectCandidates: async (step) => [candidate(
      0,
      step.candidateLabels[0],
      step.contextLabels?.join(' ') ?? '',
    )],
    pressCandidate: async () => undefined,
    checkPostcondition: async () => true,
    wait: async () => undefined,
    readApprovalCount: async () => count,
  };
}

describe('Windows approval count reader', () => {
  it('prefers the opened list rows and uses a labelled counter only as a fallback', () => {
    const parseApprovalCounterCandidates = (
      approvalWindows as unknown as {
        parseApprovalCounterCandidates?: (
          system: 'neis' | 'edufine',
          value: unknown,
          requireListReady?: boolean,
        ) => number;
      }
    ).parseApprovalCounterCandidates;
    expect(parseApprovalCounterCandidates).toBeTypeOf('function');
    expect(parseApprovalCounterCandidates!('neis', [
      {
        text: 'Total 3',
        ariaLabel: '',
        title: '',
        className: 'menu-item',
        role: 'link',
        children: [],
      },
    ])).toBe(3);
    expect(() => parseApprovalCounterCandidates!('neis', {
      candidates: [{
        text: 'Total 3',
        ariaLabel: '',
        title: '',
        className: 'summary',
        role: 'status',
        children: [],
      }],
      rowCounts: [],
      emptyList: false,
      listReady: false,
    }, true)).toThrow(/아직 준비되지 않았습니다/);
    expect(() => parseApprovalCounterCandidates!('neis', [
      {
        text: '미결/협조함 2026',
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
        text: '총 4건',
        ariaLabel: '',
        title: '',
        className: 'status',
        role: 'status',
        children: [],
      },
    ])).toBe(4);
    expect(parseApprovalCounterCandidates!('edufine', {
      candidates: [],
      rowCounts: [7],
      emptyList: false,
    })).toBe(7);
    expect(parseApprovalCounterCandidates!('edufine', {
      candidates: [{
        text: '전체 100',
        ariaLabel: '',
        title: '',
        className: 'page-size',
        role: 'option',
        children: [],
      }],
      rowCounts: [
        { count: 100, area: 90_000, relevant: false, source: 'nexacro' },
        { count: 1, area: 60_000, relevant: true, source: 'nexacro' },
      ],
      emptyList: false,
    })).toBe(1);
    expect(parseApprovalCounterCandidates!('edufine', {
      candidates: [],
      rowCounts: [],
      emptyList: true,
      listReady: true,
    })).toBe(0);
    expect(parseApprovalCounterCandidates!('neis', [{
      text: 'Total :',
      ariaLabel: '',
      title: '',
      className: 'total-label',
      role: 'status',
      children: [],
      next: { text: '0', ariaLabel: '', title: '', className: 'total-count', role: '' },
    }])).toBe(0);
    expect(parseApprovalCounterCandidates!('neis', {
      candidates: [{
        text: 'Total 100',
        ariaLabel: '',
        title: '',
        className: 'page-size',
        role: 'option',
        children: [],
      }],
      rowCounts: [{ count: 0, area: 50_000, relevant: true, source: 'dom' }],
      emptyList: false,
    })).toBe(0);
    expect(parseApprovalCounterCandidates!('neis', [
      {
        text: 'Total 5',
        ariaLabel: '',
        title: '',
        className: 'menu-item',
        role: 'link',
        children: [
          { text: 'Total', ariaLabel: '', title: '', className: 'label', role: '' },
          { text: '5', ariaLabel: '', title: '', className: '', role: '' },
        ],
      },
    ])).toBe(5);
    expect(parseApprovalCounterCandidates!('edufine', [
      {
        text: '총 6건',
        ariaLabel: '',
        title: '',
        className: 'grid-total',
        role: 'status',
        children: [],
      },
    ])).toBe(6);
  });

  it('opens the exact 문서관리 결재 menu and never clicks 결재(긴급)', () => {
    expect(APPROVAL_INBOX_WORKFLOWS.neis.steps.flatMap(
      (step) => step.candidateLabels,
    )).not.toContain('결재');
    const edufineApproval = APPROVAL_INBOX_WORKFLOWS.edufine.steps.at(-1);
    expect(edufineApproval).toMatchObject({
      interaction: 'edufine-mega-menu',
      skipWhenSatisfied: false,
    });
    const labels = APPROVAL_INBOX_WORKFLOWS.edufine.steps.flatMap(
      (step) => step.candidateLabels,
    );
    expect(labels).toContain('결재');
    expect(labels).not.toEqual(expect.arrayContaining(['문서관리', '결재(긴급)']));
  });

  it('opens the 문서관리-scoped 결재대기 menu before reading the Edufine list count', async () => {
    let presses = 0;
    const workflowPage = page('https://klef.goe.go.kr', 8);
    workflowPage.pressCandidate = async () => { presses += 1; };

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'edufine', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => workflowPage },
    )).resolves.toBe(8);
    expect(presses).toBe(3);
  });

  it('waits briefly for a dynamically rendered list count', async () => {
    let reads = 0;
    let waits = 0;
    const workflowPage = page('https://klef.goe.go.kr', 6);
    workflowPage.readApprovalCount = async () => {
      reads += 1;
      if (reads < 3) throw new Error('결재 대기 수를 안전하게 읽지 못했습니다.');
      return 6;
    };
    workflowPage.wait = async () => { waits += 1; };

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'edufine', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => workflowPage },
    )).resolves.toBe(6);
    expect({ reads, waits }).toEqual({ reads: 3, waits: 5 });
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
    expect(pressed.join(' ')).toMatch(/미결\/협조함/);
    expect(pressed.join(' ')).not.toMatch(/승인|반려|서명|처리/);
    expect(releases).toBe(1);
  });

  it('releases the browser page when approval navigation fails', async () => {
    let releases = 0;
    const releaseOptions: unknown[] = [];
    const workflowPage = page('https://evil.example');
    Object.assign(workflowPage, {
      release: async (options?: unknown) => {
        releases += 1;
        releaseOptions.push(options);
      },
    });

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => workflowPage },
    )).rejects.toThrow(/허용되지 않은/);
    expect(releases).toBe(1);
    expect(releaseOptions).toEqual([undefined]);
  });

  it('keeps and activates a temporary tab when a manual approval check fails', async () => {
    let activations = 0;
    const releaseOptions: unknown[] = [];
    const workflowPage = page('https://evil.example');
    Object.assign(workflowPage, {
      activate: async () => { activations += 1; },
      release: async (options?: unknown) => { releaseOptions.push(options); },
    });

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge', interactive: true },
      { openPage: async () => workflowPage },
    )).rejects.toThrow();

    expect(activations).toBe(1);
    expect(releaseOptions).toEqual([{ keepCreatedTargets: true }]);
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

  it('rechecks the allowed host immediately after a NEIS click and after reading either count', async () => {
    let clicked = false;
    let reads = 0;
    const redirectAfterClick = page('https://goe.neis.go.kr');
    redirectAfterClick.currentOrigin = async () => clicked ? 'https://evil.example' : 'https://goe.neis.go.kr';
    redirectAfterClick.pressCandidate = async () => { clicked = true; };
    redirectAfterClick.readApprovalCount = async () => { reads += 1; return 3; };

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'neis', officeCode: 'goe', browserId: 'edge' },
      { openPage: async () => redirectAfterClick },
    )).rejects.toThrow(/허용되지 않은/);
    expect(reads).toBe(0);

    for (const input of [
      { system: 'neis' as const, officeCode: 'goe' as const, browserId: 'edge' as const, origin: 'https://goe.neis.go.kr' },
      { system: 'edufine' as const, officeCode: 'goe' as const, browserId: 'edge' as const, origin: 'https://klef.goe.go.kr' },
    ]) {
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

  it('stops an approval scan before opening a page when an interactive key takes priority', async () => {
    const abortController = new AbortController();
    abortController.abort();
    let opened = false;
    const expected = createApprovalCheckCancelledError();

    await expect(scanWindowsApprovalCount(
      { officeCode: 'goe', browserId: 'edge', isAlive: () => true, close: async () => undefined },
      { system: 'edufine', officeCode: 'goe', browserId: 'edge' },
      {
        openPage: async () => {
          opened = true;
          return page('https://klef.goe.go.kr');
        },
      },
      abortController.signal,
    )).rejects.toThrow(expected.message);
    expect(opened).toBe(false);
  });
});
