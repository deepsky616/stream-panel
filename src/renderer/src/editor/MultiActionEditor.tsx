import type { ActionItem, DeckItem, MultiActionStep } from '../../../shared/types';

interface ActionChoice {
  id: string;
  label: string;
  breadcrumb: string;
}

interface MultiActionEditorProps {
  item: ActionItem;
  root: readonly DeckItem[];
  onChange: (item: ActionItem) => void;
}

function collectActionChoices(
  items: readonly DeckItem[],
  excludedId: string,
  parents: readonly string[] = [],
): ActionChoice[] {
  const choices: ActionChoice[] = [];
  for (const item of items) {
    if (item.kind === 'folder') {
      choices.push(...collectActionChoices(item.children, excludedId, [...parents, item.label]));
    } else if (item.id !== excludedId && item.type !== 'multi' && item.target !== '') {
      choices.push({
        id: item.id,
        label: item.label,
        breadcrumb: parents.join(' › '),
      });
    }
  }
  return choices;
}

export function MultiActionEditor({ item, root, onChange }: MultiActionEditorProps) {
  const steps = item.multiAction?.steps ?? [];
  const choices = collectActionChoices(root, item.id);
  const choicesById = new Map(choices.map((choice) => [choice.id, choice]));
  const totalDelayMs = steps.reduce(
    (total, step) => total + (step.kind === 'delay' ? step.delayMs : 0),
    0,
  );
  const updateSteps = (next: MultiActionStep[]) => {
    onChange({ ...item, multiAction: { steps: next } });
  };
  const replaceStep = (index: number, step: MultiActionStep) => {
    updateSteps(steps.map((candidate, stepIndex) => (stepIndex === index ? step : candidate)));
  };
  const moveStep = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    const next = [...steps];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateSteps(next);
  };

  return (
    <div className="multi-action-editor">
      <div className="multi-action-heading">
        <div>
          <strong>실행 단계</strong>
          <small>{steps.length}/20단계 · 총 대기 {(totalDelayMs / 1000).toFixed(1)}초</small>
        </div>
        <div>
          <button
            type="button"
            disabled={steps.length >= 20 || choices.length === 0}
            onClick={() => {
              const first = choices[0];
              if (first) {
                updateSteps([
                  ...steps,
                  { id: crypto.randomUUID(), kind: 'action', actionId: first.id },
                ]);
              }
            }}
          >
            키 추가
          </button>
          <button
            type="button"
            disabled={steps.length >= 20}
            onClick={() =>
              updateSteps([
                ...steps,
                { id: crypto.randomUUID(), kind: 'delay', delayMs: 1000 },
              ])
            }
          >
            대기 추가
          </button>
        </div>
      </div>
      {steps.length === 0 ? (
        <p className="multi-action-empty">
          실행할 키나 대기를 추가하세요. 위에서 아래 순서로 실행합니다.
        </p>
      ) : (
        <ol className="multi-action-steps">
          {steps.map((step, index) => {
            const selected = step.kind === 'action' ? choicesById.get(step.actionId) : undefined;
            return (
              <li key={step.id}>
                <span className="multi-step-number">{index + 1}</span>
                {step.kind === 'action' ? (
                  <div className="multi-step-value">
                    <select
                      value={step.actionId}
                      onChange={(event) =>
                        replaceStep(index, { ...step, actionId: event.target.value })
                      }
                    >
                      {!selected && <option value={step.actionId}>찾을 수 없는 키</option>}
                      {choices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.breadcrumb
                            ? `${choice.breadcrumb} › ${choice.label}`
                            : choice.label}
                        </option>
                      ))}
                    </select>
                    <small>{selected?.breadcrumb || '첫 화면'}</small>
                  </div>
                ) : (
                  <label className="multi-delay-value">
                    <input
                      type="number"
                      min="0"
                      max="60"
                      step="0.1"
                      value={step.delayMs / 1000}
                      onChange={(event) => {
                        const seconds = Number(event.target.value);
                        replaceStep(index, {
                          ...step,
                          delayMs: Number.isFinite(seconds)
                            ? Math.max(0, Math.min(60, Math.round(seconds * 1000)))
                            : 0,
                        });
                      }}
                    />
                    초 대기
                  </label>
                )}
                <div className="multi-step-actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveStep(index, -1)}
                    aria-label={`${index + 1}번 단계를 위로 이동`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                    aria-label={`${index + 1}번 단계를 아래로 이동`}
                  >
                    ↓
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => updateSteps(steps.filter((_, stepIndex) => stepIndex !== index))}
                    aria-label={`${index + 1}번 단계 삭제`}
                  >
                    삭제
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {choices.length === 0 && (
        <p className="field-error">먼저 실행할 웹사이트, 파일, 폴더 또는 앱 키를 하나 이상 만드세요.</p>
      )}
      {totalDelayMs > 60_000 && (
        <p className="field-error">전체 대기 시간은 60초를 넘을 수 없습니다.</p>
      )}
      <p className="multi-action-note">
        한 단계가 실패하면 바로 멈춥니다. 다른 멀티 액션은 단계로 넣을 수 없습니다.
      </p>
    </div>
  );
}
