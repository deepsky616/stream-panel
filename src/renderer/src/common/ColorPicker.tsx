const COLORS = [
  '#5B8CFF',
  '#8B5CF6',
  '#EC4899',
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#64748B',
];

export function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="color-picker">
      <div className="color-palette">
        {COLORS.map((color) => (
          <button
            key={color}
            className={color.toLowerCase() === value.toLowerCase() ? 'selected' : ''}
            type="button"
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`${color} 색상 선택`}
          />
        ))}
      </div>
      <input
        value={value}
        maxLength={7}
        pattern="#[0-9a-fA-F]{6}"
        onChange={(event) => onChange(event.target.value)}
        aria-label="직접 색상값 입력"
      />
    </div>
  );
}
