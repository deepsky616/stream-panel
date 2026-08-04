import { useState } from 'react';
import { createCustomWebWorkflowTemplate } from '../../../shared/webWorkflows';
import type {
  EducationOfficeCode,
  LibraryEntry,
  WebConnectorBrowserId,
  WebWorkflowSystem,
} from '../../../shared/types';

interface CustomWebWorkflowBuilderProps {
  officeCode: EducationOfficeCode;
  onCreate: (entry: LibraryEntry) => Promise<void>;
}

export function CustomWebWorkflowBuilder({
  officeCode,
  onCreate,
}: CustomWebWorkflowBuilderProps) {
  const [name, setName] = useState('');
  const [system, setSystem] = useState<WebWorkflowSystem>('neis');
  const [browserId, setBrowserId] = useState<WebConnectorBrowserId>('edge');
  const [stepLabels, setStepLabels] = useState(['']);
  const [finalText, setFinalText] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateStep = (index: number, label: string) => {
    setStepLabels((current) => current.map((value, stepIndex) => (
      stepIndex === index ? label : value
    )));
  };
  const removeStep = (index: number) => {
    setStepLabels((current) => current.filter((_, stepIndex) => stepIndex !== index));
  };
  const createWorkflow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const entry = createCustomWebWorkflowTemplate({
        name,
        system,
        browserId,
        stepLabels,
        finalText,
        officeCode,
      });
      await onCreate(entry);
      setName('');
      setStepLabels(['']);
      setFinalText('');
      setFeedback('맨 앞 화면의 첫 빈 위치에 웹 업무 키를 추가했습니다.');
    } catch (error) {
      setFeedback(error instanceof Error
        ? error.message
        : '웹 업무 키를 만들지 못했습니다. 입력한 메뉴 이름을 확인해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="custom-workflow-builder" onSubmit={(event) => void createWorkflow(event)}>
      <div className="custom-workflow-heading">
        <div>
          <h3>내 웹 업무 만들기</h3>
          <p>나이스나 에듀파인에서 누를 메뉴 이름을 보이는 순서대로 입력하세요.</p>
        </div>
        <span>윈도우 전용</span>
      </div>
      <div className="custom-workflow-basics">
        <label>
          업무 이름
          <input
            value={name}
            maxLength={24}
            placeholder="예: 에듀파인 내 문서함"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          업무 시스템
          <select value={system} onChange={(event) => setSystem(event.target.value as WebWorkflowSystem)}>
            <option value="neis">나이스</option>
            <option value="edufine">에듀파인</option>
          </select>
        </label>
        <label>
          업무용 브라우저
          <select value={browserId} onChange={(event) => setBrowserId(event.target.value as WebConnectorBrowserId)}>
            <option value="edge">엣지 — 추천</option>
            <option value="chrome">크롬</option>
          </select>
        </label>
      </div>
      <fieldset className="custom-workflow-steps">
        <legend>누를 메뉴 이름</legend>
        <p>주소나 선택자가 아니라 화면에 실제로 보이는 이름을 정확히 입력하세요.</p>
        {stepLabels.map((label, index) => (
          <div className="custom-workflow-step" key={`step-${index + 1}`}>
            <span>{index + 1}</span>
            <input
              value={label}
              maxLength={40}
              aria-label={`${index + 1}번째 누를 메뉴 이름`}
              placeholder={index === 0 ? '예: 업무관리' : '예: 문서관리'}
              onChange={(event) => updateStep(index, event.target.value)}
            />
            <button
              type="button"
              disabled={stepLabels.length === 1}
              onClick={() => removeStep(index)}
              aria-label={`${index + 1}번째 단계 삭제`}
            >삭제</button>
          </div>
        ))}
        <button
          className="custom-workflow-add-step"
          type="button"
          disabled={stepLabels.length >= 8}
          onClick={() => setStepLabels((current) => [...current, ''])}
        >단계 추가</button>
      </fieldset>
      <label className="custom-workflow-final">
        도착 화면 확인 문구
        <input
          value={finalText}
          maxLength={60}
          placeholder="예: 내 문서함 목록"
          onChange={(event) => setFinalText(event.target.value)}
        />
        <small>마지막 메뉴를 누른 뒤 이 문구가 보여야 이동을 끝냅니다.</small>
      </label>
      <div className="custom-workflow-route" aria-label="웹 업무 이동 경로 미리보기">
        <span>{system === 'neis' ? '나이스' : '에듀파인'}</span>
        {stepLabels.filter((label) => label.trim()).map((label, index) => (
          <span key={`${label}-${index}`}>→ {label.trim()}</span>
        ))}
        {finalText.trim() && <strong>도착: {finalText.trim()}</strong>}
      </div>
      <div className="custom-workflow-submit">
        <button className="primary-action" type="submit" disabled={saving}>
          {saving ? '추가 중…' : '키로 추가'}
        </button>
        <small>저장·제출·결재·등록·신청·삭제·확인과 인증 입력 단계는 추가할 수 없습니다.</small>
      </div>
      {feedback && <p className="custom-workflow-feedback" role="status">{feedback}</p>}
    </form>
  );
}
