import { useEffect, useRef, useState } from 'react';
import type { DeckItem } from '../../../shared/types';
import { ColorPicker } from '../common/ColorPicker';
import { IconPicker } from '../common/IconPicker';

interface PropertiesPanelProps {
  item: DeckItem | null;
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

export function PropertiesPanel({
  item,
  path,
  focusField,
  onSaved,
  onDelete,
  onDuplicate,
}: PropertiesPanelProps) {
  const [draft, setDraft] = useState<DeckItem | null>(item ? structuredClone(item) : null);
  const [error, setError] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusField === 'label') labelRef.current?.select();
    if (focusField === 'target') targetRef.current?.focus();
  }, [focusField, item?.id]);
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
              onChange={(event) => patch({ label: event.target.value })}
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
          종류 <strong>{draft.kind === 'folder' ? '폴더 키' : draft.type}</strong>
        </div>
        {draft.kind === 'action' && (
          <label className="property-target">
            {draft.type === 'url' ? '주소' : draft.type === 'uwp' ? '앱 식별자' : '경로'}
            <span className="input-with-button">
              <input
                ref={targetRef}
                value={draft.target}
                readOnly={draft.type === 'uwp' || ['folder', 'file', 'app'].includes(draft.type)}
                onChange={(event) => patch({ target: event.target.value })}
              />
              {['folder', 'file', 'app'].includes(draft.type) && (
                <button type="button" onClick={() => void chooseTarget()}>찾아보기</button>
              )}
            </span>
          </label>
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
            {['.bat', '.cmd'].some((extension) => draft.target.toLowerCase().endsWith(extension)) && (
              <p className="script-warning">스크립트 파일입니다. 신뢰하는 파일만 등록하세요.</p>
            )}
          </>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </section>
  );
}
