import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDefaultConfig } from '../src/shared/defaults';
import type { ActionItem, DeckItem } from '../src/shared/types';
import {
  createEducationOfficePatch,
  createWebWorkBrowserCards,
  getWebWorkflowEditorModel,
  shouldShowWebWorkSettings,
  updateWebWorkflowBrowser,
  updateWebWorkflowOffice,
} from '../src/renderer/src/editor/webWorkViewModel';
import * as settingsComponents from '../src/renderer/src/editor/CustomWebWorkflowBuilder';
import * as webWorkViewModel from '../src/renderer/src/editor/webWorkViewModel';
import { ActionLibrary } from '../src/renderer/src/editor/ActionLibrary';

function workflowAction(): ActionItem {
  return {
    id: 'leave',
    kind: 'action',
    type: 'url',
    label: '나이스 복무',
    target: 'https://goe.neis.go.kr/',
    args: [],
    icon: { kind: 'auto' },
    color: '#5B8CFF',
    position: 0,
    browser: {
      path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      profileDir: 'Default',
      appMode: true,
    },
    webWorkflow: { id: 'neis-leave', browserId: 'edge' },
  };
}

describe('web work settings view model', () => {
  it('omits the redundant folder creation template from the action library', () => {
    const html = renderToStaticMarkup(createElement(ActionLibrary, {
      platform: 'win32',
      educationOfficeCode: 'goe',
      onAdd: () => undefined,
    }));

    expect(html).not.toContain('폴더 만들기');
    expect(html).toContain('폴더 열기');
  });

  it('renders a guided custom workflow builder for both NEIS and Edufine', () => {
    const CustomWebWorkflowBuilder = (
      settingsComponents as unknown as {
        CustomWebWorkflowBuilder?: (props: {
          officeCode: 'goe';
          onCreate: () => Promise<void>;
        }) => ReturnType<typeof createElement>;
      }
    ).CustomWebWorkflowBuilder;
    expect(CustomWebWorkflowBuilder).toBeTypeOf('function');
    const html = renderToStaticMarkup(createElement(CustomWebWorkflowBuilder!, {
      officeCode: 'goe',
      onCreate: async () => undefined,
    }));
    expect(html).toContain('내 웹 업무 만들기');
    expect(html).toContain('같은 업무용 브라우저 창의 작업 탭에서 실행합니다');
    expect(html).toContain('나이스');
    expect(html).toContain('에듀파인');
    expect(html).toContain('업무 이름');
    expect(html).toContain('누를 메뉴 이름');
    expect(html).toContain('도착 화면 확인 문구');
    expect(html).toContain('키로 추가');
  });

  it('renders the full custom workflow editor again for an existing custom key', () => {
    const custom = {
      ...workflowAction(),
      id: 'custom-documents',
      label: '에듀파인 문서함',
      target: 'https://klef.sen.go.kr/',
      webWorkflow: {
        id: 'custom' as const,
        browserId: 'edge' as const,
        officeCode: 'sen' as const,
        custom: {
          name: '에듀파인 문서함',
          system: 'edufine' as const,
          steps: [{ id: 'step-1', label: '내 문서함' }],
          finalText: '내 문서함 목록',
        },
      },
    };
    const html = renderToStaticMarkup(createElement(settingsComponents.CustomWebWorkflowBuilder, {
      officeCode: 'goe',
      initialItem: custom,
      onSave: async () => undefined,
    }));
    expect(html).toContain('내 웹 업무 편집');
    expect(html).toContain('에듀파인 문서함');
    expect(html).toContain('서울특별시교육청');
    expect(html).toContain('변경 내용 저장');
  });

  it('shows managed web work only on Windows', () => {
    expect(shouldShowWebWorkSettings('win32')).toBe(true);
    expect(shouldShowWebWorkSettings('darwin')).toBe(false);
  });

  it('maps browser status to recommended, ready, running, connection, and error cards', () => {
    expect(createWebWorkBrowserCards([
      { browserId: 'edge', paired: true, connected: true, lastSeenAt: 1_800_000_000_000 },
      { browserId: 'chrome', paired: false, connected: false },
    ])).toEqual([
      expect.objectContaining({ browserId: 'edge', name: '엣지', recommended: true, state: 'ready', stateLabel: '준비됨' }),
      expect.objectContaining({ browserId: 'chrome', name: '크롬', recommended: false, state: 'needs-connection', stateLabel: '연결 필요' }),
    ]);
    expect(createWebWorkBrowserCards([], 'edge')).toEqual([
      expect.objectContaining({ browserId: 'edge', state: 'running', stateLabel: '실행 중' }),
      expect.objectContaining({ browserId: 'chrome', state: 'needs-connection' }),
    ]);
    expect(createWebWorkBrowserCards([], null, 'chrome')).toEqual([
      expect.objectContaining({ browserId: 'edge', state: 'needs-connection' }),
      expect.objectContaining({ browserId: 'chrome', state: 'error', stateLabel: '오류' }),
    ]);
    expect(createWebWorkBrowserCards([{
      browserId: 'edge',
      paired: true,
      connected: false,
      systems: [{ system: 'neis', state: 'disconnected' }],
    }])[0]).toMatchObject({
      state: 'needs-connection',
      stateLabel: '연결 필요',
      systems: [{ system: 'neis', stateLabel: '다시 연결 필요' }],
    });
    expect(createWebWorkBrowserCards([{
      browserId: 'edge',
      paired: true,
      connected: true,
      systems: [
        { system: 'neis', state: 'connected' },
        { system: 'edufine', state: 'login-required', message: '인증이 필요합니다.' },
      ],
    }])[0]).toMatchObject({
      state: 'ready',
      stateLabel: '준비됨',
      systems: [
        { system: 'neis', label: '나이스', stateLabel: '연결됨' },
        { system: 'edufine', label: 'K-에듀파인', stateLabel: '추가 로그인 필요' },
      ],
    });
    expect(createWebWorkBrowserCards([{
      browserId: 'edge',
      paired: true,
      connected: true,
      systems: [{ system: 'neis', state: 'error', message: 'Total을 찾지 못했습니다.' }],
    }])[0]).toMatchObject({
      state: 'ready',
      stateLabel: '준비됨',
      systems: [{ system: 'neis', state: 'error', stateLabel: '실패' }],
    });
  });

  it('retargets workflow addresses for a new office without changing identifiers or references', () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'default',
      'win32',
    );
    const workflow: ActionItem = {
      ...workflowAction(),
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'goe' },
    };
    const multi: ActionItem = {
      id: 'morning',
      kind: 'action',
      type: 'multi',
      label: '아침 업무',
      target: '',
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 1,
      multiAction: { steps: [{ id: 'step-1', kind: 'action', actionId: workflow.id }] },
    };
    const folder: DeckItem = {
      id: 'web-folder',
      kind: 'folder',
      label: '웹 업무',
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 2,
      children: [{
        ...workflowAction(),
        id: 'nested-leave',
        position: 0,
        webWorkflow: { id: 'neis-leave', browserId: 'chrome', officeCode: 'goe' },
      }],
    };
    config.root = [workflow, multi, folder];

    const patch = createEducationOfficePatch(config, 'sen');

    expect(patch.educationOfficeCode).toBe('sen');
    expect(patch.root[0]).toMatchObject({
      id: 'leave',
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    });
    expect(patch.root[1]).toEqual(multi);
    expect(patch.root[2]).toMatchObject({
      id: 'web-folder',
      children: [{
        id: 'nested-leave',
        target: 'https://sen.neis.go.kr/',
        webWorkflow: { id: 'neis-leave', browserId: 'chrome', officeCode: 'sen' },
      }],
    });
  });

  it('adopts an older built-in NEIS leave key and retargets it with every other workflow', () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'default',
      'win32',
    );
    config.root = [{
      ...workflowAction(),
      label: '나이스 복무',
      target: 'https://goe.neis.go.kr/',
      browser: {
        path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        profileDir: 'Default',
        appMode: false,
      },
      webWorkflow: undefined,
    }];

    const patch = createEducationOfficePatch(config, 'sen');

    expect(patch.root[0]).toMatchObject({
      label: '나이스 복무',
      target: 'https://sen.neis.go.kr/',
      webWorkflow: {
        id: 'neis-leave',
        browserId: 'edge',
        officeCode: 'sen',
      },
    });
    expect((patch.root[0] as ActionItem).browser).toBeUndefined();
  });

  it('edits only the managed browser id and removes legacy personal browser settings', () => {
    const item = workflowAction();

    expect(getWebWorkflowEditorModel(item)).toEqual({
      managed: true,
      browserId: 'edge',
      officeCode: 'goe',
      showGeneralBrowserSettings: false,
    });
    expect(updateWebWorkflowBrowser(item, 'chrome')).toMatchObject({
      id: 'leave',
      webWorkflow: { id: 'neis-leave', browserId: 'chrome' },
    });
    expect(updateWebWorkflowBrowser(item, 'chrome').browser).toBeUndefined();
    expect(updateWebWorkflowOffice(item, 'sen')).toMatchObject({
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'sen' },
    });
  });

  it('describes a custom workflow route for the key properties panel', () => {
    const getWebWorkflowSummary = (
      webWorkViewModel as unknown as {
        getWebWorkflowSummary?: (item: ActionItem) => unknown;
      }
    ).getWebWorkflowSummary;
    expect(getWebWorkflowSummary).toBeTypeOf('function');
    expect(getWebWorkflowSummary!({
      ...workflowAction(),
      id: 'custom-documents',
      label: '에듀파인 문서함',
      target: 'https://klef.goe.go.kr/',
      webWorkflow: {
        id: 'custom',
        browserId: 'edge',
        custom: {
          name: '에듀파인 문서함',
          system: 'edufine',
          steps: [
            { id: 'step-1', label: '업무관리' },
            { id: 'step-2', label: '내 문서함' },
          ],
          finalText: '내 문서함 목록',
        },
      },
    })).toEqual({
      label: '에듀파인 문서함',
      systemLabel: '에듀파인',
      custom: true,
      route: ['업무관리', '내 문서함'],
      finalText: '내 문서함 목록',
    });
  });

  it('keeps a custom workflow name in sync when the key title changes', () => {
    const updateCustomWebWorkflowName = (
      webWorkViewModel as unknown as {
        updateCustomWebWorkflowName?: (item: ActionItem, name: string) => ActionItem;
      }
    ).updateCustomWebWorkflowName;
    expect(updateCustomWebWorkflowName).toBeTypeOf('function');
    const custom = {
      ...workflowAction(),
      label: '에듀파인 문서함',
      webWorkflow: {
        id: 'custom' as const,
        browserId: 'edge' as const,
        custom: {
          name: '에듀파인 문서함',
          system: 'edufine' as const,
          steps: [{ id: 'step-1', label: '내 문서함' }],
          finalText: '내 문서함 목록',
        },
      },
    };
    expect(updateCustomWebWorkflowName!(custom, '받은 문서 조회')).toMatchObject({
      label: '받은 문서 조회',
      webWorkflow: {
        id: 'custom',
        custom: {
          name: '받은 문서 조회',
          steps: [{ id: 'step-1', label: '내 문서함' }],
        },
      },
    });
  });
});
