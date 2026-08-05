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
  onChange: (config: ApprovalMonitorConfig) => void;
  onCheck: (system: WebWorkflowSystem) => void;
  onAddKey: (system: WebWorkflowSystem, browserId: WebConnectorBrowserId) => void;
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

export function ApprovalMonitorSettings({
  config,
  statuses,
  busySystem,
  onChange,
  onCheck,
  onAddKey,
}: ApprovalMonitorSettingsProps) {
  const setSource = (
    system: WebWorkflowSystem,
    patch: Partial<ApprovalMonitorConfig['sources'][WebWorkflowSystem]>,
  ) => {
    onChange({
      ...config,
      sources: {
        ...config.sources,
        [system]: { ...config.sources[system], ...patch },
      },
    });
  };
  return (
    <section className="approval-monitor-settings" aria-labelledby="approval-monitor-title">
      <div className="web-work-heading">
        <div>
          <h3 id="approval-monitor-title">업무 알림</h3>
          <p>결재함의 대기 건수만 읽고 새 결재가 늘면 윈도우 알림으로 알려줍니다.</p>
        </div>
      </div>
      <label>
        확인 주기
        <select
          value={config.intervalMinutes}
          onChange={(event) => onChange({
            ...config,
            intervalMinutes: Number(event.target.value) as 5 | 10 | 30,
          })}
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
          onChange={(event) => onChange({ ...config, notifyOnlyOnIncrease: event.target.checked })}
        />
        새 결재가 늘었을 때만 알림
      </label>
      <label>
        <input
          type="checkbox"
          checked={config.workHours.enabled}
          onChange={(event) => onChange({
            ...config,
            workHours: { ...config.workHours, enabled: event.target.checked },
          })}
        />
        근무 시간에만 확인
      </label>
      {config.workHours.enabled && (
        <div className="approval-work-hours">
          <label>시작<input type="time" value={config.workHours.start} onChange={(event) => onChange({
            ...config,
            workHours: { ...config.workHours, start: event.target.value },
          })} /></label>
          <label>끝<input type="time" value={config.workHours.end} onChange={(event) => onChange({
            ...config,
            workHours: { ...config.workHours, end: event.target.value },
          })} /></label>
        </div>
      )}
      <div className="approval-source-list">
        {(['neis', 'edufine'] as const).map((system) => {
          const source = config.sources[system];
          const status = statuses.find((candidate) => candidate.system === system);
          return (
            <article className={`approval-source approval-source-${status?.state ?? 'idle'}`} key={system}>
              <div>
                <label>
                  <input
                    type="checkbox"
                    checked={source.enabled}
                    onChange={(event) => setSource(system, { enabled: event.target.checked })}
                  />
                  <strong>{SYSTEM_LABELS[system]}</strong>
                </label>
                <span className="approval-source-state">{statusText(status)}</span>
                {status?.message && <small title={status.message}>{status.message}</small>}
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
                  type="button"
                  disabled={!source.enabled || busySystem !== null}
                  onClick={() => onCheck(system)}
                >{busySystem === system ? '확인 중…' : '지금 확인'}</button>
                <button
                  type="button"
                  onClick={() => onAddKey(system, source.browserId)}
                >결재함 키 추가</button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="workflow-safety-note">
        문서 제목과 작성자, 본문, 인증 정보는 저장하지 않습니다. 결재함 목록까지만 열며 승인, 반려, 서명과 결재 처리는 사용자가 직접 진행합니다.
      </p>
    </section>
  );
}
