import type { WebWorkflowSystem } from '../../../shared/types';

interface SystemApprovalCandidate {
  system: WebWorkflowSystem;
  value: number;
  itemLabel: string;
  relation: 'inline' | 'same-control' | 'row' | 'sibling' | 'nexacro' | 'dataset';
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
  if (!['inline', 'same-control', 'row', 'sibling', 'nexacro', 'dataset'].includes(String(candidate.relation))) {
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
  const discovered: SystemApprovalCandidate[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const rawCandidates = (value as Record<string, unknown>).candidates;
    if (!Array.isArray(rawCandidates)) continue;
    for (const rawCandidate of rawCandidates) {
      const candidate = readCandidate(rawCandidate);
      if (candidate?.system === system) discovered.push(candidate);
    }
  }
  // Edufine pages contain many neighboring numeric controls. Only an exact
  // inline/control, Nexacro component, or label-anchored Dataset signal may
  // bypass the authoritative approval-list fallback.
  const candidates = system === 'edufine'
    ? discovered.filter(({ confidence }) => confidence >= 90)
    : discovered;
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
  {system:'edufine',items:['결재(긴급)','결재 (긴급)'],combined:/^결재\\s*\\(\\s*긴급\\s*\\)\\s*(\\d{1,4})(?:\\s*\\(\\s*\\d{1,4}\\s*\\))?\\s*(?:건)?$/},
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
const approvalValue=(element,definition)=>{
  const numeric=numericValue(element);
  if(numeric!==null)return numeric;
  if(definition.system!=='edufine')return null;
  for(const text of surfaceTexts(element)){
    // K-Edufine displays the total first and the urgent subset in parentheses,
    // for example 2(0). The pending count is 2, never 20 or 0.
    const match=text.match(/^(\\d{1,4})\\s*\\(\\s*\\d{1,4}\\s*\\)\\s*(?:건)?$/);
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
const identityOf=(element)=>normalize([
  element?.id,element?.className,element?.getAttribute?.('role'),
  element?.getAttribute?.('aria-label'),element?.getAttribute?.('title'),
  element?.parentElement?.id,element?.parentElement?.className,
  element?.parentElement?.getAttribute?.('role'),
].filter(Boolean).join(' ')).slice(0,350);
const candidates=[];
const add=(definition,value,itemLabel,relation,confidence,element,context)=>{
  if(!Number.isSafeInteger(value)||value<0||value>9999)return;
  const controlContext=normalize(context||contextOf(element));
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
    const ownValue=approvalValue(element,definition);
    if(ownValue!==null)add(definition,ownValue,itemLabel,'same-control',99,element);
    for(const descendant of elementsIn(element).filter(visible).slice(0,100)){
      const value=approvalValue(descendant,definition);
      if(value!==null)add(definition,value,itemLabel,'same-control',94,descendant);
    }
    // NEIS renders the approval summary as a two-column row: the item label is
    // on the left and its plain, unlabelled number is on the right. Anchor the
    // number to the exact horizontal row instead of accepting another number
    // from the surrounding dashboard or a paging control.
    const labelRect=element.getBoundingClientRect();
    const labelCenter=labelRect.top+labelRect.height/2;
    const rowNumbers=elements.map((numberElement)=>{
      if(numberElement===element||element.contains?.(numberElement))return null;
      const value=approvalValue(numberElement,definition);
      if(value===null)return null;
      const rect=numberElement.getBoundingClientRect();
      const center=rect.top+rect.height/2;
      const overlap=Math.min(labelRect.bottom,rect.bottom)-Math.max(labelRect.top,rect.top);
      const sameLine=overlap>0||Math.abs(center-labelCenter)<=Math.max(6,Math.min(labelRect.height,rect.height)/2);
      if(!sameLine||rect.left<labelRect.right-3)return null;
      return {element:numberElement,value,distance:Math.max(0,rect.left-labelRect.right)+Math.abs(center-labelCenter)*4};
    }).filter(Boolean).sort((left,right)=>left.distance-right.distance);
    if(rowNumbers.length>0){
      const nearestDistance=rowNumbers[0].distance;
      for(const rowNumber of rowNumbers.filter(({distance})=>distance<=nearestDistance+4)){
        add(
          definition,
          rowNumber.value,
          itemLabel,
          'row',
          99,
          rowNumber.element,
          ['approval-summary-row',itemLabel,identityOf(element),identityOf(rowNumber.element)].join(' '),
        );
      }
    }
    for(let current=element,depth=0;current&&depth<3;current=current.parentElement,depth+=1){
      for(const sibling of [current.nextElementSibling,current.previousElementSibling]){
        if(!visible(sibling))continue;
        const value=approvalValue(sibling,definition);
        if(value!==null)add(definition,value,itemLabel,'sibling',88-depth*4,sibling);
      }
      const children=Array.from(current.parentElement?.children||[]).filter((child)=>child!==current&&visible(child));
      for(const sibling of children.slice(0,24)){
        const value=approvalValue(sibling,definition);
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
    const seenDatasets=new Set();
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
        if(definition.system==='edufine'){
          const badge=text.match(/^(\\d{1,4})\\s*\\(\\s*\\d{1,4}\\s*\\)\\s*(?:건)?$/);
          if(badge)return Number(badge[1]);
        }
      }
      return null;
    };
    const componentBox=(component)=>{
      const numberFrom=(...values)=>{
        for(const value of values){
          const number=Number(typeof value==='function'?value.call(component):value);
          if(Number.isFinite(number))return number;
        }
        return 0;
      };
      const left=numberFrom(component?.getOffsetLeft,component?.get_left,component?.left,component?._adjust_left);
      const top=numberFrom(component?.getOffsetTop,component?.get_top,component?.top,component?._adjust_top);
      const width=Math.max(0,numberFrom(component?.getOffsetWidth,component?.get_width,component?.width,component?._adjust_width));
      const height=Math.max(0,numberFrom(component?.getOffsetHeight,component?.get_height,component?.height,component?._adjust_height));
      return {left,top,width,height,right:left+width,bottom:top+height};
    };
    const resolveDataset=(component,reference)=>{
      if(reference&&typeof reference==='object'&&typeof reference.getRowCount==='function'&&typeof reference.getColumn==='function')return reference;
      if(typeof reference!=='string'||!reference)return null;
      for(const owner of [component,component?.parent,component?._parent,component?.form,component?.parent?.form]){
        try{
          const found=owner?._findDataset?.(reference)||owner?.lookup?.(reference)||owner?.[reference];
          if(found&&typeof found.getRowCount==='function'&&typeof found.getColumn==='function')return found;
        }catch{}
      }
      return null;
    };
    const inspectDataset=(dataset,owner)=>{
      if(!dataset||seenDatasets.has(dataset)||typeof dataset.getRowCount!=='function'||typeof dataset.getColumn!=='function')return;
      seenDatasets.add(dataset);
      const rowCount=Math.min(Math.max(Number(dataset.getRowCount?.())||0,0),200);
      const columnCount=Math.min(Math.max(Number(dataset.getColCount?.())||0,0),80);
      if(rowCount===0||columnCount===0)return;
      const columns=Array.from({length:columnCount},(_,index)=>{
        let info;
        try{info=dataset.getColumnInfo?.(index);}catch{}
        const id=normalize(info?.id||info?.name||index);
        return {index,id};
      });
      for(let row=0;row<rowCount;row+=1){
        const cells=columns.map((column)=>{
          let raw;
          try{raw=dataset.getColumn(row,column.id||column.index);}catch{}
          return {...column,raw,text:normalize(raw)};
        });
        const itemLabel=definition.items.find((label)=>cells.some(({text})=>compact(text)===compact(label)));
        if(!itemLabel)continue;
        const numericCells=cells.map((cell)=>({
          ...cell,
          countMatch:cell.text.match(definition.system==='edufine'
            ? /^(\\d{1,4})(?:\\s*\\(\\s*\\d{1,4}\\s*\\))?$/
            : /^(\\d{1,4})$/),
        })).filter(({countMatch})=>countMatch).map((cell)=>({
          ...cell,
          value:Number(cell.countMatch[1]),
          countColumn:/(?:^|_)(?:cnt|count|total|num|number)(?:$|_)|건수|결재.*수|approval.*(?:cnt|count)|urgent.*(?:cnt|count)/i.test(cell.id),
        })).filter(({id})=>!pageControl.test(id));
        const preferred=numericCells.filter(({countColumn})=>countColumn);
        const selected=preferred.length>0?preferred:(numericCells.length===1?numericCells:[]);
        for(const cell of selected){
          const controlContext=normalize([
            'dataset',dataset.id,dataset.name,cell.id,itemLabel,owner?.id,owner?.name,
          ].filter(Boolean).join(' ')).slice(0,700);
          if(pageControl.test(controlContext))continue;
          candidates.push({
            system:definition.system,
            value:cell.value,
            itemLabel,
            relation:'dataset',
            confidence:cell.countColumn?97:90,
            controlContext,
          });
        }
      }
    };
    const visit=(component,depth=0)=>{
      if(!component||typeof component!=='object'||depth>24||seen.has(component))return;
      seen.add(component);
      if(component.visible===false||(typeof component._isVisible==='function'&&component._isVisible()===false))return;
      inspectDataset(component,component);
      const datasetReferences=[component._binddataset,component.binddataset,component._innerdataset,component.innerdataset];
      for(const getter of ['getBindDataset','getInnerDataset']){
        try{datasetReferences.push(component[getter]?.());}catch{}
      }
      for(const reference of datasetReferences){
        inspectDataset(resolveDataset(component,reference),component);
      }
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
          const labelBox=componentBox(component);
          const numberBox=componentBox(relatedComponent);
          const sameParent=(component.parent||component._parent)===(relatedComponent.parent||relatedComponent._parent);
          const overlap=Math.min(labelBox.bottom,numberBox.bottom)-Math.max(labelBox.top,numberBox.top);
          const exactRow=sameParent&&numberBox.left>=labelBox.right-3&&(overlap>0||Math.abs((labelBox.top+labelBox.height/2)-(numberBox.top+numberBox.height/2))<=6);
          if(!pageControl.test(controlContext))candidates.push({system:definition.system,value,itemLabel,relation:'nexacro',confidence:exactRow?99:92,controlContext});
        }
      }
      for(const collection of [component.components,component.frames,component.all,component.objects,component.datasets]){
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
