interface BackTileProps {
  buttonSize: number;
  onClick: () => void;
}

export function BackTile({ buttonSize, onClick }: BackTileProps) {
  return (
    <button
      className="key-tile back-tile"
      style={{ width: buttonSize, height: buttonSize }}
      type="button"
      onClick={onClick}
      aria-label="상위 폴더로 돌아가기"
    >
      <span className="key-icon" aria-hidden="true">
        ↩
      </span>
      <span className="key-label">뒤로</span>
    </button>
  );
}
