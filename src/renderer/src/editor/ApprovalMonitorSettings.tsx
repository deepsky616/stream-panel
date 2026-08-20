import type {
  ApprovalMonitorConfig,
  ApprovalMonitorStatus,
  WebConnectorBrowserId,
  WebWorkflowSystem,
} from '../../../shared/types';

interface ApprovalMonitorSettingsProps {
  config: ApprovalMonitorConfig;
  statuses: ApprovalMonitorStatus[];
  busySystem: WebWorkflowSystem | null;
  onChange: (
    update: (current: ApprovalMonitorConfig) => ApprovalMonitorConfig,
  ) => void;
  onCheck: (system: WebWorkflowSystem) => void;
}

const SYSTEM_LABELS: Record<WebWorkflowSystem, string> = {
  neis: '나이스',
  edufine: '에듀파인',
};

function statusText(status: ApprovalMonitorStatus | undefined): string {
  if (!status || status.state === 'idle') return '확인 전';
  if (status.state === 'disabled') return '사용 안 함';
  if (status.state === 'checking') return '확인 중';
  if (status.state === 'ready') return `대기 ${status.pendingCount ?? 0}건`;
  if (status.state === 'login-required') return '로그인 필요';
  return '확인 오류';
}

function formatLastCheckedAt(value: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ApprovalMonitorSettings({
  config,
  statuses,
  busySystem,
  onChange,
  onCheck,
}: ApprovalMonitorSettingsProps) {
  const setSource = (
    system: WebWorkflowSystem,
    patch: Partial<ApprovalMonitorConfig['sources'][WebWorkflowSystem]>,
  ) => {
    onChange((current) => ({
      ...current,
      sources: {
        ...current.sources,
        [system]: { ...current.sources[system], ...patch },
      },
    }));
  };
  return (
    <section className="approval-monitor-settings" aria-labelledby="approval-monitor-title">
      <div className="web-work-heading">
        <div>
          <h3 id="approval-monitor-title">업무 알림</h3>
          <p>업무포털 현황 숫자를 확인하고, 증가하면 실제 결재 목록으로 검증해 알려줍니다.</p>
        </div>
      </div>
      <label>
        확인 주기
        <select
          value={config.intervalMinutes}
          onChange={(event) => onChange((current) => ({
            ...current,
            intervalMinutes: Number(event.target.value) as 5 | 10 | 30,
          }))}
        >
          <option value={5}>5분</option>
          <option value={10}>10분</option>
          <option value={30}>30분</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.notifyOnlyOnIncrease}
          onChange={(event) => onChange((current) => ({
            ...current,
            notifyOnlyOnIncrease: event.target.checked,
          }))}
        />
        새 결재가 늘었을 때만 알림
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.workHours.enabled}
          onChange={(event) => onChange((current) => ({
            ...current,
            workHours: { ...current.workHours, enabled: event.target.checked },
          }))}
        />
        근무 시간에만 확인
      </label>
      {config.workHours.enabled && (
        <div className="approval-work-hours">
          <label>시작<input type="time" value={config.workHours.start} onChange={(event) => onChange((current) => ({
            ...current,
            workHours: { ...current.workHours, start: event.target.value },
          }))} /></label>
          <label>끝<input type="time" value={config.workHours.end} onChange={(event) => onChange((current) => ({
            ...current,
            workHours: { ...current.workHours, end: event.target.value },
          }))} /></label>
        </div>
      )}
      <div className="approval-source-list">
        {(['neis', 'edufine'] as const).map((system) => {
          const source = config.sources[system];
          const status = statuses.find((candidate) => candidate.system === system);
          return (
            <article className={`approval-source approval-source-${status?.state ?? 'idle'}`} key={system}>
              <div role="status" aria-live="polite">
                <label>
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    onChange={(event) => setSource(system, { enabled: event.target.checked })}
                  />
                  <strong>{SYSTEM_LABELS[system]}</strong>
                </label>
                <span className="approval-source-state">{statusText(status)}</span>
                <small>{system === 'neis'
                  ? '정기 확인: 업무포털 승인사항 → 미결/협조함 오른쪽 숫자'
                  : '정기 확인: 업무포털 전자결재 현황 → 결재(긴급) 오른쪽 숫자'}</small>
                {status?.lastCheckedAt !== undefined && (
                  <small>마지막 확인: {formatLastCheckedAt(status.lastCheckedAt)}</small>
                )}
                {status?.message && <small className="approval-source-message">{status.message}</small>}
              </div>
              <label>
                브라우저
                <select
                  value={source.browserId}
                  onChange={(event) => setSource(system, {
                    browserId: event.target.value as WebConnectorBrowserId,
                  })}
                >
                  <option value="edge">엣지</option>
                  <option value="chrome">크롬</option>
                </select>
              </label>
              <div className="approval-source-actions">
                <button
                  className="primary-action"
                  type="button"
                  disabled={!source.enabled || busySystem !== null}
                  aria-busy={busySystem === system}
                  onClick={() => onCheck(system)}
                >{busySystem === system ? '확인 중…' : '지금 확인'}</button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="workflow-safety-note">
        페이지 크기·페이지 번호·페이지당 숫자는 건수로 사용하지 않습니다. 증가하거나 지금 확인할 때만 실제 목록을 검증하며 문서 내용과 인증 정보는 저장하지 않습니다.
      </p>
    </section>
  );
}
