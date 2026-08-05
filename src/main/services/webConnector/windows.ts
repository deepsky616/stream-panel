import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { win32 } from 'node:path';
import { getEducationOffice, isAllowedOfficeHost } from '../../../shared/educationOffices';
import type {
  BuiltInWebWorkflowId,
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebWorkflowId,
  WebWorkflowSpec,
  WebWorkflowSystem,
} from '../../../shared/types';
import {
  getWebWorkflowTarget,
  getWebWorkflowTargetForSpec,
  isAllowedWebWorkflowTarget,
  isAllowedWebWorkflowSpecTarget,
  isWebWorkflowSpec,
} from '../../../shared/webWorkflows';
import type { ManagedBrowserConnection } from './cdp/transport';
import {
  connectManagedBrowser,
  type ManagedBrowserConnectOptions,
} from './cdp/transport';
import {
  APPROVED_NON_ACTION_LABELS,
  createCustomManagedWorkflowDefinition,
  FORBIDDEN_ACTION_TOKENS,
  selectSafeCandidate,
  type CandidateSummary,
  type ManagedWorkflowDefinition,
  type WorkflowStep,
} from './workflows/common';
import { runWorkflow, type WorkflowPageAdapter, type WorkflowRunResult } from './workflows/engine';
import { EDUFINE_WORKFLOWS } from './workflows/edufine';
import { NEIS_WORKFLOWS } from './workflows/neis';
import {
  ManagedBrowserSessionManager,
  type ManagedBrowserSession,
  type ManagedWorkflowRequest,
} from './sessionManager';
import {
  parseApprovalCounterCandidates,
  scanWindowsApprovalCount,
  type WindowsApprovalPage,
} from '../approvalMonitor/windows';
import {
  APPROVAL_INBOX_WORKFLOWS,
  type ApprovalScanInput,
} from '../approvalMonitor/definitions';

export interface ResolveWindowsManagedBrowserOptions {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

export interface WindowsTargetInfo {
  targetId: string;
  type: string;
  url: string;
  title?: string;
}

export type WindowsWorkflowExecutionState =
  | 'IDLE'
  | 'RESTORING_WINDOW'
  | 'ACQUIRING_TARGET'
  | 'CHECKING_AUTH'
  | 'ENTERING_NEIS_SSO'
  | 'WAITING_FOR_USER'
  | 'WAITING_FOR_NEIS'
  | 'NAVIGATING_DUTY_MENU'
  | 'COMPLETED'
  | 'FAILED';

export interface WindowsManagedBrowserSession extends ManagedBrowserSession {
  readonly connection: ManagedBrowserConnection;
  bootstrapTargetId?: string;
  workflowState: WindowsWorkflowExecutionState;
}

export interface CreateWindowsManagedBrowserSessionOptions {
  userDataPath: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  makeDirectory?: (
    path: string,
    options: { recursive: true; mode: number },
  ) => Promise<unknown>;
  connectBrowser?: (
    options: ManagedBrowserConnectOptions,
  ) => Promise<ManagedBrowserConnection>;
}

export interface WxsClientWindow {
  id: number;
  title: string;
}

export interface WindowsWorkflowPage extends WorkflowPageAdapter {
  currentOrigin(): Promise<string>;
  activate(): Promise<void>;
  release?(): Promise<void>;
  readApprovalCount?(system: WebWorkflowSystem): Promise<number>;
}

export interface ExecuteWindowsWorkflowDependencies {
  openWorkflowPage(
    session: ManagedBrowserSession,
    workflowId: WebWorkflowId,
    workflowSpec?: WebWorkflowSpec,
  ): Promise<WindowsWorkflowPage>;
  isWxsClientRegistered(): Promise<boolean>;
  listWxsClientWindows(): Promise<readonly WxsClientWindow[]>;
  focusWindow(id: number): Promise<boolean>;
}

const MANAGED_WORKFLOWS: Partial<Record<BuiltInWebWorkflowId, ManagedWorkflowDefinition>> = {
  ...NEIS_WORKFLOWS,
  ...EDUFINE_WORKFLOWS,
  'neis-approval-inbox': APPROVAL_INBOX_WORKFLOWS.neis,
  'edufine-approval-inbox': APPROVAL_INBOX_WORKFLOWS.edufine,
};

function setWorkflowState(
  session: ManagedBrowserSession,
  state: WindowsWorkflowExecutionState,
): void {
  if ('connection' in session && 'workflowState' in session) {
    (session as WindowsManagedBrowserSession).workflowState = state;
  }
}

function managedWorkflowDefinition(request: ManagedWorkflowRequest) {
  if (request.workflowId === 'custom') {
    if (!isWebWorkflowSpec(request.workflowSpec) || request.workflowSpec.id !== 'custom') {
      throw new Error('사용자 지정 웹 업무 설정이 올바르지 않습니다. 편집기에서 키를 다시 만들어 주세요.');
    }
    return createCustomManagedWorkflowDefinition(request.workflowSpec);
  }
  const definition = MANAGED_WORKFLOWS[request.workflowId];
  if (!definition) {
    throw new Error('웹 업무 이동 경로가 준비되지 않았습니다. 스트림 패널을 업데이트한 뒤 다시 시도해 주세요.');
  }
  return definition;
}

function requestWorkflowSpec(
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
): WebWorkflowSpec | null {
  if (workflowId === 'custom') {
    return isWebWorkflowSpec(workflowSpec) && workflowSpec.id === 'custom'
      ? workflowSpec
      : null;
  }
  return { id: workflowId, browserId: workflowSpec?.browserId ?? 'edge' };
}

function requestTarget(
  workflowId: WebWorkflowId,
  officeCode: EducationOfficeCode,
  workflowSpec?: WebWorkflowSpec,
): string {
  const spec = requestWorkflowSpec(workflowId, workflowSpec);
  if (!spec) {
    throw new Error('사용자 지정 웹 업무 설정이 올바르지 않습니다. 편집기에서 키를 다시 만들어 주세요.');
  }
  return spec.id === 'custom'
    ? getWebWorkflowTargetForSpec(spec, officeCode)
    : getWebWorkflowTarget(spec.id, officeCode);
}

export function resolveWindowsManagedBrowserExecutable(
  browserId: WebConnectorBrowserId,
  {
    env = process.env,
    exists = existsSync,
  }: ResolveWindowsManagedBrowserOptions = {},
): string | null {
  const roots = browserId === 'edge'
    ? [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA]
    : [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA];
  const relative = browserId === 'edge'
    ? 'Microsoft/Edge/Application/msedge.exe'
    : 'Google/Chrome/Application/chrome.exe';
  for (const root of roots) {
    if (!root) continue;
    const candidate = win32.join(root, relative);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export function selectWindowsWorkflowTarget(
  targets: readonly WindowsTargetInfo[],
  officeCode: EducationOfficeCode,
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
): WindowsTargetInfo | null {
  const spec = requestWorkflowSpec(workflowId, workflowSpec);
  if (!spec) return null;
  return targets.find((target) => (
    target.type === 'page' &&
    (spec.id === 'custom'
      ? isAllowedWebWorkflowSpecTarget(spec, target.url, officeCode)
      : isAllowedWebWorkflowTarget(spec.id, target.url, officeCode))
  )) ?? null;
}

export async function createWindowsManagedBrowserSession(
  officeCode: EducationOfficeCode,
  browserId: WebConnectorBrowserId,
  {
    userDataPath,
    env = process.env,
    exists = existsSync,
    makeDirectory = (path, options) => mkdir(path, options),
    connectBrowser = (options) => connectManagedBrowser(options),
  }: CreateWindowsManagedBrowserSessionOptions,
): Promise<WindowsManagedBrowserSession> {
  const executable = resolveWindowsManagedBrowserExecutable(browserId, { env, exists });
  if (!executable) {
    const browserName = browserId === 'edge' ? '엣지' : '크롬';
    throw new Error(`${browserName}를 찾을 수 없습니다. 브라우저를 설치한 뒤 연결을 다시 시험해 주세요.`);
  }
  const { resolveManagedProfilePath } = await import('./browserProcess');
  const profilePath = resolveManagedProfilePath(userDataPath, officeCode, browserId, 'win32');
  await makeDirectory(profilePath, { recursive: true, mode: 0o700 });
  const connection = await connectBrowser({ browserId, executable, profilePath });
  let bootstrapTargetId: string | undefined;
  try {
    bootstrapTargetId = readTargetInfos(
      await connection.protocol.send('Target.getTargets', {}),
    ).find(isBootstrapTarget)?.targetId;
  } catch {
    // A target can be created lazily if the browser has not published its first tab yet.
  }
  let closed = false;
  return {
    officeCode,
    browserId,
    connection,
    bootstrapTargetId,
    workflowState: 'IDLE',
    isAlive() {
      return !closed && !connection.process.exited && !connection.protocol.isClosed;
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await connection.process.close(async () => {
          if (connection.protocol.isClosed) return;
          try {
            await connection.protocol.send('Browser.close', {}, undefined, 2_000);
          } catch {
            // The owned child may already be closing.
          }
        });
      } finally {
        connection.protocol.close();
      }
    },
  };
}

function validateWorkflowOrigin(
  origin: string,
  officeCode: EducationOfficeCode,
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
): void {
  const office = getEducationOffice(officeCode);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('업무용 브라우저 주소를 확인하지 못했습니다. 브라우저를 닫고 다시 시도해 주세요.');
  }
  if (parsed.origin === new URL(office.portalUrl).origin) {
    throw new Error('업무 시스템 로그인이 필요합니다. 업무용 브라우저에서 직접 로그인한 뒤 키를 다시 눌러 주세요.');
  }
  const spec = requestWorkflowSpec(workflowId, workflowSpec);
  if (!spec) {
    throw new Error('사용자 지정 웹 업무 설정이 올바르지 않습니다. 편집기에서 키를 다시 만들어 주세요.');
  }
  const allowedTarget = spec.id === 'custom'
    ? isAllowedWebWorkflowSpecTarget(spec, parsed.href, officeCode)
    : isAllowedWebWorkflowTarget(spec.id, parsed.href, officeCode);
  if (
    !isAllowedOfficeHost(officeCode, parsed.href) ||
    !allowedTarget
  ) {
    throw new Error('허용되지 않은 주소로 이동해 자동 이동을 중단했습니다. 업무용 브라우저의 주소를 확인한 뒤 직접 계속해 주세요.');
  }
}

export async function executeWindowsWorkflow(
  session: ManagedBrowserSession,
  request: ManagedWorkflowRequest,
  dependencies: ExecuteWindowsWorkflowDependencies,
): Promise<WorkflowRunResult> {
  if (
    session.officeCode !== request.officeCode ||
    session.browserId !== request.browserId
  ) {
    throw new Error('업무 요청과 브라우저 세션이 다릅니다. 설정에서 업무용 브라우저를 다시 열어 주세요.');
  }
  if (
    request.workflowSpec &&
    (
      !isWebWorkflowSpec(request.workflowSpec) ||
      request.workflowSpec.browserId !== request.browserId ||
      request.workflowSpec.id !== request.workflowId ||
      (
        request.workflowSpec.officeCode !== undefined &&
        request.workflowSpec.officeCode !== request.officeCode
      )
    )
  ) {
    throw new Error('웹 업무와 업무용 브라우저 설정이 서로 다릅니다. 편집기에서 브라우저를 다시 선택해 주세요.');
  }
  const definition = managedWorkflowDefinition(request);
  if (request.workflowId === 'edufine-draft' && !await dependencies.isWxsClientRegistered()) {
    throw new Error('기안 편집 프로그램이 설치되어 있지 않습니다. 에듀파인 설치 안내에서 WXSClient를 설치한 뒤 다시 시도해 주세요.');
  }
  const existingWindows = request.workflowId === 'edufine-draft'
    ? new Set((await dependencies.listWxsClientWindows()).map(({ id }) => id))
    : new Set<number>();
  let newEditorWindow: WxsClientWindow | undefined;
  let page: WindowsWorkflowPage;
  try {
    page = await dependencies.openWorkflowPage(
      session,
      request.workflowId,
      request.workflowSpec,
    );
  } catch (error) {
    setWorkflowState(session, 'FAILED');
    throw error;
  }
  try {
    // Restore before inspecting the page so login prompts and failures are visible immediately.
    await page.activate();
    const assertOrigin = async (): Promise<void> => validateWorkflowOrigin(
      await page.currentOrigin(),
      request.officeCode,
      request.workflowId,
      request.workflowSpec,
    );
    await assertOrigin();
    const guardedPage: WorkflowPageAdapter = {
      async inspectCandidates(step) {
        await assertOrigin();
        return page.inspectCandidates(step);
      },
      async pressCandidate(candidate, step) {
        await assertOrigin();
        await page.pressCandidate(candidate, step);
        await assertOrigin();
      },
      async checkPostcondition(step) {
        await assertOrigin();
        const postcondition = step.postcondition;
        if (postcondition.kind !== 'new-window') {
          return page.checkPostcondition(step);
        }
        const windows = await dependencies.listWxsClientWindows();
        newEditorWindow = windows.find((window) => (
          !existingWindows.has(window.id) &&
          window.title.includes(postcondition.titleIncludes)
        ));
        return Boolean(newEditorWindow);
      },
      wait: (delayMs) => page.wait(delayMs),
    };
    const result = await runWorkflow(definition, guardedPage);
    if (request.workflowId === 'edufine-draft') {
      if (!newEditorWindow || !await dependencies.focusWindow(newEditorWindow.id)) {
        throw new Error('새 기안 편집기 창을 앞으로 가져오지 못했습니다. 작업 표시줄에서 WXSClient 창을 직접 선택해 주세요.');
      }
    } else {
      await page.activate();
    }
    setWorkflowState(session, 'COMPLETED');
    return result;
  } catch (error) {
    setWorkflowState(session, 'FAILED');
    try {
      await page.activate();
    } catch {
      // Keep the original workflow error if the browser also refuses activation.
    }
    throw error;
  } finally {
    await page.release?.();
  }
}

interface CdpEvaluationResponse {
  result?: { value?: unknown };
  exceptionDetails?: unknown;
}

const PAGE_ELEMENT_HELPERS = `
const normalize=(value)=>String(value??'').replace(/\\s+/g,' ').trim();
const textOf=(element)=>normalize(
  element.getAttribute?.('aria-label')||
  element.getAttribute?.('title')||
  ('value' in element?element.value:'')||
  element.innerText||element.textContent||''
);
const visibleTextOf=(element)=>normalize(element.innerText||element.textContent||'');
const accessibleNameOf=(element)=>normalize(element.getAttribute?.('aria-label'));
const titleTextOf=(element)=>normalize(element.getAttribute?.('title'));
const valueTextOf=(element)=>normalize('value' in element?element.value:'');
const surfaceTextsOf=(element)=>[
  visibleTextOf(element),
  accessibleNameOf(element),
  titleTextOf(element),
  valueTextOf(element)
].filter(Boolean);
const visible=(element)=>{
  if(element.hidden||element.getAttribute?.('aria-hidden')==='true')return false;
  const view=element.ownerDocument?.defaultView;
  const style=view?.getComputedStyle(element);
  if(!style||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
  const rect=element.getBoundingClientRect();
  return rect.width>0&&rect.height>0;
};
const enabled=(element)=>!(element.disabled===true||element.getAttribute?.('aria-disabled')==='true');
const formAssociated=(element)=>Boolean(element.form||element.hasAttribute?.('form')||element.closest?.('form'));
const safeNavigation=(element)=>{
  const role=normalize(element.getAttribute?.('role')).toLowerCase();
  const tag=String(element.tagName||'').toUpperCase();
  const inputType=normalize(element.getAttribute?.('type')).toLowerCase();
  if(formAssociated(element)||element.hasAttribute?.('onclick')||element.hasAttribute?.('download'))return false;
  if(inputType==='submit'||inputType==='image')return false;
  if(role==='tab')return true;
  if(tag!=='A'&&role!=='link')return false;
  const rawHref=normalize(element.getAttribute?.('href'));
  if(!rawHref||rawHref.toLowerCase().startsWith('javascript:'))return false;
  try{
    const url=new URL(rawHref,element.ownerDocument?.baseURI||location.href);
    return url.protocol==='https:'&&url.origin===location.origin;
  }catch{return false;}
};
const documents=[];
const visit=(view,offsetX=0,offsetY=0)=>{
  try{
    const document=view.document;
    documents.push({document,offsetX,offsetY});
    for(const frame of Array.from(document.querySelectorAll('iframe,frame'))){
      try{
        const rect=frame.getBoundingClientRect();
        if(frame.contentWindow)visit(frame.contentWindow,offsetX+rect.left,offsetY+rect.top);
      }catch{}
    }
  }catch{}
};
visit(window);
const clickable=()=>documents.flatMap(({document,offsetX,offsetY})=>
  Array.from(document.querySelectorAll('a,button,[role="button"],[role="menuitem"],[role="tab"],[onclick],input[type="button"],input[type="submit"]'))
    .map(element=>({element,offsetX,offsetY}))
);
`;

const CANDIDATE_SCAN_EXPRESSION = `(()=>{
${PAGE_ELEMENT_HELPERS}
return clickable().slice(0,500).map(({element},index)=>{
  const rect=element.getBoundingClientRect();
  const role=normalize(element.getAttribute?.('role')).toLowerCase();
  const tag=String(element.tagName||'').toUpperCase();
  const navigation=tag==='A'||role==='link'||role==='menuitem'||role==='tab'||element.getAttribute?.('aria-haspopup')==='menu';
  return {
    index,
    text:textOf(element),
    visible:visible(element),
    enabled:enabled(element),
    width:rect.width,
    height:rect.height,
    navigation,
    safeNavigation:safeNavigation(element),
    tag,
    inputType:normalize(element.getAttribute?.('type')).toLowerCase(),
    href:normalize(element.getAttribute?.('href')).slice(0,2048),
    formAssociated:formAssociated(element),
    inlineHandler:element.hasAttribute?.('onclick')===true,
    visibleText:visibleTextOf(element).slice(0,500),
    accessibleName:accessibleNameOf(element).slice(0,500),
    titleText:titleTextOf(element).slice(0,500),
    valueText:valueTextOf(element).slice(0,500)
  };
});
})()`;

function candidateActionExpression(
  index: number,
  expectedText: string,
  domClick: boolean,
  navigationOnly: boolean,
  allowedNavigationOrigin?: string,
): string {
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const item=clickable()[${index}];
if(!item)return {ok:false};
const forbiddenTokens=${JSON.stringify(FORBIDDEN_ACTION_TOKENS)};
const approvedNonActions=new Set(${JSON.stringify([...APPROVED_NON_ACTION_LABELS])});
const forbiddenSurface=surfaceTextsOf(item.element).some(text=>{
  const normalized=normalize(text);
  return !approvedNonActions.has(normalized)&&forbiddenTokens.some(token=>normalized.includes(token));
});
const allowedCrossOriginNavigation=(()=>{
  const allowedOrigin=${JSON.stringify(allowedNavigationOrigin ?? '')};
  if(!allowedOrigin||formAssociated(item.element)||item.element.hasAttribute?.('onclick')||item.element.hasAttribute?.('download'))return false;
  const role=normalize(item.element.getAttribute?.('role')).toLowerCase();
  const tag=String(item.element.tagName||'').toUpperCase();
  if(tag!=='A'&&role!=='link')return false;
  const rawHref=normalize(item.element.getAttribute?.('href'));
  if(!rawHref||rawHref.toLowerCase().startsWith('javascript:'))return false;
  try{
    const url=new URL(rawHref,item.element.ownerDocument?.baseURI||location.href);
    return url.protocol==='https:'&&url.origin===allowedOrigin;
  }catch{return false;}
})();
if(textOf(item.element)!==${JSON.stringify(expectedText)}||!visible(item.element)||!enabled(item.element)||forbiddenSurface||(${JSON.stringify(navigationOnly)}&&!safeNavigation(item.element)&&!allowedCrossOriginNavigation))return {ok:false};
const rect=item.element.getBoundingClientRect();
${domClick
    ? "item.element.focus?.({preventScroll:false});item.element.click?.();return {ok:true};"
    : 'return {ok:true,x:item.offsetX+rect.left+rect.width/2,y:item.offsetY+rect.top+rect.height/2};'}
})()`;
}

function postconditionExpression(step: WorkflowStep): string {
  const condition = step.postcondition;
  if (condition.kind === 'new-window') return 'false';
  const labels = JSON.stringify(condition.labels);
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const labels=new Set(${labels}.map(normalize));
const selector=${JSON.stringify(
    condition.kind === 'tab-selected-any'
      ? '[role="tab"][aria-selected="true"],[role="tab"].active,.tab.active'
      : 'h1,h2,h3,label,span,div,[role="dialog"],[aria-label],[title],[role="tab"]',
  )};
const found=new Set();
for(const {document} of documents){
  if(${JSON.stringify(condition.kind)}==='dialog-title-any'&&labels.has(normalize(document.title)))found.add(normalize(document.title));
  for(const element of Array.from(document.querySelectorAll(selector))){
    if(!visible(element))continue;
    const text=textOf(element);
    if(labels.has(text))found.add(text);
  }
}
return ${JSON.stringify(condition.kind)}==='visible-all'
  ? Array.from(labels).every(label=>found.has(label))
  : found.size>0;
})()`;
}

function approvalCounterExpression(system: WebWorkflowSystem): string {
  const labels = system === 'neis'
    ? ['결재 대기', '결재대기', '미결문서', '대기문서', '미결']
    : ['결재 대기', '결재대기', '결재할 문서', '미결문서', '대기문서'];
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const labels=${JSON.stringify(labels)}.map(value=>normalize(value).replace(/\\s+/g,''));
const signal=(element)=>({
  text:normalize(element?.innerText||element?.textContent||'').slice(0,256),
  ariaLabel:normalize(element?.getAttribute?.('aria-label')).slice(0,256),
  title:normalize(element?.getAttribute?.('title')).slice(0,256),
  className:normalize(element?.className?.baseVal??element?.className).slice(0,256),
  role:normalize(element?.getAttribute?.('role')).toLowerCase().slice(0,64)
});
const candidates=[];
for(const {document} of documents){
  const elements=Array.from(document.querySelectorAll('[aria-label],[title],span,em,strong,b,a,button,div')).slice(0,2500);
  for(const element of elements){
    if(!visible(element))continue;
    const candidate=signal(element);
    const children=Array.from(element.children||[]).slice(0,16).filter(visible).map(signal);
    const next=element.nextElementSibling&&visible(element.nextElementSibling)
      ? signal(element.nextElementSibling)
      : undefined;
    const values=[candidate.text,candidate.ariaLabel,candidate.title,...children.flatMap(child=>[child.text,child.ariaLabel,child.title]),...(next?[next.text,next.ariaLabel,next.title]:[])];
    if(!values.some(value=>labels.some(label=>value.replace(/\\s+/g,'').includes(label))))continue;
    candidates.push({...candidate,children,...(next?{next}:{})});
    if(candidates.length>=100)return candidates;
  }
}
return candidates;
})()`;
}

async function evaluateValue<T>(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  expression: string,
  userGesture = false,
): Promise<T> {
  const response = await session.connection.protocol.send<CdpEvaluationResponse>(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: false, userGesture },
    sessionId,
  );
  if (response.exceptionDetails || !response.result || !('value' in response.result)) {
    throw new Error('업무 화면을 읽지 못했습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.');
  }
  return response.result.value as T;
}

function readCandidateSummaries(value: unknown): CandidateSummary[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((entry): CandidateSummary[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    if (
      !Number.isInteger(candidate.index) ||
      typeof candidate.text !== 'string' ||
      candidate.text.length > 500 ||
      typeof candidate.visible !== 'boolean' ||
      typeof candidate.enabled !== 'boolean' ||
      typeof candidate.width !== 'number' ||
      typeof candidate.height !== 'number' ||
      typeof candidate.navigation !== 'boolean' ||
      typeof candidate.safeNavigation !== 'boolean' ||
      typeof candidate.tag !== 'string' ||
      candidate.tag.length > 32 ||
      typeof candidate.inputType !== 'string' ||
      candidate.inputType.length > 64 ||
      typeof candidate.href !== 'string' ||
      candidate.href.length > 2_048 ||
      typeof candidate.formAssociated !== 'boolean' ||
      typeof candidate.inlineHandler !== 'boolean'
      || typeof candidate.visibleText !== 'string'
      || candidate.visibleText.length > 500
      || typeof candidate.accessibleName !== 'string'
      || candidate.accessibleName.length > 500
      || typeof candidate.titleText !== 'string'
      || candidate.titleText.length > 500
      || typeof candidate.valueText !== 'string'
      || candidate.valueText.length > 500
    ) {
      return [];
    }
    return [{
      index: Number(candidate.index),
      text: candidate.text,
      visible: candidate.visible,
      enabled: candidate.enabled,
      width: candidate.width,
      height: candidate.height,
      navigation: candidate.navigation,
      safeNavigation: candidate.safeNavigation,
      tag: candidate.tag,
      inputType: candidate.inputType,
      href: candidate.href,
      formAssociated: candidate.formAssociated,
      inlineHandler: candidate.inlineHandler,
      visibleText: candidate.visibleText,
      accessibleName: candidate.accessibleName,
      titleText: candidate.titleText,
      valueText: candidate.valueText,
    }];
  });
}

function readTargetInfos(value: unknown): WindowsTargetInfo[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const targetInfos = (value as Record<string, unknown>).targetInfos;
  if (!Array.isArray(targetInfos)) return [];
  return targetInfos.flatMap((entry): WindowsTargetInfo[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const target = entry as Record<string, unknown>;
    if (
      typeof target.targetId !== 'string' ||
      typeof target.type !== 'string' ||
      typeof target.url !== 'string'
    ) {
      return [];
    }
    return [{
      targetId: target.targetId,
      type: target.type,
      url: target.url,
      ...(typeof target.title === 'string' ? { title: target.title } : {}),
    }];
  });
}

interface AttachedWindowsTarget {
  target: WindowsTargetInfo;
  sessionId: string;
}

interface WorkflowTargetOptions {
  background?: boolean;
  closeCreatedTargetOnRelease?: boolean;
  forceNewTarget?: boolean;
}

interface WorkflowTargetLifecycle {
  attachedSessionIds: string[];
  closeTargetIds: string[];
}

interface PageReadinessState {
  href: string;
  origin: string;
  readyState: string;
  loginVisible: boolean;
}

const PAGE_READINESS_EXPRESSION = `(()=>{
const password=Array.from(document.querySelectorAll('input[type="password"]')).some((element)=>{
  const style=getComputedStyle(element);
  const rect=element.getBoundingClientRect();
  return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
});
return {href:location.href,origin:location.origin,readyState:document.readyState,loginVisible:password};
})()`;

const PORTAL_NEIS_LABELS = [
  '나이스',
  '나이스(NEIS)',
  'NEIS',
  '4세대 나이스',
  '4세대 지능형 나이스',
] as const;

function isBootstrapTarget(target: WindowsTargetInfo): boolean {
  if (target.type !== 'page') return false;
  const normalized = target.url.toLowerCase().replace(/\/+$/, '');
  return normalized === 'about:blank' ||
    normalized === 'edge://newtab' ||
    normalized === 'edge://new-tab-page' ||
    normalized === 'chrome://newtab';
}

function isPortalTarget(
  target: WindowsTargetInfo,
  officeCode: EducationOfficeCode,
): boolean {
  if (target.type !== 'page') return false;
  try {
    return new URL(target.url).origin === new URL(
      getEducationOffice(officeCode).portalUrl,
    ).origin;
  } catch {
    return false;
  }
}

function isNeisRequest(
  workflowId: WebWorkflowId,
  officeCode: EducationOfficeCode,
  workflowSpec?: WebWorkflowSpec,
): boolean {
  try {
    return new URL(requestTarget(workflowId, officeCode, workflowSpec)).origin ===
      new URL(getEducationOffice(officeCode).neisUrl).origin;
  } catch {
    return false;
  }
}

function workflowTargetAllowed(
  target: string,
  officeCode: EducationOfficeCode,
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
): boolean {
  const spec = requestWorkflowSpec(workflowId, workflowSpec);
  if (!spec) return false;
  return spec.id === 'custom'
    ? isAllowedWebWorkflowSpecTarget(spec, target, officeCode)
    : isAllowedWebWorkflowTarget(spec.id, target, officeCode);
}

async function attachWindowsTarget(
  session: WindowsManagedBrowserSession,
  target: WindowsTargetInfo,
  lifecycle?: WorkflowTargetLifecycle,
): Promise<AttachedWindowsTarget> {
  const protocol = session.connection.protocol;
  const attached = await protocol.send<{ sessionId?: unknown }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  if (typeof attached.sessionId !== 'string') {
    throw new Error('업무용 브라우저 탭에 연결하지 못했습니다. 브라우저를 다시 열어 주세요.');
  }
  lifecycle?.attachedSessionIds.push(attached.sessionId);
  await protocol.send('Page.enable', {}, attached.sessionId);
  return { target, sessionId: attached.sessionId };
}

async function restoreOwnedBrowserWindow(
  session: WindowsManagedBrowserSession,
): Promise<boolean> {
  const pid = session.connection.process.pid;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return false;
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; $h=$p.MainWindowHandle; if($h -eq 0){exit 2}; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class StreamPanelWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'; [StreamPanelWindow]::ShowWindowAsync($h,9)|Out-Null; [StreamPanelWindow]::SetForegroundWindow($h)|Out-Null`;
  return (await runWindowsCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
  )) !== null;
}

async function restoreAndActivateTarget(
  session: WindowsManagedBrowserSession,
  targetId: string,
  sessionId?: string,
): Promise<void> {
  const protocol = session.connection.protocol;
  let cdpWindowFound = false;
  try {
    const window = await protocol.send<{
      windowId?: unknown;
      bounds?: { windowState?: unknown };
    }>('Browser.getWindowForTarget', { targetId });
    if (Number.isInteger(window.windowId)) {
      cdpWindowFound = true;
      if (window.bounds?.windowState === 'minimized') {
        await protocol.send('Browser.setWindowBounds', {
          windowId: Number(window.windowId),
          bounds: { windowState: 'normal' },
        });
      }
    }
  } catch {
    // Older Chromium builds can reject the Browser domain window commands.
  }
  if (!cdpWindowFound) await restoreOwnedBrowserWindow(session);
  await protocol.send('Target.activateTarget', { targetId });
  if (sessionId) await protocol.send('Page.bringToFront', {}, sessionId);
}

function readPageReadinessState(value: unknown): PageReadinessState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (
    typeof state.href !== 'string' ||
    typeof state.origin !== 'string' ||
    typeof state.readyState !== 'string' ||
    typeof state.loginVisible !== 'boolean'
  ) {
    return null;
  }
  return {
    href: state.href,
    origin: state.origin,
    readyState: state.readyState,
    loginVisible: state.loginVisible,
  };
}

async function waitForReadyPage(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  accepts: (state: PageReadinessState) => boolean,
  timeoutMs = 30_000,
): Promise<PageReadinessState> {
  const deadline = Date.now() + timeoutMs;
  let stableHref = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    try {
      const state = readPageReadinessState(
        await evaluateValue(session, sessionId, PAGE_READINESS_EXPRESSION),
      );
      if (
        state &&
        /^https?:\/\//.test(state.origin) &&
        (state.readyState === 'interactive' || state.readyState === 'complete') &&
        accepts(state)
      ) {
        stableCount = state.href === stableHref ? stableCount + 1 : 1;
        stableHref = state.href;
        if (stableCount >= 2) return state;
      } else {
        stableHref = '';
        stableCount = 0;
      }
    } catch {
      stableHref = '';
      stableCount = 0;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('업무 시스템 화면이 열리는 시간이 지났습니다. 네트워크와 로그인 화면을 확인해 주세요.');
}

async function pressCandidateWithCdp(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  candidate: CandidateSummary,
  interaction: 'mouse' | 'dom-click',
  navigationOnly = false,
  allowedNavigationOrigin?: string,
): Promise<void> {
  const protocol = session.connection.protocol;
  const normalizedText = candidate.text.replace(/\s+/g, ' ').trim();
  const action = await evaluateValue<{ ok?: unknown; x?: unknown; y?: unknown }>(
    session,
    sessionId,
    candidateActionExpression(
      candidate.index,
      normalizedText,
      interaction === 'dom-click',
      navigationOnly,
      allowedNavigationOrigin,
    ),
    interaction === 'dom-click',
  );
  if (!action?.ok) {
    throw new Error(`'${normalizedText}' 메뉴의 위치가 바뀌었습니다. 화면을 확인한 뒤 다시 시도해 주세요.`);
  }
  if (interaction === 'dom-click') return;
  if (typeof action.x !== 'number' || typeof action.y !== 'number') {
    throw new Error(`'${normalizedText}' 메뉴 위치를 확인하지 못했습니다. 화면에서 직접 눌러 주세요.`);
  }
  await protocol.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: action.x, y: action.y,
  }, sessionId);
  await protocol.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: action.x, y: action.y, button: 'left', clickCount: 1,
  }, sessionId);
  await protocol.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: action.x, y: action.y, button: 'left', clickCount: 1,
  }, sessionId);
}

async function navigateAttachedTarget(
  session: WindowsManagedBrowserSession,
  attached: AttachedWindowsTarget,
  url: string,
): Promise<void> {
  await session.connection.protocol.send('Page.navigate', { url }, attached.sessionId);
  if (session.bootstrapTargetId === attached.target.targetId) {
    session.bootstrapTargetId = undefined;
  }
  attached.target = { ...attached.target, url };
}

async function acquireDirectWorkflowTarget(
  session: WindowsManagedBrowserSession,
  targets: readonly WindowsTargetInfo[],
  workflowId: WebWorkflowId,
  workflowSpec: WebWorkflowSpec | undefined,
  options: WorkflowTargetOptions,
  lifecycle: WorkflowTargetLifecycle,
): Promise<AttachedWindowsTarget> {
  const protocol = session.connection.protocol;
  const targetUrl = requestTarget(workflowId, session.officeCode, workflowSpec);
  let target = options.forceNewTarget
    ? null
    : selectWindowsWorkflowTarget(
      targets,
      session.officeCode,
      workflowId,
      workflowSpec,
    );
  let shouldNavigate = false;
  if (!target && !options.forceNewTarget) {
    target = targets.find((candidate) => (
      candidate.targetId === session.bootstrapTargetId && isBootstrapTarget(candidate)
    )) ?? targets.find(isBootstrapTarget) ??
      targets.find((candidate) => isPortalTarget(candidate, session.officeCode)) ?? null;
    shouldNavigate = Boolean(target);
  }
  if (!target) {
    const created = await protocol.send<{ targetId?: unknown }>('Target.createTarget', {
      url: targetUrl,
      ...(options.background ? { background: true } : {}),
    });
    if (typeof created.targetId !== 'string') {
      throw new Error('업무용 브라우저 탭을 만들지 못했습니다. 브라우저를 다시 열어 주세요.');
    }
    target = { targetId: created.targetId, type: 'page', url: targetUrl };
    if (options.closeCreatedTargetOnRelease) {
      lifecycle.closeTargetIds.push(created.targetId);
    }
  }
  const attached = await attachWindowsTarget(session, target, lifecycle);
  if (!options.background) {
    session.workflowState = 'RESTORING_WINDOW';
    await restoreAndActivateTarget(session, target.targetId, attached.sessionId);
  }
  if (shouldNavigate) await navigateAttachedTarget(session, attached, targetUrl);
  return attached;
}

function selectPortalNeisCandidate(
  candidates: readonly CandidateSummary[],
  portalOrigin: string,
  neisOrigin: string,
): CandidateSummary | null {
  const navigable = candidates.filter((candidate) => {
    if (candidate.navigation !== true) return false;
    if (candidate.safeNavigation === true) return true;
    if (
      candidate.tag?.toUpperCase() !== 'A' ||
      candidate.formAssociated === true ||
      candidate.inlineHandler === true ||
      candidate.inputType === 'submit' ||
      candidate.inputType === 'image' ||
      !candidate.href
    ) {
      return false;
    }
    try {
      const target = new URL(candidate.href, portalOrigin);
      return target.protocol === 'https:' && target.origin === neisOrigin;
    } catch {
      return false;
    }
  });
  return selectSafeCandidate(navigable, PORTAL_NEIS_LABELS);
}

async function acquireNeisWorkflowTarget(
  session: WindowsManagedBrowserSession,
  targets: readonly WindowsTargetInfo[],
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
  lifecycle: WorkflowTargetLifecycle = { attachedSessionIds: [], closeTargetIds: [] },
): Promise<AttachedWindowsTarget> {
  const protocol = session.connection.protocol;
  const existing = selectWindowsWorkflowTarget(
    targets,
    session.officeCode,
    workflowId,
    workflowSpec,
  );
  let portal: AttachedWindowsTarget | undefined;
  if (existing) {
    const attached = await attachWindowsTarget(session, existing, lifecycle);
    session.workflowState = 'RESTORING_WINDOW';
    await restoreAndActivateTarget(session, existing.targetId, attached.sessionId);
    session.workflowState = 'CHECKING_AUTH';
    const state = await waitForReadyPage(
      session,
      attached.sessionId,
      (candidate) => workflowTargetAllowed(
        candidate.href,
        session.officeCode,
        workflowId,
        workflowSpec,
      ) || new URL(candidate.origin).origin === new URL(
        getEducationOffice(session.officeCode).portalUrl,
      ).origin,
    );
    if (workflowTargetAllowed(
      state.href,
      session.officeCode,
      workflowId,
      workflowSpec,
    )) {
      return attached;
    }
    attached.target = { ...attached.target, url: state.href };
    portal = attached;
  }

  const office = getEducationOffice(session.officeCode);
  let portalTarget = portal?.target ??
    targets.find((candidate) => isPortalTarget(candidate, session.officeCode));
  let shouldNavigate = false;
  if (!portalTarget) {
    portalTarget = targets.find((candidate) => (
      candidate.targetId === session.bootstrapTargetId && isBootstrapTarget(candidate)
    )) ?? targets.find(isBootstrapTarget);
    shouldNavigate = Boolean(portalTarget);
  }
  if (!portalTarget) {
    const created = await protocol.send<{ targetId?: unknown }>('Target.createTarget', {
      url: office.portalUrl,
    });
    if (typeof created.targetId !== 'string') {
      throw new Error('업무 포털 탭을 만들지 못했습니다. 업무용 브라우저를 다시 열어 주세요.');
    }
    portalTarget = { targetId: created.targetId, type: 'page', url: office.portalUrl };
  }
  portal ??= await attachWindowsTarget(session, portalTarget, lifecycle);
  session.workflowState = 'RESTORING_WINDOW';
  await restoreAndActivateTarget(session, portalTarget.targetId, portal.sessionId);
  if (shouldNavigate) await navigateAttachedTarget(session, portal, office.portalUrl);
  const portalState = await waitForReadyPage(session, portal.sessionId, () => true);
  session.workflowState = portalState.loginVisible ? 'WAITING_FOR_USER' : 'CHECKING_AUTH';

  const deadline = Date.now() + 120_000;
  let ssoStarted = false;
  while (Date.now() < deadline) {
    const currentTargets = readTargetInfos(await protocol.send('Target.getTargets', {}));
    const neisTarget = selectWindowsWorkflowTarget(
      currentTargets,
      session.officeCode,
      workflowId,
      workflowSpec,
    );
    if (neisTarget) {
      session.workflowState = 'WAITING_FOR_NEIS';
      if (neisTarget.targetId === portal.target.targetId) {
        portal.target = neisTarget;
        return portal;
      }
      const attached = await attachWindowsTarget(session, neisTarget, lifecycle);
      await restoreAndActivateTarget(session, neisTarget.targetId, attached.sessionId);
      return attached;
    }

    if (!ssoStarted) {
      let candidates: CandidateSummary[] = [];
      try {
        candidates = readCandidateSummaries(
          await evaluateValue(session, portal.sessionId, CANDIDATE_SCAN_EXPRESSION),
        );
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        continue;
      }
      const portalOrigin = new URL(office.portalUrl).origin;
      const neisOrigin = new URL(office.neisUrl).origin;
      const candidate = selectPortalNeisCandidate(candidates, portalOrigin, neisOrigin);
      if (candidate) {
        session.workflowState = 'ENTERING_NEIS_SSO';
        await pressCandidateWithCdp(
          session,
          portal.sessionId,
          candidate,
          'mouse',
          true,
          neisOrigin,
        );
        ssoStarted = true;
        session.workflowState = 'WAITING_FOR_NEIS';
      } else {
        session.workflowState = 'WAITING_FOR_USER';
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  await restoreAndActivateTarget(session, portal.target.targetId, portal.sessionId);
  throw new Error('업무포털에서 나이스 로그인을 기다리는 시간이 지났습니다. 표시된 업무용 브라우저에서 로그인 상태와 나이스 메뉴를 확인해 주세요.');
}

function createWindowsWorkflowPage(
  session: WindowsManagedBrowserSession,
  attached: AttachedWindowsTarget,
  release: () => Promise<void>,
): WindowsWorkflowPage {
  const { sessionId } = attached;
  return {
    async currentOrigin() {
      const origin = await evaluateValue<unknown>(session, sessionId, 'location.origin');
      return typeof origin === 'string' ? origin : '';
    },
    async inspectCandidates() {
      return readCandidateSummaries(
        await evaluateValue(session, sessionId, CANDIDATE_SCAN_EXPRESSION),
      );
    },
    async pressCandidate(candidate, step) {
      await pressCandidateWithCdp(
        session,
        sessionId,
        candidate,
        step.interaction,
        Boolean(step.navigationOnly),
      );
    },
    async checkPostcondition(step) {
      return Boolean(await evaluateValue(
        session,
        sessionId,
        postconditionExpression(step),
      ));
    },
    async wait(delayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    },
    async activate() {
      await restoreAndActivateTarget(session, attached.target.targetId, sessionId);
    },
    release,
    async readApprovalCount(system) {
      return parseApprovalCounterCandidates(
        system,
        await evaluateValue<unknown>(
          session,
          sessionId,
          approvalCounterExpression(system),
        ),
      );
    },
  };
}

export async function openCdpWindowsApprovalPage(
  session: WindowsManagedBrowserSession,
  input: ApprovalScanInput,
): Promise<WindowsApprovalPage> {
  const page = await openCdpWindowsWorkflowPage(
    session,
    input.system === 'neis' ? 'neis-approval-inbox' : 'edufine-approval-inbox',
    undefined,
    {
      background: true,
      closeCreatedTargetOnRelease: true,
      forceNewTarget: true,
    },
  );
  if (!page.readApprovalCount) {
    throw new Error('결재 대기 수 읽기 기능이 준비되지 않았습니다. 스트림 패널을 업데이트해 주세요.');
  }
  return page as WindowsApprovalPage;
}

export async function openCdpWindowsWorkflowPage(
  session: WindowsManagedBrowserSession,
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
  options: WorkflowTargetOptions = {},
): Promise<WindowsWorkflowPage> {
  session.workflowState = 'ACQUIRING_TARGET';
  const protocol = session.connection.protocol;
  const lifecycle: WorkflowTargetLifecycle = {
    attachedSessionIds: [],
    closeTargetIds: [],
  };
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    let cleanupFailed = false;
    for (const sessionId of [...new Set(lifecycle.attachedSessionIds)].reverse()) {
      try {
        await protocol.send('Target.detachFromTarget', { sessionId });
      } catch {
        cleanupFailed = true;
      }
    }
    for (const targetId of [...new Set(lifecycle.closeTargetIds)]) {
      try {
        await protocol.send('Target.closeTarget', { targetId });
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      try {
        await session.close();
      } catch {
        // The session manager will create a new browser session on the next request.
      }
    }
  };
  try {
    const targets = readTargetInfos(await protocol.send('Target.getTargets', {}));
    const attached = isNeisRequest(workflowId, session.officeCode, workflowSpec) &&
      !options.forceNewTarget
      ? await acquireNeisWorkflowTarget(
        session,
        targets,
        workflowId,
        workflowSpec,
        lifecycle,
      )
      : await acquireDirectWorkflowTarget(
        session,
        targets,
        workflowId,
        workflowSpec,
        options,
        lifecycle,
      );
    await waitForReadyPage(
      session,
      attached.sessionId,
      (state) => {
        if (state.loginVisible) session.workflowState = 'WAITING_FOR_USER';
        return !state.loginVisible && workflowTargetAllowed(
          state.href,
          session.officeCode,
          workflowId,
          workflowSpec,
        );
      },
      isNeisRequest(workflowId, session.officeCode, workflowSpec) ? 120_000 : 30_000,
    );
    if (!options.background) session.workflowState = 'NAVIGATING_DUTY_MENU';
    return createWindowsWorkflowPage(session, attached, release);
  } catch (error) {
    await release();
    throw error;
  }
}

export async function openWindowsOfficePortal(
  session: WindowsManagedBrowserSession,
): Promise<void> {
  const protocol = session.connection.protocol;
  const office = getEducationOffice(session.officeCode);
  const portalOrigin = new URL(office.portalUrl).origin;
  const targets = readTargetInfos(await protocol.send('Target.getTargets', {}));
  let target = targets.find((candidate) => {
    if (candidate.type !== 'page') return false;
    try {
      return new URL(candidate.url).origin === portalOrigin;
    } catch {
      return false;
    }
  });
  let shouldNavigate = false;
  if (!target) {
    target = targets.find((candidate) => (
      candidate.targetId === session.bootstrapTargetId && isBootstrapTarget(candidate)
    )) ?? targets.find(isBootstrapTarget);
    shouldNavigate = Boolean(target);
    if (!target) {
      const created = await protocol.send<{ targetId?: unknown }>('Target.createTarget', {
        url: office.portalUrl,
      });
      if (typeof created.targetId !== 'string') {
        throw new Error('업무 포털 탭을 만들지 못했습니다. 업무용 브라우저를 다시 열어 주세요.');
      }
      target = { targetId: created.targetId, type: 'page', url: office.portalUrl };
    }
  }
  const attached = await attachWindowsTarget(session, target);
  try {
    if (shouldNavigate) await navigateAttachedTarget(session, attached, office.portalUrl);
    await restoreAndActivateTarget(session, target.targetId, attached.sessionId);
  } finally {
    try {
      await protocol.send('Target.detachFromTarget', { sessionId: attached.sessionId });
    } catch {
      await session.close();
    }
  }
}

export async function focusWindowsWorkflow(
  session: WindowsManagedBrowserSession,
  request: ManagedWorkflowRequest,
): Promise<void> {
  const targets = readTargetInfos(
    await session.connection.protocol.send('Target.getTargets', {}),
  );
  const target = selectWindowsWorkflowTarget(
    targets,
    request.officeCode,
    request.workflowId,
    request.workflowSpec,
  ) ?? targets.find((candidate) => isPortalTarget(candidate, request.officeCode)) ??
    targets.find(isBootstrapTarget);
  if (target) await restoreAndActivateTarget(session, target.targetId);
}

function runWindowsCommand(
  command: string,
  args: readonly string[],
  timeout = 5_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 128 * 1024 },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

export async function isWxsClientRegistered(): Promise<boolean> {
  const output = await runWindowsCommand(
    'reg.exe',
    ['query', 'HKCR\\wxsclient\\shell\\open\\command', '/ve'],
  );
  return Boolean(output?.trim());
}

export function parseWxsClientWindows(output: string): WxsClientWindow[] {
  try {
    const parsed: unknown = JSON.parse(output);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value): WxsClientWindow[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const record = value as Record<string, unknown>;
      if (
        !Number.isSafeInteger(record.Id) ||
        Number(record.Id) <= 0 ||
        typeof record.MainWindowTitle !== 'string' ||
        record.MainWindowTitle.length < 1 ||
        record.MainWindowTitle.length > 512
      ) {
        return [];
      }
      return [{ id: Number(record.Id), title: record.MainWindowTitle }];
    });
  } catch {
    return [];
  }
}

export async function listWxsClientWindows(): Promise<WxsClientWindow[]> {
  const command = "Get-Process -Name WXSClient -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object Id,MainWindowTitle | ConvertTo-Json -Compress";
  const output = await runWindowsCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
  );
  return output ? parseWxsClientWindows(output) : [];
}

export async function focusWxsClientWindow(id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const command = `[void][Reflection.Assembly]::LoadWithPartialName('Microsoft.VisualBasic'); [Microsoft.VisualBasic.Interaction]::AppActivate(${id})`;
  return (await runWindowsCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
  )) !== null;
}

export interface CreateWindowsManagedSessionManagerOptions
  extends CreateWindowsManagedBrowserSessionOptions {
  workflowDependencies?: Partial<ExecuteWindowsWorkflowDependencies>;
}

export type WindowsManagedSessionController = ManagedBrowserSessionManager<
  WindowsManagedBrowserSession,
  WorkflowRunResult
> & {
  checkApproval(input: ApprovalScanInput): Promise<number>;
};

export function createWindowsManagedSessionManager(
  options: CreateWindowsManagedSessionManagerOptions,
): WindowsManagedSessionController {
  const workflowDependencies: ExecuteWindowsWorkflowDependencies = {
    openWorkflowPage: async (session, workflowId, workflowSpec) => {
      if (!('connection' in session)) {
        throw new Error('업무용 브라우저 연결 정보가 없습니다. 브라우저를 다시 열어 주세요.');
      }
      return openCdpWindowsWorkflowPage(
        session as WindowsManagedBrowserSession,
        workflowId,
        workflowSpec,
      );
    },
    isWxsClientRegistered,
    listWxsClientWindows,
    focusWindow: focusWxsClientWindow,
    ...options.workflowDependencies,
  };
  const manager = new ManagedBrowserSessionManager({
    createSession: (officeCode, browserId) => createWindowsManagedBrowserSession(
      officeCode,
      browserId,
      options,
    ),
    executeWorkflow: (session, request) => executeWindowsWorkflow(
      session,
      request,
      workflowDependencies,
    ),
    focusSession: focusWindowsWorkflow,
  });
  return Object.assign(manager, {
    checkApproval(input: ApprovalScanInput) {
      return manager.use(input.officeCode, input.browserId, (session) => (
        scanWindowsApprovalCount(session, input, {
          openPage: (managedSession, scanInput) => openCdpWindowsApprovalPage(
            managedSession as WindowsManagedBrowserSession,
            scanInput,
          ),
        })
      ));
    },
  });
}
