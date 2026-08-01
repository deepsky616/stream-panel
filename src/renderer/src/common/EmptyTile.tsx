interface EmptyTileProps {
  buttonSize: number;
  locked: boolean;
  onClick: () => void;
}

export function EmptyTile({ buttonSize, locked, onClick }: EmptyTileProps) {
  return (
    <button
      className="key-tile empty-tile"
      style={{ width: buttonSize, height: buttonSize }}
      type="button"
      disabled={locked}
      onClick={onClick}
      aria-label={locked ? '잠긴 빈 키' : '빈 키에 항목 추가'}
    >
      {!locked && <span aria-hidden="true">+</span>}
    </button>
  );
}
