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
const getBrowserExtensionManagementUrl = (
  webWorkflows as unknown as {
    getBrowserExtensionManagementUrl(browserId: 'chrome' | 'edge'): string;
  }
).getBrowserExtensionManagementUrl;
const isWebConnectorSupportedPlatform = (
  webWorkflows as unknown as {
    isWebConnectorSupportedPlatform(platform: NodeJS.Platform | null): boolean;
  }
).isWebConnectorSupportedPlatform;
const createWebWorkflowTemplatesForPlatform = (
  webWorkflows as unknown as {
    createWebWorkflowTemplatesForPlatform(platform: NodeJS.Platform | null): unknown[];
  }
).createWebWorkflowTemplatesForPlatform;

describe('web workflow templates', () => {
  it('exposes the connector and workflow templates only on Windows', () => {
    expect(isWebConnectorSupportedPlatform('win32')).toBe(true);
    expect(isWebConnectorSupportedPlatform('darwin')).toBe(false);
    expect(isWebConnectorSupportedPlatform('linux')).toBe(false);
    expect(createWebWorkflowTemplatesForPlatform('darwin')).toEqual([]);
    expect(createWebWorkflowTemplatesForPlatform('win32')).toHaveLength(4);
  });

  it('creates a complete fixed template without arbitrary commands', () => {
    expect(createWebWorkflowTemplate('neis-leave', 'edge', 'sen')).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '나이스 복무',
      emoji: '🗓️',
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    });
    expect(createWebWorkflowTemplate('edufine-purchase', 'chrome', 'gbe')).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '에듀파인 품의',
      emoji: '🧾',
      target: 'https://klef.gbe.kr/',
      webWorkflow: { id: 'edufine-purchase', browserId: 'chrome' },
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
  });

  it('uses only fixed internal extension pages for Edge and Chrome setup', () => {
    expect(getBrowserExtensionManagementUrl('edge')).toBe('edge://extensions/');
    expect(getBrowserExtensionManagementUrl('chrome')).toBe('chrome://extensions/');
  });
});
