import { useEffect, useState } from 'react';
import type {
  AppConfig,
  ApprovalMonitorStatus,
  WebWorkflowSystem,
} from '../../../shared/types';

interface TitleBarProps {
  config: AppConfig;
  approvalStatuses: readonly ApprovalMonitorStatus[];
}

const APPROVAL_LABELS: Record<WebWorkflowSystem, string> = {
  neis: '나이스',
  edufine: '에듀파인',
};

function approvalCountText(status: ApprovalMonitorStatus | undefined): string {
  if (status?.state === 'checking') return '…';
  if (status?.pendingCount !== undefined) {
    return status.pendingCount > 99 ? '99+' : String(status.pendingCount);
  }
  if (status?.state === 'login-required' || status?.state === 'error') return '!';
  return '–';
}

function approvalTitle(
  system: WebWorkflowSystem,
  status: ApprovalMonitorStatus | undefined,
): string {
  const label = APPROVAL_LABELS[system];
  if (status?.increase && status.previousPendingCount !== undefined) {
    return `${label} 결재 대기가 ${status.previousPendingCount}건에서 ${status.pendingCount}건으로 늘었습니다. 새 결재 +${status.increase}건, 결재함 열기`;
  }
  if (status?.state === 'retrying' && status.pendingCount !== undefined) {
    return `${label} 결재함 마지막 확인 ${status.pendingCount}건, 재확인 중. 결재함 열기`;
  }
  if (status?.pendingCount !== undefined) return `${label} 결재함 총 ${status.pendingCount}건 열기`;
  if (status?.state === 'checking') return `${label} 결재함 확인 중`;
  if (status?.state === 'login-required') return `${label} 로그인이 필요합니다. 결재함 열기`;
  if (status?.state === 'error') return `${label} 결재함 확인 오류. 결재함 열기`;
  return `${label} 결재함 열기`;
}

export function TitleBar({ config, approvalStatuses }: TitleBarProps) {
  const [updateReady, setUpdateReady] = useState(false);
  const [openingSystem, setOpeningSystem] = useState<WebWorkflowSystem | null>(null);
  useEffect(() => window.api.on('update:status', (payload) => {
    if (payload && typeof payload === 'object' && 'state' in payload) {
      setUpdateReady((payload as { state: string }).state === 'downloaded');
    }
  }), []);
  const toggleLock = () => {
    void window.api.config.set({ window: { ...config.window, locked: !config.window.locked } });
  };
  const openApprovalInbox = async (system: WebWorkflowSystem) => {
    setOpeningSystem(system);
    try {
      await window.api.webConnector.openApprovalInbox({ system });
    } finally {
      setOpeningSystem(null);
    }
  };
  return (
    <header className={`titlebar ${config.window.locked ? 'locked' : ''}`}>
      <span className="drag-mark" aria-hidden="true">
        ⠿
      </span>
      <strong>Stream Panel</strong>
      <div className="title-actions">
        {config.platform === 'win32' && (['edufine', 'neis'] as const).map((system) => {
          const status = approvalStatuses.find((candidate) => candidate.system === system);
          return (
            <button
              className={`title-approval title-approval-${status?.state ?? 'idle'} ${status?.increase ? 'title-approval-increased' : ''}`}
              type="button"
              key={`${system}:${status?.changedAt ?? 0}`}
              disabled={openingSystem === system}
              title={approvalTitle(system, status)}
              aria-label={approvalTitle(system, status)}
              onClick={() => void openApprovalInbox(system)}
            >
              <span>{APPROVAL_LABELS[system]}</span>
              <b aria-label={`${approvalCountText(status)}건`}>{approvalCountText(status)}</b>
              {status?.increase ? <i aria-label={`새 결재 ${status.increase}건 증가`}>+{status.increase}</i> : null}
            </button>
          );
        })}
        <button type="button" onClick={toggleLock} aria-label={config.window.locked ? '잠금 해제' : '잠금'}>
          {config.window.locked ? '🔒' : '🔓'}
        </button>
        <button className="editor-title-button" type="button" onClick={() => void window.api.editor.open()} aria-label="편집기 열기">
          ⚙
          {updateReady && <span className="update-dot" aria-label="업데이트 준비됨" />}
        </button>
        <button
          type="button"
          title="숨기기 (Ctrl+Alt+D로 다시 열기)"
          onClick={() => void window.api.window.hide()}
          aria-label="패널 숨기기"
        >
          ✕
        </button>
      </div>
    </header>
  );
}
