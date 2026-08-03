import { useDraggable } from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import type { InstalledApp, LibraryEntry } from '../../../shared/types';
import { createWebWorkflowTemplate } from '../../../shared/webWorkflows';
import type { DragData } from './dndTypes';

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

function DraggableTemplate({ entry, onAdd }: { entry: TemplateEntry; onAdd: () => void }) {
  const data: DragData = { source: 'library', entry };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `library:${entry.kind}:${entry.kind === 'action-template' ? entry.type : 'folder'}`,
    data,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{ opacity: isDragging ? 0.35 : 1 }}
      onClick={onAdd}
      {...attributes}
      {...listeners}
    >
      <span aria-hidden="true">{entry.emoji}</span>
      {entry.label}
    </button>
  );
}

function InstalledAppRow({ app, top, onAdd }: { app: InstalledApp; top: number; onAdd: () => void }) {
  const [icon, setIcon] = useState<string | null>(app.iconDataUrl ?? null);
  const entry: LibraryEntry = { kind: 'installed-app', app };
  const data: DragData = { source: 'library', entry };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `installed:${app.type}:${app.target}`,
    data,
  });
  useEffect(() => {
    let active = true;
    if (!icon) {
      void window.api.icon
        .resolve({ type: app.type, target: app.target })
        .then((resolved) => active && setIcon(resolved));
    }
    return () => {
      active = false;
    };
  }, [app.target, app.type, icon]);
  return (
    <button
      ref={setNodeRef}
      className="installed-app-row"
      type="button"
      style={{ top, opacity: isDragging ? 0.35 : 1 }}
      onClick={onAdd}
      title={app.name}
      {...attributes}
      {...listeners}
    >
      <span className="installed-app-icon" aria-hidden="true">
        {icon ? <img src={icon} alt="" /> : app.name.slice(0, 1).toUpperCase()}
      </span>
      <span>{app.name}</span>
    </button>
  );
}

function InstalledAppList({ apps, onAdd }: { apps: InstalledApp[]; onAdd: (app: InstalledApp) => void }) {
  const itemHeight = 44;
  const viewportHeight = 220;
  const [scrollTop, setScrollTop] = useState(0);
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 3);
  const end = Math.min(apps.length, Math.ceil((scrollTop + viewportHeight) / itemHeight) + 3);
  return (
    <div
      className="installed-app-list"
      style={{ height: viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="installed-app-spacer" style={{ height: apps.length * itemHeight }}>
        {apps.slice(start, end).map((app, offset) => (
          <InstalledAppRow
            key={`${app.type}:${app.target}`}
            app={app}
            top={(start + offset) * itemHeight}
            onAdd={() => onAdd(app)}
          />
        ))}
      </div>
    </div>
  );
}

export function ActionLibrary({ onAdd }: ActionLibraryProps) {
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<string>('');
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
  const workflowBrowser = platform === 'darwin' ? 'chrome' : 'edge';
  const workflowTemplates: TemplateEntry[] = [
    createWebWorkflowTemplate('neis-leave', workflowBrowser),
    createWebWorkflowTemplate('neis-trip', workflowBrowser),
    createWebWorkflowTemplate('edufine-draft', workflowBrowser),
    createWebWorkflowTemplate('edufine-purchase', workflowBrowser),
  ];
  const templates = ACTION_TEMPLATES.filter((entry) =>
    entry.label.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
  );
  const filteredWorkflows = workflowTemplates.filter((entry) =>
    entry.label.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
  );
  const filteredApps = apps.filter((app) =>
    app.name.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
  );

  const loadApps = async (refresh = false) => {
    setLoading(true);
    try {
      setApps(await window.api.apps.list({ refresh }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void window.api.app.info().then((info) => active && setPlatform(info.platform));
    void window.api.apps
      .list()
      .then((items) => active && setApps(items))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <aside className="action-library">
      <h2>액션</h2>
      <label className="library-search">
        <span aria-hidden="true">🔍</span>
        <input
          type="search"
          placeholder="검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="액션 검색"
        />
      </label>
      <div className="template-list">
        {templates.map((entry) => (
          <DraggableTemplate
            key={`${entry.kind}-${entry.label}`}
            entry={entry}
            onAdd={() => onAdd(entry)}
          />
        ))}
      </div>
      {filteredWorkflows.length > 0 && (
        <>
          <div className="library-divider"><span>웹 업무</span></div>
          <div className="template-list workflow-template-list">
            {filteredWorkflows.map((entry) => (
              <DraggableTemplate
                key={entry.label}
                entry={entry}
                onAdd={() => onAdd(entry)}
              />
            ))}
          </div>
          <p className="library-note workflow-note">작성 화면까지만 열고 저장·제출·결재 전에는 멈춥니다.</p>
        </>
      )}
      <div className="library-divider">
        <span>설치된 앱</span>
      </div>
      {loading ? (
        <div className="app-skeleton" aria-label="설치된 앱을 불러오는 중">
          <span /><span /><span /><span />
        </div>
      ) : platform && !['win32', 'darwin'].includes(platform) ? (
        <p className="library-note">이 운영체제에서는 설치된 앱 목록을 지원하지 않습니다.</p>
      ) : filteredApps.length ? (
        <InstalledAppList apps={filteredApps} onAdd={(app) => onAdd({ kind: 'installed-app', app })} />
      ) : (
        <p className="library-note">조건에 맞는 설치된 앱이 없습니다.</p>
      )}
      <button className="refresh-apps" type="button" onClick={() => void loadApps(true)} disabled={loading}>
        목록 새로고침
      </button>
    </aside>
  );
}
