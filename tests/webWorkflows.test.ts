import { describe, expect, it } from 'vitest';
import * as webWorkflows from '../src/shared/webWorkflows';

type TemplateFactory = (
  id: 'neis-leave' | 'neis-trip' | 'edufine-draft' | 'edufine-purchase',
  browserId: 'chrome' | 'edge',
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
    expect(createWebWorkflowTemplate('neis-leave', 'edge')).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '나이스 복무',
      emoji: '🗓️',
      target: 'https://goe.neis.go.kr',
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    });
    expect(createWebWorkflowTemplate('edufine-purchase', 'chrome')).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '에듀파인 품의',
      emoji: '🧾',
      target: 'https://klef.goe.go.kr',
      webWorkflow: { id: 'edufine-purchase', browserId: 'chrome' },
    });
  });

  it('recognizes only Edge and Chrome executable paths on both supported platforms', () => {
    expect(webWorkflows.browserIdFromPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe('chrome');
    expect(webWorkflows.browserIdFromPath('/Applications/Microsoft Edge.app')).toBe('edge');
    expect(webWorkflows.browserIdFromPath('/Applications/Safari.app')).toBeNull();
  });

  it('keeps NEIS and Edufine commands on their exact secure hosts', () => {
    expect(webWorkflows.isAllowedWebWorkflowTarget('neis-trip', 'https://goe.neis.go.kr/main')).toBe(true);
    expect(webWorkflows.isAllowedWebWorkflowTarget('neis-trip', 'http://goe.neis.go.kr/main')).toBe(false);
    expect(webWorkflows.isAllowedWebWorkflowTarget('neis-trip', 'https://goe.neis.go.kr.evil.test')).toBe(false);
    expect(webWorkflows.isAllowedWebWorkflowTarget('edufine-draft', 'https://klef.goe.go.kr')).toBe(true);
    expect(webWorkflows.isAllowedWebWorkflowTarget('edufine-draft', 'https://goe.neis.go.kr')).toBe(false);
  });

  it('uses only fixed internal extension pages for Edge and Chrome setup', () => {
    expect(getBrowserExtensionManagementUrl('edge')).toBe('edge://extensions/');
    expect(getBrowserExtensionManagementUrl('chrome')).toBe('chrome://extensions/');
  });
});
