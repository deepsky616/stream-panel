import { useEffect, useRef, useState } from 'react';
import { normalizeAccelerator } from '../../../shared/accelerator';
import type { AppConfig, DeckItem, DetectedBrowser } from '../../../shared/types';
import { ColorPicker } from '../common/ColorPicker';
import { IconPicker } from '../common/IconPicker';
import { MultiActionEditor } from './MultiActionEditor';
import {
  getWebWorkflowSummary,
  updateCustomWebWorkflowName,
  updateWebWorkflowBrowser,
} from './webWorkViewModel';

interface PropertiesPanelProps {
  item: DeckItem | null;
  root: readonly DeckItem[];
  platform: AppConfig['platform'];
  path: string[];
  focusField: 'label' | 'target' | null;
  onSaved: (item: DeckItem) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function normalizeUrl(target: string): string {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  return `https://${target}`;
}

function splitArguments(value: string): string[] {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const marker = raw.lastIndexOf('Error: ');
  return marker >= 0 ? raw.slice(marker + 7) : raw;
}

const ACTION_TYPE_LABELS = {
  url: '웹사이트',
  folder: '폴더 열기',
  file: '파일 열기',
  app: '앱 실행',
  uwp: '스토어 앱',
  multi: '멀티 액션',
} as const;

export function PropertiesPanel({
  item,
  root,
  platform,
  path,
  focusField,
  onSaved,
  onDelete,
  onDuplicate,
}: PropertiesPanelProps) {
  const [draft, setDraft] = useState<DeckItem | null>(item ? structuredClone(item) : null);
  const [error, setError] = useState<string | null>(null);
  const [hotkeyMessage, setHotkeyMessage] = useState<string | null>(
    item?.kind === 'action' && item.globalHotkey ? '등록됨' : null,
  );
  const [browsers, setBrowsers] = useState<DetectedBrowser[]>([]);
  const [browsersLoaded, setBrowsersLoaded] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusField === 'label') labelRef.current?.select();
    if (focusField === 'target') targetRef.current?.focus();
  }, [focusField, item?.id]);
  useEffect(() => {
    let active = true;
    void window.api.browsers.list().then((detected) => {
      if (!active) return;
      setBrowsers(detected);
      setBrowsersLoaded(true);
    }).catch(() => {
      if (active) setBrowsersLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!draft || !item || JSON.stringify(draft) === JSON.stringify(item)) return;
    const timer = setTimeout(() => {
      const candidate =
        draft.kind === 'action' && draft.type === 'url'
          ? { ...draft, target: normalizeUrl(draft.target) }
          : draft;
      void window.api.deck
        .upsert({ path, item: candidate })
        .then(() => {
          setError(null);
          setDraft(candidate);
          onSaved(candidate);
        })
        .catch((caught) => setError(errorMessage(caught)));
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, item, onSaved, path]);

  if (!draft) {
    return (
      <section className="properties-panel empty-properties">
        키를 선택하거나 오른쪽에서 액션을 끌어다 놓으세요.
      </section>
    );
  }

  const patch = (changes: Partial<DeckItem>) => setDraft({ ...draft, ...changes } as DeckItem);
  const selectedBrowser =
    draft.kind === 'action' && draft.type === 'url' && draft.browser
      ? browsers.find((browser) => browser.path === draft.browser?.path)
      : undefined;
  const workflowSummary =
    draft.kind === 'action' && draft.webWorkflow
      ? getWebWorkflowSummary(draft)
      : null;
  const chooseTarget = async () => {
    if (draft.kind !== 'action') return;
    if (draft.type === 'folder') {
      const target = await window.api.picker.folder();
      if (target) patch({ target });
    } else if (draft.type === 'file') {
      const target = await window.api.picker.file();
      if (target) patch({ target });
    } else if (draft.type === 'app') {
      const selected = await window.api.picker.executable();
      if (selected) patch({ ...selected, label: draft.label || selected.name });
    }
  };
  const captureGlobalHotkey = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      patch({ globalHotkey: undefined });
      setHotkeyMessage(null);
      return;
    }
    const modifiers = [
      event.ctrlKey || event.metaKey ? 'CommandOrControl' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const accelerator = normalizeAccelerator([...modifiers, key].join('+'));
    const result = await window.api.hotkey.validate({ accelerator, itemId: draft.id });
    if (!result.ok) {
      setHotkeyMessage(result.reason);
      return;
    }
    patch({ globalHotkey: accelerator });
    setHotkeyMessage('등록됨');
  };

  return (
    <section className="properties-panel">
      <div className="properties-heading">
        <h2>선택한 키</h2>
        <div>
          <button type="button" onClick={onDuplicate}>복제</button>
          <button className="danger" type="button" onClick={onDelete}>삭제</button>
        </div>
      </div>
      <div className="property-grid">
        <label>
          제목
          <span className="input-with-count">
            <input
              ref={labelRef}
              value={draft.label}
              maxLength={24}
              onChange={(event) => {
                const label = event.target.value;
                if (draft.kind === 'action') {
                  setDraft(updateCustomWebWorkflowName(draft, label));
                } else {
                  patch({ label });
                }
              }}
            />
            <small>{Array.from(draft.label).length}/24</small>
          </span>
        </label>
        <label>
          색상
          <ColorPicker value={draft.color} onChange={(color) => patch({ color })} />
        </label>
        <label>
          아이콘
          <IconPicker icon={draft.icon} onChange={(icon) => patch({ icon })} />
        </label>
        <div className="property-kind">
          종류 <strong>{draft.kind === 'folder' ? '폴더 키' : workflowSummary ? '웹 업무' : ACTION_TYPE_LABELS[draft.type]}</strong>
        </div>
        {draft.kind === 'action' && draft.type !== 'multi' && (
          <label className="property-target">
            {draft.type === 'url' ? '주소' : draft.type === 'uwp' ? '앱 식별자' : '경로'}
            <span className="input-with-button">
              <input
                ref={targetRef}
                value={draft.target}
                readOnly={Boolean(draft.webWorkflow) || draft.type === 'uwp' || ['folder', 'file', 'app'].includes(draft.type)}
                onChange={(event) => patch({ target: event.target.value })}
              />
              {['folder', 'file', 'app'].includes(draft.type) && (
                <button type="button" onClick={() => void chooseTarget()}>찾아보기</button>
              )}
            </span>
          </label>
        )}
        {draft.kind === 'action' && draft.type === 'multi' && (
          <MultiActionEditor
            item={draft}
            root={root}
            onChange={(next) => setDraft(next)}
          />
        )}
        {draft.kind === 'action' && draft.type === 'app' && (
          <>
            <label>
              실행 인자
              <input
                value={draft.args.join(' ')}
                onChange={(event) => patch({ args: splitArguments(event.target.value) })}
              />
            </label>
            <label>
              작업 폴더
              <span className="input-with-button">
                <input value={draft.workingDir ?? ''} readOnly />
                <button
                  type="button"
                  onClick={() => void window.api.picker.folder().then((value) => value && patch({ workingDir: value }))}
                >
                  찾아보기
                </button>
              </span>
            </label>
            {['.bat', '.cmd', '.sh', '.command'].some((extension) =>
              draft.target.toLowerCase().endsWith(extension),
            ) && (
              <p className="script-warning">스크립트 파일입니다. 신뢰하는 파일만 등록하세요.</p>
            )}
          </>
        )}
        {draft.kind === 'action' && draft.type === 'url' && (
          <div className="browser-settings">
            {workflowSummary && draft.webWorkflow ? (
              <>
              <div className="workflow-summary">
                <strong>{workflowSummary.label}</strong>
                <span>{workflowSummary.custom
                  ? `${workflowSummary.systemLabel} 사용자 지정 이동`
                  : '개인 브라우저와 분리된 전용 창에서 정해진 작성 화면까지만 이동합니다.'}</span>
              </div>
              {workflowSummary.custom && (
                <div className="workflow-route-summary">
                  <span>{workflowSummary.route.join(' → ')}</span>
                  <strong>도착 확인: {workflowSummary.finalText}</strong>
                </div>
              )}
              <label>
                업무용 브라우저
                <select
                  value={draft.webWorkflow.browserId}
                  onChange={(event) => setDraft(updateWebWorkflowBrowser(
                    draft,
                    event.target.value as 'edge' | 'chrome',
                  ))}
                >
                  <option value="edge">엣지 — 추천</option>
                  <option value="chrome">크롬</option>
                </select>
              </label>
              <p className="workflow-safety-note">
                {platform === 'win32'
                  ? '암호와 인증서 정보는 저장하지 않습니다. 저장·제출·상신·승인·결재 단추도 자동으로 누르지 않습니다.'
                  : '나이스와 에듀파인 자동 이동은 윈도우에서만 지원합니다.'}
              </p>
              </>
            ) : (
              <>
                <label>
                  열 브라우저
                  <select
                    value={draft.browser?.path ?? ''}
                    onChange={(event) => {
                      const browser = browsers.find((candidate) => candidate.path === event.target.value);
                      patch({
                        browser: browser
                          ? { path: browser.path, appMode: false }
                          : undefined,
                      } as Partial<DeckItem>);
                    }}
                  >
                    <option value="">기본 브라우저</option>
                    {browsers.map((browser) => (
                      <option key={browser.path} value={browser.path}>{browser.name}</option>
                    ))}
                    {draft.browser && browsersLoaded && !selectedBrowser && (
                      <option value={draft.browser.path}>찾을 수 없음 — {draft.browser.path}</option>
                    )}
                  </select>
                </label>
                {draft.browser && browsersLoaded && !selectedBrowser && (
                  <p className="browser-warning">지정한 브라우저를 찾을 수 없습니다. 실행할 때 기본 브라우저로 엽니다.</p>
                )}
                {selectedBrowser?.supportsProfiles && selectedBrowser.profiles.length > 1 && (
                  <label>
                    프로필
                    <select
                      value={draft.browser?.profileDir ?? ''}
                      onChange={(event) => patch({
                        browser: draft.browser
                          ? {
                              ...draft.browser,
                              profileDir: event.target.value || undefined,
                            }
                          : undefined,
                      } as Partial<DeckItem>)}
                    >
                      <option value="">브라우저 기본 프로필</option>
                      {selectedBrowser.profiles.map((profile) => (
                        <option key={profile.dir} value={profile.dir}>{profile.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={!selectedBrowser?.supportsAppMode ? 'disabled-option' : ''}>
                  <input
                    type="checkbox"
                    checked={draft.browser?.appMode ?? false}
                    disabled={!selectedBrowser?.supportsAppMode}
                    onChange={(event) => patch({
                      browser: draft.browser
                        ? { ...draft.browser, appMode: event.target.checked }
                        : undefined,
                    } as Partial<DeckItem>)}
                  />
                  전용 창으로 열기
                  <small>주소창과 탭이 없는 창으로 열립니다</small>
                </label>
                {selectedBrowser && !selectedBrowser.supportsAppMode && (
                  <p className="browser-note">이 브라우저는 프로필과 전용 창을 지원하지 않습니다.</p>
                )}
              </>
            )}
          </div>
        )}
        {draft.kind === 'action' && (
          <label className="property-hotkey">
            전역 단축키
            <span className="input-with-button">
              <input
                className="hotkey-input"
                value={draft.globalHotkey ?? ''}
                placeholder="키 조합을 누르세요"
                readOnly
                onKeyDown={(event) => void captureGlobalHotkey(event)}
                aria-label="키별 전역 단축키 입력"
              />
              <button
                type="button"
                disabled={!draft.globalHotkey}
                onClick={() => {
                  patch({ globalHotkey: undefined });
                  setHotkeyMessage(null);
                }}
              >
                지우기
              </button>
            </span>
            {hotkeyMessage && (
              <small className={hotkeyMessage === '등록됨' ? 'hotkey-ok' : 'field-error'}>
                {hotkeyMessage}
              </small>
            )}
          </label>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </section>
  );
}
