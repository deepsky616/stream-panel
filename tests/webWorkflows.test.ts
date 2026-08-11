import { describe, expect, it } from 'vitest';
import type { DeckItem } from '../src/shared/types';
import * as webWorkflows from '../src/shared/webWorkflows';

type TemplateFactory = (
  id: 'neis-leave' | 'neis-trip' | 'edufine-draft' | 'edufine-purchase',
  browserId: 'chrome' | 'edge',
  officeCode?: 'goe' | 'sen' | 'gbe',
) => unknown;

const createWebWorkflowTemplate = (
  webWorkflows as unknown as { createWebWorkflowTemplate: TemplateFactory }
).createWebWorkflowTemplate;
const isWebConnectorSupportedPlatform = (
  webWorkflows as unknown as {
    isWebConnectorSupportedPlatform(platform: NodeJS.Platform | null): boolean;
  }
).isWebConnectorSupportedPlatform;
const createWebWorkflowTemplatesForPlatform = (
  webWorkflows as unknown as {
    createWebWorkflowTemplatesForPlatform(
      platform: NodeJS.Platform | null,
      officeCode?: 'goe' | 'sen' | 'gbe',
    ): Array<{ target?: string }>;
  }
).createWebWorkflowTemplatesForPlatform;
const createCustomWebWorkflowTemplate = (
  webWorkflows as unknown as {
    createCustomWebWorkflowTemplate?: (input: {
      name: string;
      system: 'neis' | 'edufine';
      browserId: 'chrome' | 'edge';
      stepLabels: string[];
      finalText: string;
      officeCode?: 'goe' | 'sen' | 'gbe';
    }) => unknown;
  }
).createCustomWebWorkflowTemplate;

describe('web workflow templates', () => {
  it('creates a custom Edufine navigation key without accepting addresses or selectors', () => {
    expect(createCustomWebWorkflowTemplate).toBeTypeOf('function');
    expect(createCustomWebWorkflowTemplate!({
      name: '에듀파인 문서함',
      system: 'edufine',
      browserId: 'edge',
      stepLabels: ['업무관리', '문서관리', '내 문서함'],
      finalText: '내 문서함',
      officeCode: 'sen',
    })).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '에듀파인 문서함',
      emoji: '🧭',
      target: 'https://klef.sen.go.kr/',
      webWorkflow: {
        id: 'custom',
        browserId: 'edge',
        officeCode: 'sen',
        custom: {
          name: '에듀파인 문서함',
          system: 'edufine',
          steps: [
            { id: 'step-1', label: '업무관리' },
            { id: 'step-2', label: '문서관리' },
            { id: 'step-3', label: '내 문서함' },
          ],
          finalText: '내 문서함',
        },
      },
    });
  });

  it('rejects unsafe or malformed custom navigation steps', () => {
    const safe = createCustomWebWorkflowTemplate!({
      name: '나이스 급여 조회',
      system: 'neis',
      browserId: 'chrome',
      stepLabels: ['급여', '급여 조회'],
      finalText: '급여 조회',
    }) as { webWorkflow: unknown };
    expect(webWorkflows.isWebWorkflowSpec(safe.webWorkflow)).toBe(true);

    for (const confirmed of [
      '저장',
      '제출하기',
      '상신',
      '승인',
      '결재',
      '확인',
      '등록',
      '신청',
      '인증 입력',
    ]) {
      const created = createCustomWebWorkflowTemplate!({
        name: '확인 후 실행 업무',
        system: 'edufine',
        browserId: 'edge',
        stepLabels: ['업무관리', confirmed],
        finalText: '도착 화면',
      }) as { webWorkflow: unknown };
      expect(webWorkflows.isWebWorkflowSpec(created.webWorkflow), confirmed).toBe(true);
    }

    for (const forbidden of [
      '결재 요청',
      '삭제',
      '인증서 선택',
      '처리 요청',
      '업무 완료',
      '반려',
      '전자 서명',
      '개인정보 동의',
      '문서 전송',
    ]) {
      expect(() => createCustomWebWorkflowTemplate!({
        name: '위험한 업무',
        system: 'edufine',
        browserId: 'edge',
        stepLabels: ['업무관리', forbidden],
        finalText: '도착 화면',
      })).toThrow(/자동으로 누를 수 없습니다/);
    }
    expect(() => createCustomWebWorkflowTemplate!({
      name: '빈 업무',
      system: 'neis',
      browserId: 'edge',
      stepLabels: [],
      finalText: '도착 화면',
    })).toThrow(/한 단계/);
    expect(() => createCustomWebWorkflowTemplate!({
      name: '너무 긴 업무',
      system: 'neis',
      browserId: 'edge',
      stepLabels: Array.from({ length: 9 }, (_, index) => `메뉴 ${index + 1}`),
      finalText: '도착 화면',
    })).toThrow(/여덟 단계/);

    const withSelector = {
      ...(safe.webWorkflow as object),
      custom: {
        ...((safe.webWorkflow as { custom: object }).custom),
        selector: '#submit',
      },
    };
    expect(webWorkflows.isWebWorkflowSpec(withSelector)).toBe(false);
    const withControlCharacters = {
      ...(safe.webWorkflow as object),
      custom: {
        ...((safe.webWorkflow as { custom: object }).custom),
        name: '급여\n조회',
      },
    };
    expect(webWorkflows.isWebWorkflowSpec(withControlCharacters)).toBe(false);
  });

  it('exposes the connector and workflow templates only on Windows', () => {
    expect(isWebConnectorSupportedPlatform('win32')).toBe(true);
    expect(isWebConnectorSupportedPlatform('darwin')).toBe(false);
    expect(isWebConnectorSupportedPlatform('linux')).toBe(false);
    expect(createWebWorkflowTemplatesForPlatform('darwin')).toEqual([]);
    expect(createWebWorkflowTemplatesForPlatform('win32')).toHaveLength(4);
    expect(createWebWorkflowTemplatesForPlatform('win32', 'sen').map(({ target }) => target)).toEqual([
      'https://sen.neis.go.kr/',
      'https://sen.neis.go.kr/',
      'https://klef.sen.go.kr/',
      'https://klef.sen.go.kr/',
    ]);
  });

  it('creates a complete fixed template without arbitrary commands', () => {
    expect(createWebWorkflowTemplate('neis-leave', 'edge', 'sen')).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '나이스 복무',
      emoji: '🗓️',
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'sen' },
    });
    expect(createWebWorkflowTemplate('edufine-purchase', 'chrome', 'gbe')).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '에듀파인 품의',
      emoji: '🧾',
      target: 'https://klef.gbe.kr/',
      webWorkflow: { id: 'edufine-purchase', browserId: 'chrome', officeCode: 'gbe' },
    });
  });

  it('recognizes only Edge and Chrome executable paths on both supported platforms', () => {
    expect(webWorkflows.browserIdFromPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('chrome');
    expect(webWorkflows.browserIdFromPath('/Applications/Microsoft Edge.app')).toBe('edge');
    expect(webWorkflows.browserIdFromPath('/Applications/Safari.app')).toBeNull();
  });

  it('keeps NEIS and Edufine commands on their exact secure hosts', () => {
    expect(webWorkflows.isAllowedWebWorkflowTarget('neis-trip', 'https://sen.neis.go.kr/main', 'sen')).toBe(true);
    expect(webWorkflows.isAllowedWebWorkflowTarget('neis-trip', 'http://sen.neis.go.kr/main', 'sen')).toBe(false);
    expect(webWorkflows.isAllowedWebWorkflowTarget('neis-trip', 'https://sen.neis.go.kr.evil.test', 'sen')).toBe(false);
    expect(webWorkflows.isAllowedWebWorkflowTarget('edufine-draft', 'https://klef.gbe.kr', 'gbe')).toBe(true);
    expect(webWorkflows.isAllowedWebWorkflowTarget('edufine-draft', 'https://sen.neis.go.kr', 'sen')).toBe(false);
  });

  it('retargets only workflow URLs while preserving identifiers and multi-action references', () => {
    const items: DeckItem[] = [
      {
        id: 'leave',
        kind: 'action',
        type: 'url',
        label: '나이스 복무',
        target: 'https://goe.neis.go.kr/',
        args: [],
        icon: { kind: 'emoji', value: '🗓️' },
        color: '#5B8CFF',
        position: 0,
        webWorkflow: { id: 'neis-leave', browserId: 'edge' },
      },
      {
        id: 'multi',
        kind: 'action',
        type: 'multi',
        label: '업무 시작',
        target: '',
        args: [],
        icon: { kind: 'emoji', value: '⏩' },
        color: '#5B8CFF',
        position: 1,
        multiAction: {
          steps: [{ id: 'step-1', kind: 'action', actionId: 'leave' }],
        },
      },
      {
        id: 'folder',
        kind: 'folder',
        label: '업무',
        icon: { kind: 'emoji', value: '📁' },
        color: '#5B8CFF',
        position: 2,
        children: [
          {
            id: 'draft',
            kind: 'action',
            type: 'url',
            label: '에듀파인 기안',
            target: 'https://klef.goe.go.kr/',
            args: [],
            icon: { kind: 'emoji', value: '✍️' },
            color: '#5B8CFF',
            position: 0,
            webWorkflow: { id: 'edufine-draft', browserId: 'chrome' },
          },
        ],
      },
      {
        id: 'custom-documents',
        kind: 'action',
        type: 'url',
        label: '에듀파인 문서함',
        target: 'https://klef.goe.go.kr/',
        args: [],
        icon: { kind: 'emoji', value: '🧭' },
        color: '#5B8CFF',
        position: 3,
        webWorkflow: {
          id: 'custom',
          browserId: 'edge',
          custom: {
            name: '에듀파인 문서함',
            system: 'edufine',
            steps: [{ id: 'step-1', label: '내 문서함' }],
            finalText: '내 문서함 목록',
          },
        },
      },
    ];

    const updated = webWorkflows.retargetWebWorkflowItems(items, 'sen');

    expect(updated[0]).toMatchObject({
      id: 'leave',
      label: '나이스 복무',
      target: 'https://sen.neis.go.kr/',
      icon: { kind: 'emoji', value: '🗓️' },
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    });
    expect(updated[1]).toEqual(items[1]);
    expect(updated[2]).toMatchObject({
      id: 'folder',
      children: [
        {
          id: 'draft',
          target: 'https://klef.sen.go.kr/',
          webWorkflow: { id: 'edufine-draft', browserId: 'chrome' },
        },
      ],
    });
    expect(items[0]).toMatchObject({ target: 'https://goe.neis.go.kr/' });
    expect(updated[3]).toMatchObject({
      id: 'custom-documents',
      target: 'https://klef.sen.go.kr/',
      webWorkflow: {
        id: 'custom',
        browserId: 'edge',
        custom: {
          name: '에듀파인 문서함',
          system: 'edufine',
          steps: [{ id: 'step-1', label: '내 문서함' }],
        },
      },
    });
  });

  it('retargets a key with an explicitly saved office when the global office changes', () => {
    const pinned: DeckItem = {
      id: 'pinned-leave',
      kind: 'action',
      type: 'url',
      label: '서울 나이스 복무',
      target: 'https://sen.neis.go.kr/',
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'sen' },
    };

    expect(webWorkflows.retargetWebWorkflowItems([pinned], 'goe')[0]).toMatchObject({
      id: 'pinned-leave',
      target: 'https://goe.neis.go.kr/jsp/main.jsp',
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'goe' },
    });
  });
});
