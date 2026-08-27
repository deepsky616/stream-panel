import type { WebWorkflowSystem } from '../../../shared/types';

export interface PortalApprovalSummary {
  neis: number;
  edufine: number;
}

interface PortalApprovalCandidate {
  system: WebWorkflowSystem;
  value: number;
  panelLabel: string;
  itemLabel: string;
  relation: 'combined' | 'right-adjacent';
  controlContext: string;
}

const PANEL_LABELS: Record<WebWorkflowSystem, readonly string[]> = {
  neis: ['승인사항'],
  edufine: ['전자결재 현황', '전자결재현황'],
};

const ITEM_LABELS: Record<WebWorkflowSystem, readonly string[]> = {
  neis: ['미결/협조함', '미결 / 협조함'],
  edufine: ['결재(긴급)', '결재 (긴급)'],
};

const PAGE_CONTROL_PATTERN = /(?:페이지|쪽)\s*(?:크기|번호|당|수|개수|이동|선택|표시\s*건수)|(?:한\s*)?페이지\s*당|총\s*\d+\s*(?:페이지|쪽)|\d+\s*\/\s*\d+\s*(?:페이지|쪽)?|page(?:\s*|[-_:])?(?:size|number|no|num|index|idx|count|total|limit|unit|rows?|nav(?:igation)?|button)|(?:rows?|records?|items?)(?:\s*|[-_:])?per(?:\s*|[-_:])?page|per(?:\s*|[-_:])?page|pagination|pager|paging|pagenation|pageable/i;

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function readCandidate(value: unknown): PortalApprovalCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.system !== 'neis' && candidate.system !== 'edufine') return null;
  if (!Number.isSafeInteger(candidate.value) || Number(candidate.value) < 0 || Number(candidate.value) > 9_999) {
    return null;
  }
  if (candidate.relation !== 'combined' && candidate.relation !== 'right-adjacent') return null;
  const panelLabel = normalize(candidate.panelLabel);
  const itemLabel = normalize(candidate.itemLabel);
  const controlContext = normalize(candidate.controlContext);
  if (!PANEL_LABELS[candidate.system].includes(panelLabel)) return null;
  if (!ITEM_LABELS[candidate.system].includes(itemLabel)) return null;
  if (PAGE_CONTROL_PATTERN.test(controlContext)) return null;
  return {
    system: candidate.system,
    value: Number(candidate.value),
    panelLabel,
    itemLabel,
    relation: candidate.relation,
    controlContext,
  };
}

export function parsePortalApprovalCount(
  values: readonly unknown[],
  system: WebWorkflowSystem,
): number {
  const counts = new Set<number>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const candidates = (value as Record<string, unknown>).candidates;
    if (!Array.isArray(candidates)) continue;
    for (const rawCandidate of candidates) {
      const candidate = readCandidate(rawCandidate);
      if (candidate?.system === system) counts.add(candidate.value);
    }
  }
  if (counts.size === 0) {
    const label = system === 'neis' ? '승인사항의 미결/협조함' : '전자결재 현황의 결재(긴급)';
    throw new Error(`업무포털 ${label} 바로 오른쪽 숫자를 찾지 못했습니다.`);
  }
  if (counts.size > 1) {
    const label = system === 'neis' ? '미결/협조함' : '결재(긴급)';
    throw new Error(`업무포털 ${label} 옆에서 서로 다른 숫자가 발견되어 안전하게 확인하지 못했습니다.`);
  }
  return [...counts][0];
}

export const PORTAL_APPROVAL_SUMMARY_EXPRESSION = `(()=>{
const normalize=(value)=>String(value??'').replace(/\\s+/g,' ').trim();
const visible=(element)=>{
  if(!element||typeof element.getBoundingClientRect!=='function')return false;
  const rect=element.getBoundingClientRect();
  const style=element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  return rect.width>0&&rect.height>0&&style?.display!=='none'&&style?.visibility!=='hidden'&&Number(style?.opacity??1)>0;
};
const surfaceTexts=(element)=>[
  element?.innerText,
  element?.textContent,
  element?.getAttribute?.('aria-label'),
  element?.getAttribute?.('title'),
].map(normalize).filter(Boolean);
const exact=(element,labels)=>surfaceTexts(element).some((text)=>labels.includes(text));
const pageControl=/(?:페이지|쪽)\\s*(?:크기|번호|당|수|개수|이동|선택|표시\\s*건수)|(?:한\\s*)?페이지\\s*당|총\\s*\\d+\\s*(?:페이지|쪽)|\\d+\\s*\\/\\s*\\d+\\s*(?:페이지|쪽)?|page(?:\\s*|[-_:])?(?:size|number|no|num|index|idx|count|total|limit|unit|rows?|nav(?:igation)?|button)|(?:rows?|records?|items?)(?:\\s*|[-_:])?per(?:\\s*|[-_:])?page|per(?:\\s*|[-_:])?page|pagination|pager|paging|pagenation|pageable/i;
const pageControlElement=(element)=>{
  for(let current=element,depth=0;current&&depth<6;current=current.parentElement,depth+=1){
    const tag=normalize(current.tagName).toLowerCase();
    const role=normalize(current.getAttribute?.('role')).toLowerCase();
    const ariaCurrent=normalize(current.getAttribute?.('aria-current')).toLowerCase();
    const rel=normalize(current.getAttribute?.('rel')).toLowerCase();
    if(['select','option'].includes(tag)||['option','combobox','spinbutton','navigation'].includes(role)||ariaCurrent==='page'||['next','prev','previous'].includes(rel))return true;
    const identity=normalize([
      current.id,current.className,role,current.getAttribute?.('name'),current.getAttribute?.('aria-label'),
      current.getAttribute?.('title'),current.getAttribute?.('data-page'),current.getAttribute?.('data-page-size'),
      ...(depth<2?surfaceTexts(current).slice(0,3):[]),
    ].filter(Boolean).join(' ')).slice(0,900);
    if(pageControl.test(identity))return true;
  }
  return false;
};
const definitions=[
  {system:'neis',panels:['승인사항'],items:['미결/협조함','미결 / 협조함'],combined:/^미결\\s*\\/\\s*협조함\\s*[\\(\\[]?\\s*(\\d{1,4})\\s*(?:건)?\\s*[\\)\\]]?$/},
  {system:'edufine',panels:['전자결재 현황','전자결재현황'],items:['결재(긴급)','결재 (긴급)'],combined:/^결재\\s*\\(\\s*긴급\\s*\\)\\s*[\\(\\[]?\\s*(\\d{1,4})\\s*(?:건)?\\s*[\\)\\]]?$/},
];
const elements=Array.from(document.querySelectorAll('*')).filter(visible);
const candidates=[];
const contextOf=(element)=>{
  const values=[];
  for(let current=element,depth=0;current&&depth<4;current=current.parentElement,depth+=1){
    values.push(current.id,current.className,current.getAttribute?.('role'),current.getAttribute?.('aria-label'),current.getAttribute?.('title'));
    if(depth<2)values.push(current.innerText);
  }
  return normalize(values.filter(Boolean).join(' ')).slice(0,600);
};
const panelScope=(item,labels)=>{
  for(let current=item.parentElement,depth=0;current&&depth<10;current=current.parentElement,depth+=1){
    if(current===document.body||current===document.documentElement)break;
    const descendants=[current,...Array.from(current.querySelectorAll('*'))];
    if(descendants.some((element)=>visible(element)&&exact(element,labels)))return current;
  }
  return null;
};
for(const definition of definitions){
  const combinedElements=elements
    .map((element)=>({element,match:surfaceTexts(element).map((text)=>text.match(definition.combined)).find(Boolean)}))
    .filter((entry)=>entry.match)
    .sort((left,right)=>left.element.children.length-right.element.children.length);
  for(const {element,match} of combinedElements){
    const scope=panelScope(element,definition.panels);
    if(!scope||!match||pageControlElement(element)||pageControl.test(contextOf(element)))continue;
    const panel=definition.panels.find((label)=>[
      scope,...Array.from(scope.querySelectorAll('*')),
    ].some((candidate)=>visible(candidate)&&exact(candidate,[label])));
    if(!panel)continue;
    candidates.push({system:definition.system,value:Number(match[1]),panelLabel:panel,itemLabel:definition.items[0],relation:'combined',controlContext:contextOf(element)});
  }
  const itemElements=elements
    .filter((element)=>exact(element,definition.items))
    .sort((left,right)=>left.children.length-right.children.length);
  for(const item of itemElements){
    const scope=panelScope(item,definition.panels);
    if(!scope)continue;
    const panel=definition.panels.find((label)=>[
      scope,...Array.from(scope.querySelectorAll('*')),
    ].some((element)=>visible(element)&&exact(element,[label])));
    if(!panel)continue;
    const itemLabel=definition.items.find((label)=>exact(item,[label]));
    if(!itemLabel)continue;
    const itemRect=item.getBoundingClientRect();
    const numeric=[];
    for(const element of [scope,...Array.from(scope.querySelectorAll('*'))]){
      if(element===item||!visible(element))continue;
      if(pageControlElement(element))continue;
      const tag=String(element.tagName||'').toLowerCase();
      const role=normalize(element.getAttribute?.('role')).toLowerCase();
      if(['select','option','input'].includes(tag)||['combobox','spinbutton'].includes(role))continue;
      const texts=surfaceTexts(element);
      let value=null;
      for(const text of texts){
        const match=text.match(/^[\\(\\[]?\\s*(\\d{1,4})\\s*(?:건)?\\s*[\\)\\]]?$/);
        if(match){value=Number(match[1]);break;}
      }
      if(value===null||!Number.isSafeInteger(value)||value<0||value>9999)continue;
      const controlContext=contextOf(element);
      if(pageControl.test(controlContext))continue;
      const rect=element.getBoundingClientRect();
      const vertical=Math.abs((rect.top+rect.bottom)/2-(itemRect.top+itemRect.bottom)/2);
      const horizontal=rect.left-itemRect.right;
      if(vertical>Math.max(28,itemRect.height)||horizontal< -8||horizontal>360)continue;
      numeric.push({element,value,distance:Math.max(0,horizontal)+vertical*3,controlContext});
    }
    numeric.sort((left,right)=>left.distance-right.distance||left.element.children.length-right.element.children.length);
    if(numeric[0]){
      candidates.push({system:definition.system,value:numeric[0].value,panelLabel:panel,itemLabel,relation:'right-adjacent',controlContext:numeric[0].controlContext});
    }
  }
}
return {candidates:candidates.slice(0,20)};
})()`;
