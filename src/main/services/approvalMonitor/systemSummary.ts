import type { WebWorkflowSystem } from '../../../shared/types';

interface SystemApprovalCandidate {
  system: WebWorkflowSystem;
  value: number;
  itemLabel: string;
  relation: 'inline' | 'same-control' | 'sibling' | 'nexacro';
  confidence: number;
  controlContext: string;
}

const ITEM_LABELS: Record<WebWorkflowSystem, readonly string[]> = {
  neis: ['미결/협조함', '미결 / 협조함'],
  edufine: ['결재(긴급)', '결재 (긴급)'],
};

const PAGE_CONTROL_PATTERN = /페이지\s*(?:크기|번호|당)|페이지당|쪽\s*번호|page\s*(?:size|number)|rows?\s*per\s*page|pagination|pager|paging/i;

function normalize(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function readCandidate(value: unknown): SystemApprovalCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.system !== 'neis' && candidate.system !== 'edufine') return null;
  if (!Number.isSafeInteger(candidate.value) || Number(candidate.value) < 0 || Number(candidate.value) > 9_999) {
    return null;
  }
  if (!['inline', 'same-control', 'sibling', 'nexacro'].includes(String(candidate.relation))) {
    return null;
  }
  if (
    !Number.isSafeInteger(candidate.confidence) ||
    Number(candidate.confidence) < 1 ||
    Number(candidate.confidence) > 100
  ) return null;
  const itemLabel = normalize(candidate.itemLabel);
  const controlContext = normalize(candidate.controlContext);
  if (!ITEM_LABELS[candidate.system].includes(itemLabel)) return null;
  if (PAGE_CONTROL_PATTERN.test(controlContext)) return null;
  return {
    system: candidate.system,
    value: Number(candidate.value),
    itemLabel,
    relation: candidate.relation as SystemApprovalCandidate['relation'],
    confidence: Number(candidate.confidence),
    controlContext,
  };
}

export function parseSystemApprovalCount(
  values: readonly unknown[],
  system: WebWorkflowSystem,
): number {
  const candidates: SystemApprovalCandidate[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rawCandidates = (value as Record<string, unknown>).candidates;
    if (!Array.isArray(rawCandidates)) continue;
    for (const rawCandidate of rawCandidates) {
      const candidate = readCandidate(rawCandidate);
      if (candidate?.system === system) candidates.push(candidate);
    }
  }
  if (candidates.length === 0) {
    const label = system === 'neis' ? '미결/협조함' : '결재(긴급)';
    throw new Error(`${system === 'neis' ? '나이스' : 'K-에듀파인'} 탭에서 ${label}의 전역 건수를 찾지 못했습니다.`);
  }
  const highestConfidence = Math.max(...candidates.map(({ confidence }) => confidence));
  const counts = new Set(candidates
    .filter(({ confidence }) => confidence === highestConfidence)
    .map(({ value }) => value));
  if (counts.size > 1) {
    const label = system === 'neis' ? '미결/협조함' : '결재(긴급)';
    throw new Error(`${system === 'neis' ? '나이스' : 'K-에듀파인'} ${label}에서 서로 다른 전역 건수가 발견되었습니다.`);
  }
  return [...counts][0];
}

export const SYSTEM_APPROVAL_SUMMARY_EXPRESSION = `(()=>{
const normalize=(value)=>String(value??'').replace(/\\s+/g,' ').trim();
const compact=(value)=>normalize(value).replace(/\\s+/g,'');
const pageControl=/페이지\\s*(?:크기|번호|당)|페이지당|쪽\\s*번호|page\\s*(?:size|number)|rows?\\s*per\\s*page|pagination|pager|paging/i;
const definitions=[
  {system:'neis',items:['미결/협조함','미결 / 협조함'],combined:/^미결\\s*\\/\\s*협조함\\s*[\\(\\[]?\\s*(\\d{1,4})\\s*(?:건)?\\s*[\\)\\]]?$/},
  {system:'edufine',items:['결재(긴급)','결재 (긴급)'],combined:/^결재\\s*\\(\\s*긴급\\s*\\)\\s*[\\(\\[]?\\s*(\\d{1,4})\\s*(?:건)?\\s*[\\)\\]]?$/},
];
const visible=(element)=>{
  if(!element||element.hidden||element.getAttribute?.('aria-hidden')==='true'||typeof element.getBoundingClientRect!=='function')return false;
  const style=element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  const rect=element.getBoundingClientRect();
  return rect.width>0&&rect.height>0&&style?.display!=='none'&&style?.visibility!=='hidden'&&Number(style?.opacity??1)>0;
};
const pseudoText=(element,pseudo)=>{
  try{
    const raw=normalize(element?.ownerDocument?.defaultView?.getComputedStyle?.(element,pseudo)?.content);
    if(!raw||raw==='none'||raw==='normal')return '';
    return raw.replace(/^["']|["']$/g,'');
  }catch{return '';}
};
const surfaceTexts=(element)=>Array.from(new Set([
  element?.innerText,
  element?.textContent,
  element?.getAttribute?.('aria-label'),
  element?.getAttribute?.('title'),
  element?.getAttribute?.('data-count'),
  element?.getAttribute?.('data-value'),
  element?.getAttribute?.('value'),
  pseudoText(element,'::before'),
  pseudoText(element,'::after'),
].map(normalize).filter(Boolean)));
const elementsIn=(root)=>{
  const result=[];
  const visit=(scope)=>{
    for(const element of Array.from(scope?.querySelectorAll?.('*')||[])){
      result.push(element);
      if(element.shadowRoot)visit(element.shadowRoot);
    }
  };
  visit(root);
  return result;
};
const contexts=[];
const visitedViews=new Set();
const visitView=(view)=>{
  if(!view||visitedViews.has(view))return;
  visitedViews.add(view);
  try{
    const frameDocument=view.document;
    contexts.push({view,document:frameDocument});
    for(const frame of Array.from(frameDocument.querySelectorAll('iframe,frame'))){
      try{visitView(frame.contentWindow);}catch{}
    }
  }catch{}
};
visitView(window);
const elements=contexts.flatMap(({document})=>elementsIn(document)).filter(visible);
const numericValue=(element)=>{
  for(const text of surfaceTexts(element)){
    const match=text.match(/^[\\(\\[]?\\s*(\\d{1,4})\\s*(?:건)?\\s*[\\)\\]]?$/);
    if(match)return Number(match[1]);
  }
  return null;
};
const contextOf=(element)=>{
  const values=[];
  for(let current=element,depth=0;current&&depth<4;current=current.parentElement,depth+=1){
    values.push(current.id,current.className,current.getAttribute?.('role'),current.getAttribute?.('aria-label'),current.getAttribute?.('title'));
    if(depth<2)values.push(current.innerText);
  }
  return normalize(values.filter(Boolean).join(' ')).slice(0,700);
};
const candidates=[];
const add=(definition,value,itemLabel,relation,confidence,element)=>{
  if(!Number.isSafeInteger(value)||value<0||value>9999)return;
  const controlContext=contextOf(element);
  if(pageControl.test(controlContext))return;
  candidates.push({system:definition.system,value,itemLabel,relation,confidence,controlContext});
};
for(const definition of definitions){
  for(const element of elements){
    const texts=surfaceTexts(element);
    for(const text of texts){
      const match=text.match(definition.combined);
      if(match)add(definition,Number(match[1]),definition.items[0],'inline',100,element);
    }
    const itemLabel=definition.items.find((label)=>texts.some((text)=>compact(text)===compact(label)));
    if(!itemLabel)continue;
    for(const attribute of ['data-count','data-value','value']){
      const raw=normalize(element.getAttribute?.(attribute));
      const match=raw.match(/^(\\d{1,4})$/);
      if(match)add(definition,Number(match[1]),itemLabel,'same-control',98,element);
    }
    for(const descendant of elementsIn(element).filter(visible).slice(0,100)){
      const value=numericValue(descendant);
      if(value!==null)add(definition,value,itemLabel,'same-control',94,descendant);
    }
    for(let current=element,depth=0;current&&depth<3;current=current.parentElement,depth+=1){
      for(const sibling of [current.nextElementSibling,current.previousElementSibling]){
        if(!visible(sibling))continue;
        const value=numericValue(sibling);
        if(value!==null)add(definition,value,itemLabel,'sibling',88-depth*4,sibling);
      }
      const children=Array.from(current.parentElement?.children||[]).filter((child)=>child!==current&&visible(child));
      for(const sibling of children.slice(0,24)){
        const value=numericValue(sibling);
        if(value!==null)add(definition,value,itemLabel,'sibling',80-depth*4,sibling);
      }
    }
  }
  for(const context of contexts){
   try{
    const view=context.view;
    const application=view?.nexacro?.getApplication?.();
    const roots=[application?.mainframe,application?._mainframe,view?._application].filter(Boolean);
    const seen=new Set();
    const collectionItems=(collection)=>{
      if(!collection)return [];
      const items=[];
      const length=Math.min(Number(collection.length)||0,500);
      for(let index=0;index<length;index+=1){
        const item=collection[index]??collection.get_item?.(index);
        if(item)items.push(item);
      }
      for(const id of Array.from(collection._idArray||[]).slice(0,500)){
        const item=collection[id]??collection.get_item?.(id);
        if(item)items.push(item);
      }
      return Array.from(new Set(items));
    };
    const componentTexts=(component)=>Array.from(new Set([
      component?.text,component?.value,component?.displaytext,component?.tooltiptext,
      component?.accessibilitylabel,component?.name,component?.id,
    ].map(normalize).filter(Boolean)));
    const componentNumber=(component)=>{
      for(const text of componentTexts(component)){
        const match=text.match(/^[\\(\\[]?\\s*(\\d{1,4})\\s*(?:건)?\\s*[\\)\\]]?$/);
        if(match)return Number(match[1]);
      }
      return null;
    };
    const visit=(component,depth=0)=>{
      if(!component||typeof component!=='object'||depth>24||seen.has(component))return;
      seen.add(component);
      if(component.visible===false||(typeof component._isVisible==='function'&&component._isVisible()===false))return;
      const texts=componentTexts(component);
      for(const text of texts){
        const match=text.match(definition.combined);
        if(match)candidates.push({system:definition.system,value:Number(match[1]),itemLabel:definition.items[0],relation:'nexacro',confidence:100,controlContext:normalize(text+' '+component?.id+' '+component?.name).slice(0,700)});
      }
      const itemLabel=definition.items.find((label)=>texts.some((text)=>compact(text)===compact(label)));
      if(itemLabel){
        const related=[];
        for(const collection of [component.components,component.parent?.components,component._parent?.components])related.push(...collectionItems(collection));
        for(const relatedComponent of Array.from(new Set(related)).slice(0,100)){
          if(relatedComponent===component)continue;
          const value=componentNumber(relatedComponent);
          if(value===null)continue;
          const controlContext=normalize(componentTexts(relatedComponent).join(' ')+' '+relatedComponent?.id+' '+relatedComponent?.name).slice(0,700);
          if(!pageControl.test(controlContext))candidates.push({system:definition.system,value,itemLabel,relation:'nexacro',confidence:92,controlContext});
        }
      }
      for(const collection of [component.components,component.frames,component.all]){
        for(const item of collectionItems(collection))visit(item,depth+1);
      }
      for(const child of [component.form,component.frame,component.mainframe,component.childframe])visit(child,depth+1);
    };
    for(const root of roots)visit(root);
   }catch{}
  }
}
return {candidates:candidates.slice(0,100)};
})()`;
