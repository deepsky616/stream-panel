export const NEIS_ACHIEVEMENT_LEVELS = [
  '매우잘함',
  '잘함',
  '보통',
  '노력요함',
] as const;

export type NeisAchievementLevel = typeof NEIS_ACHIEVEMENT_LEVELS[number];

export interface NeisAssessmentRecord {
  number: string;
  name: string;
  level: NeisAchievementLevel;
  score: number;
  maxScore: number;
  percentage: number;
}

export interface NeisAssessmentImport {
  course: string;
  assessment: string;
  classLabel: string;
  records: NeisAssessmentRecord[];
}

export interface NeisAssessmentApplyResult {
  status: 'ok' | 'not-on-page' | 'incomplete' | 'unsupported';
  method?: 'dom' | 'nexacro';
  matched: number;
  updated: number;
  already: number;
  missing: string[];
  detail?: string;
}

const CLIPBOARD_TITLE = '[NEIS 성취기준별 평가 입력 확인표]';
const TABLE_HEADER = ['번호', '이름', '단계', '교사확정총점', '총배점', '비율'];
const MAX_STUDENTS = 60;

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

function metadataValue(lines: readonly string[], label: string): string {
  const prefix = `${label}:`;
  const line = lines.find((candidate) => normalizeText(candidate).startsWith(prefix));
  return line ? normalizeText(line).slice(prefix.length).trim() : '';
}

function parseFiniteNumber(value: string, label: string, rowNumber: number): number {
  const normalized = value.trim().replace(/%$/, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${rowNumber}번째 학생의 ${label} 값이 숫자가 아닙니다.`);
  }
  return parsed;
}

export function parseNeisAssessmentClipboard(text: string): NeisAssessmentImport {
  if (typeof text !== 'string' || text.length > 100_000) {
    throw new Error('클립보드의 NEIS 입력 자료가 너무 크거나 올바르지 않습니다.');
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (normalizeText(lines[0]) !== CLIPBOARD_TITLE) {
    throw new Error('AI 채점 화면의 NEIS 입력 도우미에서 ‘번호·성취수준 복사’를 먼저 눌러 주세요.');
  }
  const headerIndex = lines.findIndex((line) => {
    const columns = line.split('\t').map(normalizeText);
    return TABLE_HEADER.every((header, index) => columns[index] === header);
  });
  if (headerIndex < 0) {
    throw new Error('클립보드에서 학생별 NEIS 단계 표를 찾지 못했습니다. 다시 복사해 주세요.');
  }
  const course = metadataValue(lines, '수업');
  const assessment = metadataValue(lines, '평가');
  const classLabel = metadataValue(lines, '학급');
  if (!course || !assessment || !classLabel) {
    throw new Error('수업·평가·학급 정보가 빠져 있습니다. AI 채점 화면에서 다시 복사해 주세요.');
  }
  const levelSet = new Set<string>(NEIS_ACHIEVEMENT_LEVELS);
  const records: NeisAssessmentRecord[] = [];
  const numbers = new Set<string>();
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;
    const columns = line.split('\t').map((value) => value.trim());
    if (columns.length < TABLE_HEADER.length) {
      throw new Error(`${records.length + 1}번째 학생 행의 열 수가 맞지 않습니다.`);
    }
    const [numberValue, nameValue, levelValue, scoreValue, maxScoreValue, percentageValue] = columns;
    const number = normalizeText(numberValue);
    const name = normalizeText(nameValue);
    const level = normalizeText(levelValue);
    const rowNumber = records.length + 1;
    if (!/^\d{1,3}$/.test(number) || Number(number) < 1) {
      throw new Error(`${rowNumber}번째 학생 번호가 올바르지 않습니다.`);
    }
    if (!name || Array.from(name).length > 40 || /[\t\r\n]/.test(name)) {
      throw new Error(`${rowNumber}번째 학생 이름이 올바르지 않습니다.`);
    }
    if (!levelSet.has(level)) {
      throw new Error(`${number}번 ${name} 학생의 단계가 매우잘함·잘함·보통·노력요함 중 하나가 아닙니다.`);
    }
    if (numbers.has(number)) {
      throw new Error(`${number}번 학생이 두 번 들어 있습니다. 학급 자료를 다시 확인해 주세요.`);
    }
    const score = parseFiniteNumber(scoreValue, '교사 확정 총점', rowNumber);
    const maxScore = parseFiniteNumber(maxScoreValue, '총 배점', rowNumber);
    const percentage = parseFiniteNumber(percentageValue, '비율', rowNumber);
    if (maxScore <= 0 || score < 0 || score > maxScore || percentage < 0 || percentage > 100) {
      throw new Error(`${number}번 ${name} 학생의 점수 또는 비율 범위가 올바르지 않습니다.`);
    }
    const calculated = (score / maxScore) * 100;
    if (Math.abs(calculated - percentage) > 0.2) {
      throw new Error(`${number}번 ${name} 학생의 총점과 비율이 서로 맞지 않습니다.`);
    }
    numbers.add(number);
    records.push({
      number,
      name,
      level: level as NeisAchievementLevel,
      score,
      maxScore,
      percentage,
    });
  }
  if (records.length < 1) throw new Error('NEIS에 입력할 학생이 없습니다.');
  if (records.length > MAX_STUDENTS) {
    throw new Error(`한 번에 입력할 학생은 ${MAX_STUDENTS}명 이하여야 합니다.`);
  }
  return { course, assessment, classLabel, records };
}

export function neisAssessmentApplyExpression(input: NeisAssessmentImport): string {
  const encoded = Buffer.from(JSON.stringify(input), 'utf8').toString('base64');
  return `(()=>{
const payload=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('${encoded}'),char=>char.charCodeAt(0))));
const normalize=value=>String(value??'').replace(/[\\u200B-\\u200D\\uFEFF]/g,'').replace(/\\s+/g,' ').trim();
const compact=value=>normalize(value).replace(/\\s+/g,'');
const numberMatches=(text,number)=>new RegExp('(^|[^0-9])'+String(Number(number))+'([^0-9]|$)').test(normalize(text));
const visible=element=>{if(!element||!element.isConnected)return false;const style=getComputedStyle(element);const rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;};
const documents=[];const seenDocuments=new Set();
const collect=document=>{if(!document||seenDocuments.has(document))return;seenDocuments.add(document);documents.push(document);for(const frame of Array.from(document.querySelectorAll('iframe,frame'))){try{collect(frame.contentDocument);}catch{}}};
collect(document);
const pageText=normalize(documents.map(item=>item.body?.innerText||item.body?.textContent||'').join(' ')).slice(0,50000);
const pageReady=pageText.includes('성취기준별 평가')&&pageText.includes('단계')&&pageText.includes('평가결과');
const applyNative=()=>{
  const actions=[];const missing=[];
  for(const record of payload.records){
    const matches=[];
    for(const current of documents){
      const rows=Array.from(current.querySelectorAll('tbody>tr,[role="row"],.cl-grid-row,.grid-row')).filter(visible);
      for(const row of rows){
        const text=normalize(row.innerText||row.textContent||'');
        if(!text.includes(record.name)||!numberMatches(text,record.number))continue;
        const selects=Array.from(row.querySelectorAll('select')).filter(visible);
        for(const select of selects){
          const option=Array.from(select.options||[]).find(candidate=>compact(candidate.textContent)===compact(record.level)&&!candidate.disabled);
          if(option)matches.push({select,option,record});
        }
      }
    }
    if(matches.length!==1)missing.push(record.number);else actions.push(matches[0]);
  }
  if(missing.length||actions.length!==payload.records.length)return {status:'incomplete',matched:actions.length,updated:0,already:0,missing};
  let updated=0;let already=0;
  for(const {select,option,record} of actions){
    if(compact(select.options?.[select.selectedIndex]?.textContent)===compact(record.level)){already+=1;continue;}
    select.value=option.value;select.selectedIndex=option.index;
    select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));updated+=1;
  }
  return {status:'ok',method:'dom',matched:actions.length,updated,already,missing:[]};
};
const nativeResult=pageReady?applyNative():{status:'not-on-page',matched:0,updated:0,already:0,missing:payload.records.map(record=>record.number),detail:'성취기준별 평가 조회 화면이 아닙니다.'};if(nativeResult.status==='ok')return nativeResult;
const collectionItems=collection=>{if(!collection)return[];const items=[];const length=Math.min(Number(collection.length)||0,1000);for(let index=0;index<length;index+=1){const item=collection[index]??collection.get_item?.(index);if(item)items.push(item);}for(const id of Array.from(collection._idArray||[]).slice(0,1000)){const item=collection[id]??collection.get_item?.(id);if(item)items.push(item);}return Array.from(new Set(items));};
const findDataset=(component,id,application)=>{let current=component;for(let depth=0;current&&depth<20;depth+=1,current=current.parent){if(current[id])return current[id];if(current.form?.[id])return current.form[id];}return application?.[id]||application?.lookup?.(id)||null;};
const boundColumn=value=>{const match=/^bind:(.+)$/i.exec(normalize(value));return match?.[1]||'';};
const applyNexacroGrid=(grid,application)=>{
  const dataset=grid.getBindDataset?.()||grid._binddataset;if(!dataset||typeof dataset.getRowCount!=='function'||typeof dataset.setColumn!=='function')return null;
  const headCount=Math.min(Number(grid.getCellCount?.('head'))||0,100);const bodyCount=Math.min(Number(grid.getCellCount?.('body'))||0,100);
  const heads=Array.from({length:headCount},(_,cell)=>({cell,col:Number(grid.getCellProperty?.('head',cell,'col')),text:normalize(grid.getCellProperty?.('head',cell,'text')||grid.getCellText?.(-1,cell)||'')}));
  const bodies=Array.from({length:bodyCount},(_,cell)=>({cell,col:Number(grid.getCellProperty?.('body',cell,'col')),column:boundColumn(grid.getCellProperty?.('body',cell,'text')),comboDataset:normalize(grid.getCellProperty?.('body',cell,'combodataset')),comboCode:normalize(grid.getCellProperty?.('body',cell,'combocodecol')),comboData:normalize(grid.getCellProperty?.('body',cell,'combodatacol'))}));
  const bodyForHeader=labels=>{const head=heads.find(item=>labels.some(label=>compact(item.text).includes(compact(label))));return head?bodies.find(item=>item.col===head.col&&item.column):undefined;};
  const numberCell=bodyForHeader(['반/번호','번호']);const nameCell=bodyForHeader(['성명','이름']);const levelCell=bodyForHeader(['단계','평가단계']);
  if(!numberCell||!nameCell||!levelCell)return null;
  const actions=[];const missing=[];const rowCount=Math.min(Number(dataset.getRowCount()),500);
  for(const record of payload.records){
    const rows=[];
    for(let row=0;row<rowCount;row+=1){const numberText=normalize(dataset.getColumn(row,numberCell.column));const nameText=normalize(dataset.getColumn(row,nameCell.column));if(nameText===record.name&&numberMatches(numberText,record.number))rows.push(row);}
    if(rows.length!==1){missing.push(record.number);continue;}
    let value=record.level;
    if(levelCell.comboDataset){const combo=findDataset(grid,levelCell.comboDataset,application);if(combo&&typeof combo.getRowCount==='function'){const dataColumn=levelCell.comboData||'name';const codeColumn=levelCell.comboCode||'code';let found=false;for(let row=0;row<Math.min(Number(combo.getRowCount()),100);row+=1){if(compact(combo.getColumn(row,dataColumn))===compact(record.level)){value=combo.getColumn(row,codeColumn);found=true;break;}}if(!found){missing.push(record.number);continue;}}}
    actions.push({row:rows[0],column:levelCell.column,value,record});
  }
  if(missing.length||actions.length!==payload.records.length)return {status:'incomplete',matched:actions.length,updated:0,already:0,missing};
  let updated=0;let already=0;
  for(const action of actions){const current=dataset.getColumn(action.row,action.column);if(String(current??'')===String(action.value??'')){already+=1;continue;}if(dataset.setColumn(action.row,action.column,action.value)===false)return {status:'unsupported',matched:actions.length,updated,already,missing:[action.record.number],detail:'나이스 단계 값을 화면에 반영하지 못했습니다.'};updated+=1;}
  return {status:'ok',method:'nexacro',matched:actions.length,updated,already,missing:[]};
};
for(const current of documents){try{const view=current.defaultView;const application=view?.nexacro?.getApplication?.()||view?.application;const roots=[application?.mainframe,application?._mainframe,view?._application].filter(Boolean);const seen=new Set();const grids=[];const visit=(component,depth=0)=>{if(!component||typeof component!=='object'||depth>28||seen.has(component))return;seen.add(component);const type=normalize(component._type_name||component._classname||component.constructor?.name);if(/grid/i.test(type))grids.push(component);for(const collection of [component.components,component.frames,component.all])for(const item of collectionItems(collection))visit(item,depth+1);for(const child of [component.form,component.frame,component.mainframe,component.childframe])visit(child,depth+1);};for(const root of roots)visit(root);for(const grid of grids){const result=applyNexacroGrid(grid,application);if(result?.status==='ok')return result;}}catch{}}
if(!pageReady)return nativeResult;
return {...nativeResult,status:nativeResult.matched>0?'incomplete':'unsupported',detail:'학생 번호·이름과 단계 입력칸을 안전하게 연결하지 못했습니다.'};
})()`;
}

export function readNeisAssessmentApplyResult(value: unknown): NeisAssessmentApplyResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NEIS 교과평가 입력 결과를 확인하지 못했습니다.');
  }
  const result = value as Record<string, unknown>;
  if (!['ok', 'not-on-page', 'incomplete', 'unsupported'].includes(String(result.status))) {
    throw new Error('NEIS 교과평가 입력 상태가 올바르지 않습니다.');
  }
  const matched = Number(result.matched);
  const updated = Number(result.updated);
  const already = Number(result.already);
  const missing = Array.isArray(result.missing)
    ? result.missing.filter((item): item is string => typeof item === 'string').slice(0, MAX_STUDENTS)
    : [];
  if (![matched, updated, already].every((number) => Number.isSafeInteger(number) && number >= 0)) {
    throw new Error('NEIS 교과평가 입력 건수를 확인하지 못했습니다.');
  }
  return {
    status: result.status as NeisAssessmentApplyResult['status'],
    ...(result.method === 'dom' || result.method === 'nexacro' ? { method: result.method } : {}),
    matched,
    updated,
    already,
    missing,
    ...(typeof result.detail === 'string' ? { detail: normalizeText(result.detail).slice(0, 200) } : {}),
  };
}
