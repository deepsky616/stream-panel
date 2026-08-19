import { useState } from 'react';
import { EDUCATION_OFFICES } from '../../../shared/educationOffices';
import {
  createCustomWebWorkflowTemplate,
  resolveWebWorkflowOfficeCode,
} from '../../../shared/webWorkflows';
import type {
  ActionItem,
  CustomWebWorkflowStep,
  EducationOfficeCode,
  LibraryEntry,
  WebConnectorBrowserId,
  WebWorkflowSystem,
} from '../../../shared/types';

const EXACT_TEXT_STEP: CustomWebWorkflowStep['kind'] = 'exact-text';
type StepOption = {
  value: NonNullable<CustomWebWorkflowStep['kind']>;
  label: string;
};
const NEIS_STEP_OPTIONS: ReadonlyArray<StepOption> = [
  { value: 'exact-text', label: '화면 글씨' },
  { value: 'neis-management-tab', label: '하단 관리 탭' },
  { value: 'neis-new-page', label: '새 신청 창 열기' },
];
const EDUFINE_STEP_OPTIONS: ReadonlyArray<StepOption> = [
  { value: 'exact-text', label: '화면 글씨' },
  { value: 'edufine-job', label: '업무 전환' },
  { value: 'edufine-left-menu', label: '왼쪽 메뉴' },
  { value: 'edufine-top-menu', label: '상단 메뉴' },
  { value: 'edufine-document-menu', label: '문서관리 메뉴' },
  { value: 'edufine-right-menu', label: '오른쪽 메뉴' },
  { value: 'edufine-mega-menu', label: '펼침 메뉴' },
  { value: 'edufine-popup-menu', label: '팝업 메뉴' },
  { value: 'edufine-submenu', label: '하위 메뉴' },
  { value: 'edufine-wxs-form', label: '기안 편집기 열기' },
];

interface CustomWebWorkflowBuilderProps {
  officeCode: EducationOfficeCode;
  initialItem?: ActionItem;
  onCreate?: (entry: LibraryEntry) => Promise<void>;
  onSave?: (entry: LibraryEntry) => Promise<void>;
}

export function CustomWebWorkflowBuilder({
  officeCode,
  initialItem,
  onCreate,
  onSave,
}: CustomWebWorkflowBuilderProps) {
  const initialSpec = initialItem?.webWorkflow?.id === 'custom'
    ? initialItem.webWorkflow
    : null;
  const editing = Boolean(initialSpec);
  const [name, setName] = useState(initialSpec?.custom.name ?? '');
  const [system, setSystem] = useState<WebWorkflowSystem>(initialSpec?.custom.system ?? 'neis');
  const [browserId, setBrowserId] = useState<WebConnectorBrowserId>(initialSpec?.browserId ?? 'edge');
  const [selectedOfficeCode, setSelectedOfficeCode] = useState<EducationOfficeCode>(
    initialSpec && initialItem
      ? resolveWebWorkflowOfficeCode(initialSpec, initialItem.target, officeCode)
      : officeCode,
  );
  const [stepLabels, setStepLabels] = useState(
    initialSpec?.custom.steps.map((step) => step.label) ?? [''],
  );
  const [stepKinds, setStepKinds] = useState<Array<CustomWebWorkflowStep['kind']>>(
    initialSpec?.custom.steps.map((step) => step.kind ?? EXACT_TEXT_STEP) ?? [EXACT_TEXT_STEP],
  );
  const [finalText, setFinalText] = useState(initialSpec?.custom.finalText ?? '');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stepOptions = system === 'edufine' ? EDUFINE_STEP_OPTIONS : NEIS_STEP_OPTIONS;
  const finalStepKind = stepKinds[stepKinds.length - 1] ?? EXACT_TEXT_STEP;
  const opensWxsClient = system === 'edufine' && finalStepKind === 'edufine-wxs-form';
  const opensNeisPage = system === 'neis' && finalStepKind === 'neis-new-page';

  const updateStep = (index: number, label: string) => {
    setStepLabels((current) => current.map((value, stepIndex) => (
      stepIndex === index ? label : value
    )));
  };
  const removeStep = (index: number) => {
    setStepLabels((current) => current.filter((_, stepIndex) => stepIndex !== index));
    setStepKinds((current) => current.filter((_, stepIndex) => stepIndex !== index));
  };
  const updateStepKind = (index: number, kind: CustomWebWorkflowStep['kind']) => {
    setStepKinds((current) => current.map((value, stepIndex) => (
      stepIndex === index ? kind : value
    )));
  };
  const saveWorkflow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const entry = createCustomWebWorkflowTemplate({
        name,
        system,
        browserId,
        stepLabels,
        stepKinds,
        finalText,
        officeCode: selectedOfficeCode,
      });
      const persist = editing ? onSave : onCreate;
      if (!persist) throw new Error('웹 업무 저장 기능을 준비하지 못했습니다. 편집기를 다시 열어 주세요.');
      await persist(entry);
      if (!editing) {
        setName('');
        setStepLabels(['']);
        setStepKinds([EXACT_TEXT_STEP]);
        setFinalText('');
      }
      setFeedback(editing
        ? '선택한 웹 업무 키의 변경 내용을 저장했습니다.'
        : '맨 앞 화면의 첫 빈 위치에 웹 업무 키를 추가했습니다.');
    } catch (error) {
      setFeedback(error instanceof Error
        ? error.message
        : '웹 업무 키를 만들지 못했습니다. 입력한 메뉴 이름을 확인해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={`custom-workflow-builder${editing ? ' custom-workflow-editor' : ''}`}
      onSubmit={(event) => void saveWorkflow(event)}
    >
      <div className="custom-workflow-heading">
        <div>
          <h3>{editing ? '내 웹 업무 편집' : '내 웹 업무 만들기'}</h3>
          <p>{editing
            ? '선택한 키의 교육청과 이동 경로를 수정한 뒤 저장하세요.'
            : '연결된 나이스나 에듀파인 탭에서 누를 메뉴 이름을 보이는 순서대로 입력하세요.'}</p>
        </div>
        <span>{editing ? '선택한 키' : '윈도우 전용'}</span>
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
          <select value={system} onChange={(event) => {
            setSystem(event.target.value as WebWorkflowSystem);
            setStepKinds((current) => current.map(() => EXACT_TEXT_STEP));
          }}>
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
        <label>
          교육청
          <select
            value={selectedOfficeCode}
            onChange={(event) => setSelectedOfficeCode(event.target.value as EducationOfficeCode)}
          >
            {EDUCATION_OFFICES.map((office) => (
              <option key={office.code} value={office.code}>{office.name}</option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="custom-workflow-steps">
        <legend>업무 이동 단계</legend>
        <p>{system === 'edufine'
          ? '업무 전환과 메뉴 위치를 구분하세요. 표준서식처럼 새 기안 창을 여는 마지막 단계는 기안 편집기 열기를 선택합니다.'
          : '화면 글씨·하단 관리 탭·새 신청 창 열기를 구분하면 현재 연결된 나이스 탭에서 순서대로 실행합니다.'}</p>
        {stepLabels.map((label, index) => (
          <div className="custom-workflow-step" key={`step-${index + 1}`}>
            <span>{index + 1}</span>
            <select
              value={stepKinds[index] ?? EXACT_TEXT_STEP}
              aria-label={`${index + 1}번째 단계 유형`}
              onChange={(event) => updateStepKind(
                index,
                event.target.value as NonNullable<CustomWebWorkflowStep['kind']>,
              )}
            >
              {stepOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
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
          onClick={() => {
            setStepLabels((current) => [...current, '']);
            setStepKinds((current) => [...current, EXACT_TEXT_STEP]);
          }}
        >단계 추가</button>
      </fieldset>
      <label className="custom-workflow-final">
        {opensWxsClient
          ? '새 기안 편집기 창 제목 확인 문구'
          : opensNeisPage
            ? '새 신청 창 확인 문구'
            : '도착 화면 확인 문구'}
        <input
          value={finalText}
          maxLength={60}
          placeholder={opensWxsClient ? '예: 표준서식' : opensNeisPage ? '예: 출장신청' : '예: 내 문서함 목록'}
          onChange={(event) => setFinalText(event.target.value)}
        />
        <small>{opensWxsClient
          ? '마지막 메뉴를 누른 뒤 이 문구가 포함된 WXSClient 창이 새로 열려야 완료합니다.'
          : opensNeisPage
            ? '마지막 메뉴를 누른 뒤 새 브라우저 창에서 이 문구가 보여야 완료합니다.'
            : '마지막 메뉴를 누른 뒤 이 문구가 보여야 이동을 끝냅니다.'}</small>
      </label>
      <div className="custom-workflow-route" aria-label="웹 업무 이동 경로 미리보기">
        <span>{EDUCATION_OFFICES.find((office) => office.code === selectedOfficeCode)?.name}</span>
        <span>{system === 'neis' ? '나이스' : '에듀파인'}</span>
        {stepLabels.map((label, index) => label.trim() ? (
          <span key={`${label}-${index}`}>→ {
            `${stepOptions.find((option) => option.value === stepKinds[index])?.label ?? '화면 글씨'}: `
          }{label.trim()}</span>
        ) : null)}
        {finalText.trim() && <strong>도착: {finalText.trim()}</strong>}
      </div>
      <div className="custom-workflow-submit">
        <button className="primary-action" type="submit" disabled={saving}>
          {saving
            ? (editing ? '저장 중…' : '추가 중…')
            : (editing ? '변경 내용 저장' : '키로 추가')}
        </button>
        <small>만든 키도 선택한 시스템의 로그인 기준 탭을 보존하고 같은 업무용 브라우저 창의 작업 탭에서 실행합니다. 저장·제출·상신·승인·결재·등록·신청·확인·인증 입력 단계는 실행 직전에 확인하며, 인증서와 암호는 자동 입력하지 않습니다.</small>
      </div>
      {feedback && <p className="custom-workflow-feedback" role="status">{feedback}</p>}
    </form>
  );
}
