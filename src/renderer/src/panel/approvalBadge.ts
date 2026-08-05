import type { ApprovalMonitorStatus, DeckItem, WebWorkflowSystem } from '../../../shared/types';
import type { KeyTileStatusBadge } from '../common/KeyTile';

export type ApprovalBadge = KeyTileStatusBadge;

function systemForItem(item: DeckItem): WebWorkflowSystem | null {
  if (item.kind !== 'action') return null;
  if (item.webWorkflow?.id === 'neis-approval-inbox') return 'neis';
  if (item.webWorkflow?.id === 'edufine-approval-inbox') return 'edufine';
  return null;
}

export function getApprovalBadgeForItem(
  item: DeckItem,
  statuses: readonly ApprovalMonitorStatus[],
): ApprovalBadge | null {
  const system = systemForItem(item);
  if (!system) return null;
  const status = statuses.find((candidate) => candidate.system === system);
  if (!status || status.state !== 'ready' || status.pendingCount === undefined) return null;
  const systemLabel = system === 'neis' ? '나이스' : '에듀파인';
  return {
    label: status.pendingCount > 99 ? '99+' : String(status.pendingCount),
    title: `${systemLabel} 결재 대기 ${status.pendingCount}건`,
    state: status.pendingCount === 0 ? 'empty' : status.state,
  };
}
