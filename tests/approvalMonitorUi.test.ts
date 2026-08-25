import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import type { ActionItem } from '../src/shared/types';
import { createApprovalInboxTemplate } from '../src/shared/webWorkflows';
import { ApprovalMonitorSettings } from '../src/renderer/src/editor/ApprovalMonitorSettings';
import { getApprovalBadgeForItem } from '../src/renderer/src/panel/approvalBadge';
import {
  SettingsModal,
  UpdateActionButtons,
} from '../src/renderer/src/editor/SettingsModal';
import { createConfigWriteQueue } from '../src/renderer/src/editor/configWriteQueue';
import { KeyTile } from '../src/renderer/src/common/KeyTile';
import { TitleBar } from '../src/renderer/src/panel/TitleBar';
import type {} from '../src/renderer/src/api';

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
  it('shows restart installation only when a Windows update is ready', () => {
    const readyHtml = renderToStaticMarkup(createElement(UpdateActionButtons, {
      platform: 'win32',
      updateReady: '1.5.51',
      checking: false,
      applying: false,
      onCheck: () => undefined,
      onRestart: () => undefined,
    }));
    expect(readyHtml).toContain('업데이트 확인');
    expect(readyHtml).toContain('재시작하여 업데이트 적용');
    expect(readyHtml).toContain('primary-action');

    const currentHtml = renderToStaticMarkup(createElement(UpdateActionButtons, {
      platform: 'win32',
      updateReady: null,
      checking: false,
      applying: false,
      onCheck: () => undefined,
      onRestart: () => undefined,
    }));
    expect(currentHtml).not.toContain('재시작하여 업데이트 적용');
  });

  it('serializes rapid settings writes against the latest saved config', async () => {
    expect(createConfigWriteQueue).toBeTypeOf('function');
    let persisted = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const queue = createConfigWriteQueue({
      initial: persisted,
      write: async (patch) => {
        persisted = { ...persisted, ...structuredClone(patch) };
        return structuredClone(persisted);
      },
    });

    const enableNeis = queue.enqueue((current) => ({
      approvalMonitor: {
        ...current.approvalMonitor,
        sources: {
          ...current.approvalMonitor.sources,
          neis: { ...current.approvalMonitor.sources.neis, enabled: true },
        },
      },
    }));
    const shortenInterval = queue.enqueue((current) => ({
      approvalMonitor: { ...current.approvalMonitor, intervalMinutes: 5 },
    }));
    await Promise.all([enableNeis, shortenInterval]);

    expect(persisted.approvalMonitor.sources.neis.enabled).toBe(true);
    expect(persisted.approvalMonitor.intervalMinutes).toBe(5);
  });

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
    expect(html).not.toContain('나이스·K-에듀파인 직접 연결');
    expect(html).toContain('업무포털 열기');
    expect(html).toContain('나이스·에듀파인 연결');
    expect(html).not.toContain('브라우저 확인');
    expect(html).toContain('업무 알림');
    expect(html).not.toContain('결재함 키 추가');
    expect(html).toContain('연결된 나이스 탭 → 미결/협조함 전역 건수');
    expect(html).toContain('연결 탭의 결재(긴급)·Dataset 우선 → 실패 시 알림 전용 탭의 결재대기 목록');
    expect(html).toContain('페이지 크기·페이지 번호·페이지당 숫자는 사용하지 않습니다');
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
    }));

    expect(html).toContain('업무 알림');
    expect(html).toContain('나이스');
    expect(html).toContain('에듀파인');
    expect(html).toContain('10분');
    expect(html).toContain('새 결재가 늘었을 때만 알림');
    expect(html).toContain('지금 확인');
    expect(html).not.toContain('결재함 키 추가');
    expect(html).toContain('대기 3건');
    expect(html).toContain('마지막 확인');
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
      webWorkflow: { id: 'neis-approval-inbox', browserId: 'edge', officeCode: 'sen' },
    });
    expect(createApprovalInboxTemplate('edufine', 'chrome', 'gbe')).toMatchObject({
      label: '에듀파인 결재함',
      target: 'https://klef.gbe.kr/',
      webWorkflow: { id: 'edufine-approval-inbox', browserId: 'chrome', officeCode: 'gbe' },
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
    expect(html).toContain('aria-label="나이스 결재함 실행, 나이스 결재 대기 3건"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('>3<');
  });

  it('shows a zero pending count with a neutral badge state', () => {
    expect(getApprovalBadgeForItem(approvalAction('neis-approval-inbox'), [
      { system: 'neis', state: 'ready', pendingCount: 0 },
    ])).toEqual({
      label: '0',
      title: '나이스 결재 대기 0건',
      state: 'empty',
    });
  });

  it('keeps the last confirmed badge visible while a transient check retries', () => {
    expect(getApprovalBadgeForItem(approvalAction('edufine-approval-inbox'), [{
      system: 'edufine',
      state: 'retrying',
      pendingCount: 1,
      lastCheckedAt: 1_800_000_000_000,
    }])).toEqual({
      label: '1',
      title: '에듀파인 결재 대기 1건, 마지막 확인값·재확인 중',
      state: 'retrying',
    });
  });

  it('emphasizes only a newly increased approval count and shows the delta', () => {
    const changedAt = 1_800_000_000_000;
    expect(getApprovalBadgeForItem(approvalAction('edufine-approval-inbox'), [{
      system: 'edufine',
      state: 'ready',
      pendingCount: 3,
      previousPendingCount: 1,
      increase: 2,
      changedAt,
    }])).toEqual({
      label: '3',
      title: '에듀파인 결재 대기 3건, 새 결재 +2건',
      state: 'increased',
      pulseKey: changedAt,
    });

    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const html = renderToStaticMarkup(createElement(TitleBar, {
      config,
      approvalStatuses: [{
        system: 'edufine',
        state: 'ready',
        pendingCount: 3,
        previousPendingCount: 1,
        increase: 2,
        changedAt,
      }],
    }));
    expect(html).toContain('title-approval-increased');
    expect(html).toContain('새 결재 2건 증가');
    expect(html).toContain('>+2</i>');
  });

  it('places Edufine then NEIS immediately to the left of the lock control', () => {
    const config = createDefaultConfig(
      { downloads: 'C:\\Downloads', documents: 'C:\\Documents' },
      () => 'id',
      'win32',
    );
    const html = renderToStaticMarkup(createElement(TitleBar, {
      config,
      approvalStatuses: [
        { system: 'neis', state: 'ready', pendingCount: 4 },
        { system: 'edufine', state: 'ready', pendingCount: 7 },
      ],
    }));
    expect(html).toContain('나이스 결재함 총 4건 열기');
    expect(html).toContain('에듀파인 결재함 총 7건 열기');
    expect(html.indexOf('에듀파인 결재함 총 7건 열기')).toBeLessThan(
      html.indexOf('나이스 결재함 총 4건 열기'),
    );
    expect(html.indexOf('나이스 결재함 총 4건 열기')).toBeLessThan(html.indexOf('잠금'));
  });
});
