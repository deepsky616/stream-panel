import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import type { ActionItem } from '../src/shared/types';
import {
  createEducationOfficePatch,
  createWebWorkBrowserCards,
  getWebWorkflowEditorModel,
  shouldShowWebWorkSettings,
  updateWebWorkflowBrowser,
} from '../src/renderer/src/editor/webWorkViewModel';

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
  });

  it('retargets workflow addresses for a new office without changing identifiers or references', () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'default',
      'win32',
    );
    const workflow = workflowAction();
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
    config.root = [workflow, multi];

    const patch = createEducationOfficePatch(config, 'sen');

    expect(patch.educationOfficeCode).toBe('sen');
    expect(patch.root[0]).toMatchObject({
      id: 'leave',
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    });
    expect(patch.root[1]).toEqual(multi);
  });

  it('edits only the managed browser id and removes legacy personal browser settings', () => {
    const item = workflowAction();

    expect(getWebWorkflowEditorModel(item)).toEqual({
      managed: true,
      browserId: 'edge',
      showGeneralBrowserSettings: false,
    });
    expect(updateWebWorkflowBrowser(item, 'chrome')).toMatchObject({
      id: 'leave',
      webWorkflow: { id: 'neis-leave', browserId: 'chrome' },
    });
    expect(updateWebWorkflowBrowser(item, 'chrome').browser).toBeUndefined();
  });
});
