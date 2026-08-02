import type { LauncherResult } from '../../../shared/types';

function fallbackIcon(type: LauncherResult['type']): string {
  if (type === 'url') return '🔗';
  if (type === 'folder') return '📁';
  if (type === 'file') return '📄';
  return '🖥️';
}

function HighlightedLabel({
  label,
  ranges,
}: {
  label: string;
  ranges: LauncherResult['matchRanges'];
}) {
  if (ranges.length === 0) return <>{label}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(label.slice(cursor, start));
    parts.push(<strong key={`${start}-${end}-${index}`}>{label.slice(start, end)}</strong>);
    cursor = Math.max(cursor, end);
  });
  if (cursor < label.length) parts.push(label.slice(cursor));
  return <>{parts}</>;
}

export function LauncherResultRow({
  result,
  selected,
  onSelect,
  onRun,
}: {
  result: LauncherResult;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}) {
  const iconData = result.iconDataUrl ?? null;
  return (
    <button
      className={`launcher-result ${selected ? 'selected' : ''}`}
      type="button"
      role="option"
      aria-selected={selected}
      onMouseEnter={onSelect}
      onClick={onRun}
    >
      <span className="launcher-hint" aria-hidden="true">{result.hint}</span>
      <span className="launcher-icon" aria-hidden="true">
        {iconData ? <img src={iconData} alt="" /> : fallbackIcon(result.type)}
      </span>
      <span className="launcher-label">
        <HighlightedLabel label={result.label} ranges={result.matchRanges} />
      </span>
      {result.breadcrumb && <span className="launcher-breadcrumb">{result.breadcrumb}</span>}
    </button>
  );
}
