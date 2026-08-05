import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import type { ActionItem } from '../src/shared/types';
import { createApprovalInboxTemplate } from '../src/shared/webWorkflows';
import { ApprovalMonitorSettings } from '../src/renderer/src/editor/ApprovalMonitorSettings';
import { getApprovalBadgeForItem } from '../src/renderer/src/panel/approvalBadge';
import { SettingsModal } from '../src/renderer/src/editor/SettingsModal';
import { KeyTile } from '../src/renderer/src/common/KeyTile';

function approvalAction(id: 'neis-approval-inbox' | 'edufine-approval-inbox'): ActionItem {
  return {
    id,
    kind: 'action',
    type: 'url',
    label: id === 'neis-approval-inbox' ? '나이스 결재함' : '에듀파인 결재함',
    target: id === 'neis-approval-inbox' ? 'https://goe.neis.go.kr/' : 'https://klef.goe.go.kr/',
    args: [],
    icon: { kind: 'emoji', value: '🔔' },
    color: '#5B8CFF',
    position: 0,
    webWorkflow: { id, browserId: 'edge' },
  };
}

describe('approval monitor settings UI', () => {
  it('places the monitor inside the Windows web-work settings tab', () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      (() => { let id = 0; return () => `id-${id++}`; })(),
      'win32',
    );
    const html = renderToStaticMarkup(createElement(SettingsModal, {
      open: true,
      config,
      initialTab: 'web-work',
      onClose: () => undefined,
      onAddWebWorkflow: async () => undefined,
    }));
    expect(html).toContain('웹 업무 연결');
    expect(html).toContain('업무 알림');
    expect(html).toContain('결재함 키 추가');
  });

  it('shows read-only NEIS and Edufine monitor controls without approval actions', () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const html = renderToStaticMarkup(createElement(ApprovalMonitorSettings, {
      config: config.approvalMonitor,
      statuses: [
        { system: 'neis', state: 'ready', pendingCount: 3, lastCheckedAt: 1_800_000_000_000 },
        { system: 'edufine', state: 'login-required', message: '로그인이 필요합니다.' },
      ],
      busySystem: null,
      onChange: () => undefined,
      onCheck: () => undefined,
      onAddKey: () => undefined,
    }));

    expect(html).toContain('업무 알림');
    expect(html).toContain('나이스');
    expect(html).toContain('에듀파인');
    expect(html).toContain('10분');
    expect(html).toContain('새 결재가 늘었을 때만 알림');
    expect(html).toContain('지금 확인');
    expect(html).toContain('결재함 키 추가');
    expect(html).toContain('대기 3건');
    expect(html).not.toContain('자동 승인');
    expect(html).not.toContain('자동 반려');
  });

  it('creates fixed inbox keys and maps only their matching count to a panel badge', () => {
    expect(createApprovalInboxTemplate('neis', 'edge', 'sen')).toEqual({
      kind: 'action-template',
      type: 'url',
      label: '나이스 결재함',
      emoji: '🔔',
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-approval-inbox', browserId: 'edge' },
    });
    expect(createApprovalInboxTemplate('edufine', 'chrome', 'gbe')).toMatchObject({
      label: '에듀파인 결재함',
      target: 'https://klef.gbe.kr/',
      webWorkflow: { id: 'edufine-approval-inbox', browserId: 'chrome' },
    });

    const statuses = [
      { system: 'neis' as const, state: 'ready' as const, pendingCount: 3 },
      { system: 'edufine' as const, state: 'ready' as const, pendingCount: 8 },
    ];
    expect(getApprovalBadgeForItem(approvalAction('neis-approval-inbox'), statuses)).toEqual({
      label: '3',
      title: '나이스 결재 대기 3건',
      state: 'ready',
    });
    expect(getApprovalBadgeForItem(approvalAction('edufine-approval-inbox'), statuses)).toEqual({
      label: '8',
      title: '에듀파인 결재 대기 8건',
      state: 'ready',
    });
    expect(getApprovalBadgeForItem({
      ...approvalAction('neis-approval-inbox'),
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    }, statuses)).toBeNull();
  });

  it('renders the pending count as an accessible key badge', () => {
    const html = renderToStaticMarkup(createElement(KeyTile, {
      item: approvalAction('neis-approval-inbox'),
      buttonSize: 88,
      onClick: () => undefined,
      statusBadge: {
        label: '3',
        title: '나이스 결재 대기 3건',
        state: 'ready',
      },
    }));
    expect(html).toContain('key-status-badge');
    expect(html).toContain('나이스 결재 대기 3건');
    expect(html).toContain('>3<');
  });
});
