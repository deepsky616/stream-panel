import type { LibraryEntry } from '../../../shared/types';

type TemplateEntry = Exclude<LibraryEntry, { kind: 'installed-app' }>;

const ACTION_TEMPLATES: TemplateEntry[] = [
  { kind: 'action-template', type: 'url', label: '웹사이트', emoji: '🔗' },
  { kind: 'action-template', type: 'folder', label: '폴더 열기', emoji: '📁' },
  { kind: 'action-template', type: 'file', label: '파일 열기', emoji: '📄' },
  { kind: 'action-template', type: 'app', label: '앱 실행', emoji: '🖥️' },
  { kind: 'folder-template', label: '폴더 만들기', emoji: '🗂️' },
];

interface ActionLibraryProps {
  onAdd: (entry: LibraryEntry) => void;
}

export function ActionLibrary({ onAdd }: ActionLibraryProps) {
  return (
    <aside className="action-library">
      <h2>액션</h2>
      <label className="library-search">
        <span aria-hidden="true">🔍</span>
        <input type="search" placeholder="검색" disabled aria-label="액션 검색" />
      </label>
      <div className="template-list">
        {ACTION_TEMPLATES.map((entry) => (
          <button
            key={`${entry.kind}-${entry.label}`}
            type="button"
            onClick={() => onAdd(entry)}
          >
            <span aria-hidden="true">{entry.emoji}</span>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="library-divider">
        <span>설치된 앱</span>
      </div>
      <p className="library-note">설치된 앱 목록은 다음 단계에서 연결됩니다.</p>
    </aside>
  );
}
