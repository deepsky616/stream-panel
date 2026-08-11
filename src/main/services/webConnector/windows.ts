import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { win32 } from 'node:path';
import { getEducationOffice, isAllowedOfficeHost } from '../../../shared/educationOffices';
import type {
  BuiltInWebWorkflowId,
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebSystemConnectionStatus,
  WebWorkflowId,
  WebWorkflowSpec,
  WebWorkflowSystem,
} from '../../../shared/types';
import {
  getWebWorkflowTarget,
  getWebWorkflowTargetForSpec,
  getWebWorkflowSystem,
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
  type CandidateSummary,
  type ManagedWorkflowDefinition,
  type WorkflowStep,
} from './workflows/common';
import { runWorkflow, type WorkflowPageAdapter, type WorkflowRunResult } from './workflows/engine';
import {
  EDUFINE_PURCHASE_WORKFLOW_ROUTES,
  EDUFINE_WORKFLOWS,
} from './workflows/edufine';
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
import {
  createApprovalCheckCancelledError,
  throwIfApprovalCheckCancelled,
} from '../approvalMonitor/cancellation';

export interface ResolveWindowsManagedBrowserOptions {
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

export interface WindowsTargetInfo {
  targetId: string;
  type: string;
  url: string;
  title?: string;
  openerId?: string;
}

export type WindowsWorkflowExecutionState =
  | 'IDLE'
  | 'RESTORING_WINDOW'
  | 'ACQUIRING_TARGET'
  | 'CHECKING_AUTH'
  | 'WAITING_FOR_USER'
  | 'NAVIGATING_DUTY_MENU'
  | 'COMPLETED'
  | 'FAILED';

export interface WindowsManagedBrowserSession extends ManagedBrowserSession {
  readonly connection: ManagedBrowserConnection;
  bootstrapTargetId?: string;
  systemTargetIds?: Partial<Record<WebWorkflowSystem, string>>;
  /** Tabs explicitly acquired by the portal Connect action. */
  connectionTargetIds?: Partial<Record<WebWorkflowSystem, string>>;
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
  handle?: number;
}

export interface WindowsWorkflowPage extends WorkflowPageAdapter {
  currentOrigin(): Promise<string>;
  activate(): Promise<void>;
  release?(options?: { keepCreatedTargets?: boolean }): Promise<void>;
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
  closeWxsClientWindow?(id: number): Promise<boolean>;
  focusWindow(id: number): Promise<boolean>;
  confirmStep?(
    request: ManagedWorkflowRequest,
    step: WorkflowStep,
    candidate: CandidateSummary,
  ): Promise<boolean>;
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

export interface WindowsSystemConnectionRequest {
  officeCode: EducationOfficeCode;
  browserId: WebConnectorBrowserId;
  systems: readonly WebWorkflowSystem[];
  foreground?: boolean;
  signal?: AbortSignal;
  diagnose?: WindowsConnectionDiagnosticReporter;
}

export type WindowsSystemConnectionReporter = (
  status: WebSystemConnectionStatus,
) => void;

export interface WindowsConnectionDiagnosticEvent {
  system?: WebWorkflowSystem;
  stepId: string;
  outcome: 'success' | 'failed' | 'cancelled';
  durationMs: number;
  currentUrl?: string;
}

export type WindowsConnectionDiagnosticReporter = (
  event: WindowsConnectionDiagnosticEvent,
) => void | Promise<void>;

function isRecoverableRouteError(error: unknown): boolean {
  return error instanceof Error && /메뉴를 찾지 못했습니다|기대한 화면을 확인하지 못했습니다/.test(
    error.message,
  );
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
  try {
    await connection.protocol.send('Target.setDiscoverTargets', { discover: true });
  } catch {
    // Target.getTargets remains available on older managed Chromium builds.
  }
  let bootstrapTargetId: string | undefined;
  try {
    bootstrapTargetId = readTargetInfos(
      await connection.protocol.send('Target.getTargets', {}),
    ).find(isBootstrapTarget)?.targetId;
  } catch {
    // A target can be created lazily if the browser has not published its first tab yet.
  }
  let closed = false;
  let extensionSweepRunning = false;
  const managedSession: WindowsManagedBrowserSession = {
    officeCode,
    browserId,
    connection,
    bootstrapTargetId,
    systemTargetIds: {},
    connectionTargetIds: {},
    workflowState: 'IDLE',
    isAlive() {
      return !closed && !connection.process.exited && !connection.protocol.isClosed;
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(keepAliveTimer);
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
  const keepAliveTimer = setInterval(() => {
    if (closed || extensionSweepRunning) return;
    extensionSweepRunning = true;
    void extendManagedSystemSessions(managedSession).finally(() => {
      extensionSweepRunning = false;
    });
  }, 15_000);
  keepAliveTimer.unref();
  return managedSession;
}

const RESTART_IN_SYSTEM_TARGET_WORKFLOW_IDS = new Set<WebWorkflowId>([
  'neis-leave',
  'neis-trip',
  'edufine-draft',
  'edufine-purchase',
  'custom',
]);

function systemTargetMap(
  session: WindowsManagedBrowserSession,
): Partial<Record<WebWorkflowSystem, string>> {
  session.systemTargetIds ??= {};
  return session.systemTargetIds;
}

function connectionTargetMap(
  session: WindowsManagedBrowserSession,
): Partial<Record<WebWorkflowSystem, string>> {
  session.connectionTargetIds ??= {};
  return session.connectionTargetIds;
}

export async function resetWindowsWorkflowTargets(
  session: WindowsManagedBrowserSession,
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
): Promise<void> {
  if (!RESTART_IN_SYSTEM_TARGET_WORKFLOW_IDS.has(workflowId)) return;
  const protocol = session.connection.protocol;
  const targets = readTargetInfos(await protocol.send('Target.getTargets', {}));
  const system = requestSystem(workflowId, workflowSpec);
  if (!system) return;
  const connectedTargetId = connectionTargetMap(session)[system];
  const rememberedTargetId = systemTargetMap(session)[system];
  const anchorTarget = [connectedTargetId, rememberedTargetId]
    .filter((targetId): targetId is string => typeof targetId === 'string')
    .map((targetId) => targets.find((target) => target.targetId === targetId))
    .find((target): target is WindowsTargetInfo => Boolean(
      target &&
      target.type === 'page' &&
      workflowTargetAllowed(target.url, session.officeCode, workflowId, workflowSpec),
    ));
  if (anchorTarget) {
    systemTargetMap(session)[system] = anchorTarget.targetId;
    return;
  }
  if (connectedTargetId && !targets.some((target) => target.targetId === connectedTargetId)) {
    delete connectionTargetMap(session)[system];
  }
  delete systemTargetMap(session)[system];
  await findAuthenticatedSystemTarget(session, system);
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
    ? new Map((await dependencies.listWxsClientWindows()).map((window) => [
        `${window.id}:${window.handle ?? 0}`,
        window.title,
      ]))
    : new Map<string, string>();
  let newEditorWindow: WxsClientWindow | undefined;
  let editorWindowChecks = 0;
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
      confirmStep: (step, candidate) => dependencies.confirmStep?.(
        request,
        step,
        candidate,
      ) ?? Promise.resolve(false),
      async checkCurrentState(step) {
        await assertOrigin();
        return page.checkCurrentState?.(step) ?? false;
      },
      async checkPostcondition(step) {
        await assertOrigin();
        const postcondition = step.postcondition;
        if (postcondition.kind !== 'new-window') {
          return page.checkPostcondition(step);
        }
        const windows = await dependencies.listWxsClientWindows();
        editorWindowChecks += 1;
        const matching = windows.filter((window) => window.title.includes(
          postcondition.titleIncludes,
        ));
        const changed = windows.filter((window) => {
          const key = `${window.id}:${window.handle ?? 0}`;
          const previousTitle = existingWindows.get(key);
          return previousTitle === undefined || previousTitle !== window.title;
        });
        newEditorWindow = matching.find((window) => changed.includes(window)) ??
          (editorWindowChecks >= 4 && changed.length === 1 ? changed[0] : undefined) ??
          (editorWindowChecks >= 4 ? matching[0] : undefined) ??
          (editorWindowChecks >= 8 && windows.length === 1 ? windows[0] : undefined);
        return Boolean(newEditorWindow);
      },
      wait: (delayMs) => page.wait(delayMs),
    };
    let result: WorkflowRunResult | undefined;
    if (request.workflowId === 'edufine-purchase') {
      let routeError: unknown;
      for (const [index, route] of EDUFINE_PURCHASE_WORKFLOW_ROUTES.entries()) {
        try {
          result = await runWorkflow(route, guardedPage);
          routeError = undefined;
          break;
        } catch (error) {
          routeError = error;
          if (
            index === EDUFINE_PURCHASE_WORKFLOW_ROUTES.length - 1 ||
            !isRecoverableRouteError(error)
          ) {
            throw error;
          }
        }
      }
      if (routeError) throw routeError;
    } else {
      result = await runWorkflow(definition, guardedPage);
    }
    if (!result) throw new Error('에듀파인 품의 이동 경로를 완료하지 못했습니다. 업무용 브라우저에서 메뉴 권한을 확인해 주세요.');
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
  result?: { value?: unknown; objectId?: unknown; subtype?: unknown };
  exceptionDetails?: unknown;
}

const PAGE_ELEMENT_HELPERS = `
const normalize=(value)=>String(value??'').replace(/\\s+/g,' ').trim();
const textOf=(element)=>normalize(
  element.getAttribute?.('aria-label')||
  element.getAttribute?.('title')||
  ('value' in element?element.value:'')||
  element.innerText||element.textContent||
  Array.from(element.querySelectorAll?.('img[alt]')||[])
    .map(image=>image.getAttribute?.('alt'))
    .filter(Boolean)
    .join(' ')||''
);
const visibleTextOf=(element)=>normalize(element.innerText||element.textContent||'');
const accessibleNameOf=(element)=>normalize(element.getAttribute?.('aria-label'));
const titleTextOf=(element)=>normalize(element.getAttribute?.('title'));
const valueTextOf=(element)=>normalize('value' in element?element.value:'');
const imageAltTextOf=(element)=>normalize(
  [
    String(element.tagName||'').toUpperCase()==='IMG'?element.getAttribute?.('alt'):'',
    ...Array.from(element.querySelectorAll?.('img[alt]')||[])
      .map(image=>image.getAttribute?.('alt'))
  ]
    .filter(Boolean)
    .join(' ')
);
const surfaceTextsOf=(element)=>[
  visibleTextOf(element),
  accessibleNameOf(element),
  titleTextOf(element),
  valueTextOf(element),
  imageAltTextOf(element)
].filter(Boolean);
const surfaceSignatureOf=(element)=>Array.from(new Set(surfaceTextsOf(element).map(normalize)))
  .filter(Boolean)
  .sort()
  .join('\\n');
const contextTextOf=(element)=>{
  const values=[];
  let current=element?.parentElement;
  for(let depth=0;current&&depth<6;depth+=1,current=current.parentElement){
    const tag=String(current.tagName||'').toUpperCase();
    if(tag==='BODY'||tag==='HTML')break;
    const text=visibleTextOf(current);
    if(text&&text.length<=2000)values.push(text);
  }
  return values.join('\\n').slice(0,4000);
};
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
  const inputType=normalize(element.getAttribute?.('type')||element.type).toLowerCase();
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
const items=clickable().slice(0,500);
return items.map(({element,offsetX,offsetY},index)=>{
  const rect=element.getBoundingClientRect();
  const role=normalize(element.getAttribute?.('role')).toLowerCase();
  const tag=String(element.tagName||'').toUpperCase();
  const inputType=normalize(element.getAttribute?.('type')||element.type).toLowerCase();
  const navigation=tag==='A'||role==='link'||role==='menuitem'||role==='tab'||element.getAttribute?.('aria-haspopup')==='menu'||((tag==='BUTTON'||role==='button'||inputType==='button')&&!formAssociated(element));
  const signature=surfaceSignatureOf(element);
  const shadowedByEquivalentDescendant=Boolean(signature)&&items.some(({element:other})=>{
    if(other===element||!element.contains(other))return false;
    const otherRect=other.getBoundingClientRect();
    return Math.abs(rect.left-otherRect.left)<1&&
      Math.abs(rect.top-otherRect.top)<1&&
      Math.abs(rect.width-otherRect.width)<1&&
      Math.abs(rect.height-otherRect.height)<1&&
      signature===surfaceSignatureOf(other);
  });
  return {
    index,
    text:textOf(element),
    visible:visible(element),
    enabled:enabled(element),
    width:rect.width,
    height:rect.height,
    left:offsetX+rect.left,
    top:offsetY+rect.top,
    navigation,
    safeNavigation:safeNavigation(element),
    tag,
    inputType,
    href:normalize(element.getAttribute?.('href')).slice(0,2048),
    formAssociated:formAssociated(element),
    inlineHandler:element.hasAttribute?.('onclick')===true,
    visibleText:visibleTextOf(element).slice(0,500),
    accessibleName:accessibleNameOf(element).slice(0,500),
    titleText:titleTextOf(element).slice(0,500),
    valueText:valueTextOf(element).slice(0,500),
    contextText:contextTextOf(element),
    shadowedByEquivalentDescendant
  };
});
})()`;

function candidateActionExpression(
  index: number,
  expectedText: string,
  domClick: boolean,
  navigationOnly: boolean,
  allowedNavigationOrigin?: string,
  menuOnly = false,
  contextLabels: readonly string[] = [],
  allowActionText = false,
  allowedActionLabels: readonly string[] = [],
): string {
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const item=clickable()[${index}];
if(!item)return {ok:false};
const forbiddenTokens=${JSON.stringify(FORBIDDEN_ACTION_TOKENS)};
const approvedNonActions=new Set(${JSON.stringify([...APPROVED_NON_ACTION_LABELS])});
const allowedActionLabels=new Set(${JSON.stringify(allowedActionLabels)}.map(normalize));
const ownActionTexts=[textOf(item.element),accessibleNameOf(item.element),titleTextOf(item.element),valueTextOf(item.element)].filter(Boolean);
const forbiddenSurface=ownActionTexts.some(text=>{
  const normalized=normalize(text);
  return !approvedNonActions.has(normalized)&&forbiddenTokens.some(token=>normalized.includes(token))&&(!${JSON.stringify(allowActionText)}||!allowedActionLabels.has(normalized));
});
const contextText=normalize(contextTextOf(item.element));
const contextLabels=${JSON.stringify(contextLabels)}.map(normalize);
const contextMatches=contextLabels.length===0||contextLabels.every(label=>contextText.includes(label));
const itemRole=normalize(item.element.getAttribute?.('role')).toLowerCase();
const itemTag=String(item.element.tagName||'').toUpperCase();
const itemInputType=normalize(item.element.getAttribute?.('type')||item.element.type).toLowerCase();
const menuCandidate=(itemTag==='A'||itemRole==='link'||itemRole==='menuitem'||itemRole==='tab'||item.element.getAttribute?.('aria-haspopup')==='menu'||itemTag==='BUTTON'||itemRole==='button'||itemInputType==='button')&&!formAssociated(item.element)&&itemInputType!=='submit'&&itemInputType!=='image';
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
if(textOf(item.element)!==${JSON.stringify(expectedText)}||!visible(item.element)||!enabled(item.element)||!contextMatches||(${JSON.stringify(menuOnly)}&&!menuCandidate)||forbiddenSurface||(${JSON.stringify(navigationOnly)}&&!safeNavigation(item.element)&&!allowedCrossOriginNavigation))return {ok:false};
const rect=item.element.getBoundingClientRect();
${domClick
    ? "item.element.focus?.({preventScroll:false});item.element.click?.();return {ok:true};"
    : 'return {ok:true,x:item.offsetX+rect.left+rect.width/2,y:item.offsetY+rect.top+rect.height/2};'}
})()`;
}

function postconditionExpression(step: WorkflowStep): string {
  const condition = step.postcondition;
  if (condition.kind === 'new-window') return 'false';
  const groups = condition.kind === 'visible-groups'
    ? condition.groups
    : [condition.labels];
  const labels = JSON.stringify(groups.flat());
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const labels=${labels}.map(normalize);
const groups=${JSON.stringify(groups)}.map(group=>group.map(normalize));
const displayedLabelMatches=(value,label)=>{
  if(value===label)return true;
  const compact=(input)=>Array.from(normalize(input).toLowerCase()).filter(char=>!' ·ㆍ:：-_/()[]{}（）'.includes(char)).join('');
  if(compact(value)===compact(label))return true;
  if(!value.startsWith(label))return false;
  const suffix=value.slice(label.length).trim();
  return /^(?:[:：]\\s*)?(?:[([{]\\s*)?\\d{1,4}\\s*(?:건)?\\s*(?:[)\\]}])?$/.test(suffix);
};
const selector=${JSON.stringify(
    condition.kind === 'tab-selected-any'
      ? '[role="tab"][aria-selected="true"],[aria-current="page"],[role="tab"].active,.tab.active,a.active,a.on,a.selected,li.active>a,li.on>a,li.selected>a'
      : condition.kind === 'edufine-mega-menu-any'
        ? '[id*="pdvMegaMenu"],[id*="pdvMegaMenu"] *,[id*="pdvmegamenu"],[id*="pdvmegamenu"] *,[id*="megaMenu"],[id*="megaMenu"] *,[id*="megamenu"],[id*="megamenu"] *'
      : 'h1,h2,h3,label,span,div,button,input,[role="button"],[role="dialog"],[aria-label],[title],[role="tab"]',
  )};
const found=new Set();
for(const {document} of documents){
  if(${JSON.stringify(condition.kind)}==='dialog-title-any'){
    const title=normalize(document.title);
    for(const label of labels){if(displayedLabelMatches(title,label))found.add(label);}
  }
  for(const element of Array.from(document.querySelectorAll(selector))){
    if(!visible(element))continue;
    for(const text of surfaceTextsOf(element)){
      const normalized=normalize(text);
      for(const label of labels){if(displayedLabelMatches(normalized,label))found.add(label);}
    }
  }
}
return ${JSON.stringify(condition.kind)}==='visible-all'
  ? labels.every(label=>found.has(label))
  : ${JSON.stringify(condition.kind)}==='visible-groups'
    ? groups.every(group=>group.some(label=>found.has(label)))
  : found.size>0;
})()`;
}

function edufineCandidateScanExpression(step: WorkflowStep): string {
  const labels = JSON.stringify(step.candidateLabels);
  const interaction = JSON.stringify(step.interaction);
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const labels=${labels}.map(normalize);
const interaction=${interaction};
const displayedLabelMatches=(value,label)=>{
  if(value===label)return true;
  const compact=(input)=>Array.from(normalize(input).toLowerCase()).filter(char=>!' ·ㆍ:：-_/()[]{}（）'.includes(char)).join('');
  if(compact(value)===compact(label))return true;
  if(!value.startsWith(label))return false;
  const suffix=value.slice(label.length).trim();
  return /^(?:[:：]\\s*)?(?:[([{]\\s*)?\\d{1,4}\\s*(?:건)?\\s*(?:[)\\]}])?$/.test(suffix);
};
const summary=(element,index,text,tag,offsetX=0,offsetY=0)=>{
  const rect=element?.getBoundingClientRect?.()??{width:1,height:1,left:0,top:0};
  return {
    index,text,visible:element?visible(element):true,enabled:element?enabled(element):true,
    width:Math.max(1,Number(rect.width)||0),height:Math.max(1,Number(rect.height)||0),
    left:offsetX+(Number(rect.left)||0),top:offsetY+(Number(rect.top)||0),navigation:true,safeNavigation:true,
    tag,inputType:'',href:'',formAssociated:false,inlineHandler:false,
    visibleText:text,accessibleName:'',titleText:'',valueText:'',contextText:'',
    shadowedByEquivalentDescendant:false
  };
};
const located=(element)=>{
  if(!element)return null;
  const owner=documents.find(({document})=>document===element.ownerDocument);
  return {element,offsetX:owner?.offsetX||0,offsetY:owner?.offsetY||0};
};
if(interaction==='edufine-job'){
  const application=globalThis.nexacro?.getApplication?.()||globalThis.application;
  const combo=application?.mainframe?.MainVFrameSet?.TopFrame?.form?.cboJobList;
  const dataset=combo?.getInnerDataset?.()||combo?._innerdataset;
  const input=document.querySelector("[id$='cboJobList.comboedit:input']");
  if(!combo||!dataset||!input||typeof dataset.getRowCount!=='function')return [];
  const dataColumn=combo.datacolumn||'menuNm';
  const result=[];
  for(let row=0;row<dataset.getRowCount();row+=1){
    const name=normalize(dataset.getColumn(row,dataColumn));
    if(labels.includes(name))result.push(summary(input,row,name,'NEXACRO-COMBO'));
  }
  return result;
}
const jobCombo=()=>documents.map(({document})=>{
  const view=document.defaultView;
  const application=view?.nexacro?.getApplication?.()||view?.application;
  return application?.mainframe?.MainVFrameSet?.TopFrame?.form?.cboJobList||
    application?.mainframe?.mainframe?.TopFrame?.form?.cboJobList;
}).find(Boolean)||null;
const jobInput=()=>documents.flatMap(({document})=>
  Array.from(document.querySelectorAll(
    "[id$='cboJobList.comboedit:input'],input[id*='cboJobList'],[id*='cboJobList'] input,[id*='cboJobList'][role='combobox']"
  ))
).find(element=>visible(element))||jobCombo()?._input_element?.handle||
  jobCombo()?._control_element?.handle?.querySelector?.('input')||null;
const jobToggle=()=>{
  const input=jobInput();
  const controls=documents.flatMap(({document})=>Array.from(document.querySelectorAll(
    "[id*='cboJobList'][id*='dropbutton'],[id*='cboJobList'][id$=':button'],[id*='cboJobList'][role='button'],[id*='cboJobList'] button,[aria-controls*='cboJobList']"
  ))).filter(element=>visible(element)&&enabled(element));
  return located(controls.find(element=>String(element.id||'').endsWith('dropbutton'))||
    controls.find(element=>String(element.id||'').includes('dropbutton'))||input);
};
const jobOption=(label)=>{
  const matches=documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll(
    "[id*='cboJobList'],[id*='ComboPopup'],[id*='combolist'],[role='option']"
  )).map(element=>({element,offsetX,offsetY}))).filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),label))&&visible(element)&&enabled(element));
  return matches.find(({element})=>String(element.id||'').endsWith(':text'))||
    matches.sort((left,right)=>left.element.children.length-right.element.children.length)[0]||null;
};
if(interaction==='edufine-job-toggle'){
  const match=jobToggle();
  return match?[summary(match.element,0,labels[0]||'업무관리','NEXACRO-JOB-TOGGLE',match.offsetX,match.offsetY)]:[];
}
if(interaction==='edufine-job-option'){
  return labels.flatMap((label,index)=>{
    const match=jobOption(label);
    return match?[summary(match.element,index,label,'NEXACRO-JOB-OPTION',match.offsetX,match.offsetY)]:[];
  });
}
const choose=(selector,label,preferred)=>{
  const matches=documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll(selector))
    .map(element=>({element,offsetX,offsetY})))
    .filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),label))&&visible(element)&&enabled(element));
  const preferredMatch=matches.find(({element})=>String(element.id||'').endsWith(preferred))||matches.at(-1);
  if(preferredMatch)return preferredMatch;
  const fallback=documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll(
    'a,button,[role="button"],[role="menuitem"],[role="tab"],[onclick],[id*="btnMenu"],[id*="MegaMenu"],[id*="megaMenu"]'
  )).map(element=>({element,offsetX,offsetY}))).filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),label))&&visible(element)&&enabled(element));
  return fallback.sort((left,right)=>left.element.children.length-right.element.children.length)[0]||null;
};
const leftMenuMatch=(label)=>{
  const marker=/leftframe|leftmenu|left_menu|lnb|sidemenu|side_menu|workmenu|work_menu|navmenu|nav_menu|treemenu|tree_menu/;
  const excluded=/topframe|topmenu|top_menu|pdvmegamenu|megamenu|mega_menu/;
  return documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll('*'))
    .map(element=>({element,offsetX,offsetY})))
    .filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),label))&&visible(element)&&enabled(element))
    .map((entry)=>{
      const {element,offsetX,offsetY}=entry;
      const rect=element.getBoundingClientRect();
      const ancestry=[];
      for(let current=element,depth=0;current&&depth<7;current=current.parentElement,depth+=1){
        ancestry.push((String(current.id||'')+' '+String(current.className||'')+' '+String(current.getAttribute?.('role')||'')).toLowerCase());
      }
      const signal=ancestry.join(' ');
      if(excluded.test(signal))return null;
      const width=Math.max(1,Number(element.ownerDocument?.defaultView?.innerWidth)||1920);
      const globalLeft=offsetX+rect.left;
      const globalTop=offsetY+rect.top;
      const explicit=marker.test(signal);
      const leftPosition=globalLeft<=Math.max(360,width*0.34)&&globalTop>=40;
      if(!explicit&&!leftPosition)return null;
      const clickable=element.closest?.('a,button,[role="button"],[role="menuitem"],[onclick]')||element.parentElement||element;
      if(!visible(clickable)||!enabled(clickable))return null;
      return {...entry,element:clickable,score:(explicit?200:0)+(leftPosition?80:0)+(clickable!==element?20:0)-Math.min(20,element.children.length)};
    })
    .filter(Boolean)
    .sort((left,right)=>right.score-left.score||left.element.children.length-right.element.children.length)[0]||null;
};
const leftToggleMatch=(label)=>{
  const menu=leftMenuMatch(label);
  if(!menu)return null;
  const scope=menu.element.closest?.('[role="treeitem"],li,[id*="menu"],[id*="Menu"],[class*="menu"],[class*="Menu"]')||menu.element.parentElement;
  if(!scope)return menu;
  const controls=[scope,...Array.from(scope.querySelectorAll?.(
    'button,[role="button"],[aria-expanded],[id*="toggle"],[id*="Toggle"],[id*="expand"],[id*="Expand"],[class*="toggle"],[class*="Toggle"],[class*="expand"],[class*="Expand"],[title],[aria-label]'
  )||[])].filter((element,index,array)=>array.indexOf(element)===index&&visible(element)&&enabled(element));
  const ranked=controls.map((element)=>{
    const signal=[element.id,element.className,element.getAttribute?.('title'),element.getAttribute?.('aria-label'),element.getAttribute?.('aria-expanded'),textOf(element)]
      .map(value=>normalize(value).toLowerCase()).join(' ');
    const explicit=/toggle|expand|collapsed|plus|open|펼치|열기|\\+/.test(signal);
    const collapsed=element.getAttribute?.('aria-expanded')==='false';
    return {element,score:(collapsed?200:0)+(explicit?120:0)+(element===scope?10:0)};
  }).sort((left,right)=>right.score-left.score);
  return ranked[0]?.score>10?{...menu,element:ranked[0].element}:menu;
};
if(interaction==='edufine-left-toggle'){
  return labels.flatMap((label,index)=>{
    const match=leftToggleMatch(label);
    return match?[summary(match.element,index,label,'NEXACRO-LEFT-TOGGLE',match.offsetX,match.offsetY)]:[];
  });
}
if(interaction==='edufine-left-menu'){
  return labels.flatMap((label,index)=>{
    const match=leftMenuMatch(label);
    return match?[summary(match.element,index,label,'NEXACRO-LEFT-MENU',match.offsetX,match.offsetY)]:[];
  });
}
if(interaction==='edufine-top-menu'){
  return labels.flatMap((label,index)=>{
    const match=choose('[id*="TopFrame"][id*="btnMenu_"],[id*="topframe"][id*="btnmenu_"]',label,':icontext');
    return match?[summary(match.element,index,label,'NEXACRO-TOP-MENU',match.offsetX,match.offsetY)]:[];
  });
}
if(interaction==='edufine-mega-menu'){
  return labels.flatMap((label,index)=>{
    const match=choose('[id*="pdvMegaMenu"],[id*="pdvmegamenu"],[id*="megaMenu"],[id*="megamenu"]',label,':text');
    return match?[summary(match.element,index,label,'NEXACRO-MEGA-MENU',match.offsetX,match.offsetY)]:[];
  });
}
if(interaction==='edufine-exact-text'||interaction==='frame-exact-text'){
  return labels.flatMap((label,index)=>{
    const matches=documents.flatMap(({document,offsetX,offsetY})=>
      Array.from(document.querySelectorAll('*')).map(element=>({element,offsetX,offsetY}))
    ).filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),label))&&visible(element)&&enabled(element))
      .sort((left,right)=>left.element.children.length-right.element.children.length);
    const exact=matches[0];
    if(!exact)return [];
    const {offsetX,offsetY}=exact;
    const exactElement=exact.element;
    const element=exactElement.closest?.('a,button')||exactElement;
    return element&&visible(element)?[summary(element,index,label,'EXACT-TEXT',offsetX,offsetY)]:[];
  });
}
return [];
})()`;
}

function candidateScanExpression(step: WorkflowStep): string {
  return step.interaction?.startsWith('edufine-') || step.interaction === 'frame-exact-text'
    ? edufineCandidateScanExpression(step)
    : CANDIDATE_SCAN_EXPRESSION;
}

function edufineCandidateActionExpression(
  interaction: WorkflowStep['interaction'],
  expectedText: string,
  allowActionText: boolean,
  allowedActionLabels: readonly string[],
  returnElement = false,
): string {
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const wanted=${JSON.stringify(expectedText)};
const interaction=${JSON.stringify(interaction)};
const returnElement=${JSON.stringify(returnElement)};
const forbiddenTokens=${JSON.stringify(FORBIDDEN_ACTION_TOKENS)};
const approvedNonActions=new Set(${JSON.stringify([...APPROVED_NON_ACTION_LABELS])});
const allowedActionLabels=new Set(${JSON.stringify(allowedActionLabels)}.map(normalize));
const normalizedWanted=normalize(wanted);
const displayedLabelMatches=(value,label)=>{
  if(value===label)return true;
  const compact=(input)=>Array.from(normalize(input).toLowerCase()).filter(char=>!' ·ㆍ:：-_/()[]{}（）'.includes(char)).join('');
  if(compact(value)===compact(label))return true;
  if(!value.startsWith(label))return false;
  const suffix=value.slice(label.length).trim();
  return /^(?:[:：]\\s*)?(?:[([{]\\s*)?\\d{1,4}\\s*(?:건)?\\s*(?:[)\\]}])?$/.test(suffix);
};
const forbidden=forbiddenTokens.some(token=>normalizedWanted.includes(token))&&
  !approvedNonActions.has(normalizedWanted)&&
  (!${JSON.stringify(allowActionText)}||!allowedActionLabels.has(normalizedWanted));
if(forbidden)return returnElement?null:{ok:false};
if(interaction==='edufine-job'){
  const application=globalThis.nexacro?.getApplication?.()||globalThis.application;
  const combo=application?.mainframe?.MainVFrameSet?.TopFrame?.form?.cboJobList;
  const dataset=combo?.getInnerDataset?.()||combo?._innerdataset;
  if(!combo||!dataset||typeof combo._on_value_change!=='function'||typeof dataset.getRowCount!=='function')return {ok:false};
  const dataColumn=combo.datacolumn||'menuNm',codeColumn=combo.codecolumn||'menuId';
  let targetIndex=-1;
  for(let row=0;row<dataset.getRowCount();row+=1){
    if(normalize(dataset.getColumn(row,dataColumn))===wanted){targetIndex=row;break;}
  }
  if(targetIndex<0)return {ok:false};
  const postText=normalize(dataset.getColumn(targetIndex,dataColumn));
  const postValue=dataset.getColumn(targetIndex,codeColumn);
  const changed=combo._on_value_change(combo.index,combo.text,combo.value,targetIndex,postText,postValue);
  combo.redraw?.();
  return {ok:changed!==false,direct:true};
}
const jobCombo=()=>documents.map(({document})=>{
  const view=document.defaultView;
  const application=view?.nexacro?.getApplication?.()||view?.application;
  return application?.mainframe?.MainVFrameSet?.TopFrame?.form?.cboJobList||
    application?.mainframe?.mainframe?.TopFrame?.form?.cboJobList;
}).find(Boolean)||null;
const located=(element)=>{
  if(!element)return null;
  const owner=documents.find(({document})=>document===element.ownerDocument);
  return {element,offsetX:owner?.offsetX||0,offsetY:owner?.offsetY||0};
};
const jobInput=()=>documents.flatMap(({document})=>
  Array.from(document.querySelectorAll(
    "[id$='cboJobList.comboedit:input'],input[id*='cboJobList'],[id*='cboJobList'] input,[id*='cboJobList'][role='combobox']"
  ))
).find(element=>visible(element))||jobCombo()?._input_element?.handle||
  jobCombo()?._control_element?.handle?.querySelector?.('input')||null;
const jobToggle=()=>{
  const input=jobInput();
  const controls=documents.flatMap(({document})=>Array.from(document.querySelectorAll(
    "[id*='cboJobList'][id*='dropbutton'],[id*='cboJobList'][id$=':button'],[id*='cboJobList'][role='button'],[id*='cboJobList'] button,[aria-controls*='cboJobList']"
  ))).filter(element=>visible(element)&&enabled(element));
  return located(controls.find(element=>String(element.id||'').endsWith('dropbutton'))||
    controls.find(element=>String(element.id||'').includes('dropbutton'))||input);
};
const jobOption=()=>{
  const matches=documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll(
    "[id*='cboJobList'],[id*='ComboPopup'],[id*='combolist'],[role='option']"
  )).map(element=>({element,offsetX,offsetY}))).filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),normalizedWanted))&&visible(element)&&enabled(element));
  return matches.find(({element})=>String(element.id||'').endsWith(':text'))||
    matches.sort((left,right)=>left.element.children.length-right.element.children.length)[0]||null;
};
if(interaction==='edufine-job-toggle'||interaction==='edufine-job-option'){
  const match=interaction==='edufine-job-toggle'
    ? jobToggle()
    : interaction==='edufine-job-option'?jobOption():null;
  if(!match)return returnElement?null:{ok:false};
  if(returnElement)return match.element;
  const rect=match.element.getBoundingClientRect();
  return {ok:true,x:match.offsetX+rect.left+rect.width/2,y:match.offsetY+rect.top+rect.height/2};
}
const choose=(selector,preferred)=>{
  const matches=documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll(selector))
    .map(element=>({element,offsetX,offsetY})))
    .filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),normalizedWanted))&&visible(element)&&enabled(element));
  const preferredMatch=matches.find(({element})=>String(element.id||'').endsWith(preferred))||matches.at(-1);
  if(preferredMatch)return preferredMatch;
  const fallback=documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll(
    'a,button,[role="button"],[role="menuitem"],[role="tab"],[onclick],[id*="btnMenu"],[id*="MegaMenu"],[id*="megaMenu"]'
  )).map(element=>({element,offsetX,offsetY}))).filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),normalizedWanted))&&visible(element)&&enabled(element));
  return fallback.sort((left,right)=>left.element.children.length-right.element.children.length)[0]||null;
};
const leftMenuMatch=()=>{
  const marker=/leftframe|leftmenu|left_menu|lnb|sidemenu|side_menu|workmenu|work_menu|navmenu|nav_menu|treemenu|tree_menu/;
  const excluded=/topframe|topmenu|top_menu|pdvmegamenu|megamenu|mega_menu/;
  return documents.flatMap(({document,offsetX,offsetY})=>Array.from(document.querySelectorAll('*'))
    .map(element=>({element,offsetX,offsetY})))
    .filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),normalizedWanted))&&visible(element)&&enabled(element))
    .map((entry)=>{
      const {element,offsetX,offsetY}=entry;
      const rect=element.getBoundingClientRect();
      const ancestry=[];
      for(let current=element,depth=0;current&&depth<7;current=current.parentElement,depth+=1){
        ancestry.push((String(current.id||'')+' '+String(current.className||'')+' '+String(current.getAttribute?.('role')||'')).toLowerCase());
      }
      const signal=ancestry.join(' ');
      if(excluded.test(signal))return null;
      const width=Math.max(1,Number(element.ownerDocument?.defaultView?.innerWidth)||1920);
      const globalLeft=offsetX+rect.left;
      const globalTop=offsetY+rect.top;
      const explicit=marker.test(signal);
      const leftPosition=globalLeft<=Math.max(360,width*0.34)&&globalTop>=40;
      if(!explicit&&!leftPosition)return null;
      const clickable=element.closest?.('a,button,[role="button"],[role="menuitem"],[onclick]')||element.parentElement||element;
      if(!visible(clickable)||!enabled(clickable))return null;
      return {...entry,element:clickable,score:(explicit?200:0)+(leftPosition?80:0)+(clickable!==element?20:0)-Math.min(20,element.children.length)};
    })
    .filter(Boolean)
    .sort((left,right)=>right.score-left.score||left.element.children.length-right.element.children.length)[0]||null;
};
const leftToggleMatch=()=>{
  const menu=leftMenuMatch();
  if(!menu)return null;
  const scope=menu.element.closest?.('[role="treeitem"],li,[id*="menu"],[id*="Menu"],[class*="menu"],[class*="Menu"]')||menu.element.parentElement;
  if(!scope)return menu;
  const controls=[scope,...Array.from(scope.querySelectorAll?.(
    'button,[role="button"],[aria-expanded],[id*="toggle"],[id*="Toggle"],[id*="expand"],[id*="Expand"],[class*="toggle"],[class*="Toggle"],[class*="expand"],[class*="Expand"],[title],[aria-label]'
  )||[])].filter((element,index,array)=>array.indexOf(element)===index&&visible(element)&&enabled(element));
  const ranked=controls.map((element)=>{
    const signal=[element.id,element.className,element.getAttribute?.('title'),element.getAttribute?.('aria-label'),element.getAttribute?.('aria-expanded'),textOf(element)]
      .map(value=>normalize(value).toLowerCase()).join(' ');
    const explicit=/toggle|expand|collapsed|plus|open|펼치|열기|\\+/.test(signal);
    const collapsed=element.getAttribute?.('aria-expanded')==='false';
    return {element,score:(collapsed?200:0)+(explicit?120:0)+(element===scope?10:0)};
  }).sort((left,right)=>right.score-left.score);
  return ranked[0]?.score>10?{...menu,element:ranked[0].element}:menu;
};
if(interaction==='edufine-left-toggle'||interaction==='edufine-left-menu'||interaction==='edufine-top-menu'||interaction==='edufine-mega-menu'){
  const match=interaction==='edufine-left-toggle'
    ? leftToggleMatch()
    : interaction==='edufine-left-menu'
      ? leftMenuMatch()
    : interaction==='edufine-top-menu'
      ? choose('[id*="TopFrame"][id*="btnMenu_"],[id*="topframe"][id*="btnmenu_"]',':icontext')
      : choose('[id*="pdvMegaMenu"],[id*="pdvmegamenu"],[id*="megaMenu"],[id*="megamenu"]',':text');
  if(!match)return returnElement?null:{ok:false};
  if(returnElement)return match.element;
  const rect=match.element.getBoundingClientRect();
  return {ok:true,x:match.offsetX+rect.left+rect.width/2,y:match.offsetY+rect.top+rect.height/2};
}
if(interaction==='edufine-exact-text'||interaction==='frame-exact-text'){
  const matches=documents.flatMap(({document,offsetX,offsetY})=>
    Array.from(document.querySelectorAll('*')).map(element=>({element,offsetX,offsetY}))
  ).filter(({element})=>surfaceTextsOf(element).some(text=>displayedLabelMatches(normalize(text),normalizedWanted))&&visible(element)&&enabled(element))
    .sort((left,right)=>left.element.children.length-right.element.children.length);
  const exact=matches[0];
  if(!exact)return returnElement?null:{ok:false};
  const {offsetX,offsetY}=exact;
  const exactElement=exact.element;
  const element=exactElement.closest?.('a,button')||exactElement;
  if(!element||!visible(element))return returnElement?null:{ok:false};
  if(returnElement)return element;
  if(interaction==='frame-exact-text'){
    const rect=element.getBoundingClientRect();
    return {ok:true,x:offsetX+rect.left+rect.width/2,y:offsetY+rect.top+rect.height/2};
  }
  element.focus?.({preventScroll:false});
  element.click?.();
  return {ok:true,direct:true};
}
return {ok:false};
})()`;
}

const SESSION_EXTENSION_EXPRESSION = `(()=>{
${PAGE_ELEMENT_HELPERS}
const allowedLabels=new Set([
  '연장','시간연장','시간 연장','사용시간연장','사용시간 연장','사용 시간 연장',
  '세션연장','세션 연장','계속사용','계속 사용'
].map(normalize));
const contextTokens=['세션','사용시간','사용 시간','로그인 시간','자동 로그아웃','접속 종료','시간이 만료'];
const candidates=documents.flatMap(({document,offsetX,offsetY})=>{
  const exactIds=Array.from(document.querySelectorAll("[id$='btnUseTimeExtn']"));
  const labelled=Array.from(document.querySelectorAll('button,input[type="button"],[role="button"],a')).filter(element=>{
    if(!allowedLabels.has(textOf(element)))return false;
    const context=element.closest?.('[role="dialog"],dialog,.popup,.modal,[class*="popup"],[class*="modal"]')||element.parentElement;
    const contextText=normalize(context?.innerText||context?.textContent||'');
    return contextTokens.some(token=>contextText.includes(token));
  });
  return [...exactIds,...labelled].map(element=>({element,offsetX,offsetY}));
}).filter((candidate,index,all)=>
  all.findIndex(other=>other.element===candidate.element)===index&&
  visible(candidate.element)&&enabled(candidate.element)
);
const primary=candidates.filter(({element})=>element.classList?.contains('btn-primary'));
const eligible=primary.length>0?primary:candidates;
if(eligible.length!==1)return {handled:false};
const {element,offsetX,offsetY}=eligible[0];
const rect=element.getBoundingClientRect();
return {
  handled:true,
  x:offsetX+rect.left+rect.width/2,
  y:offsetY+rect.top+rect.height/2
};
})()`;

function activeWorkFormExpression(system: WebWorkflowSystem): string {
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const activeWorkSystem=${JSON.stringify(system)};
const texts=documents.flatMap(({document})=>Array.from(document.querySelectorAll(
  'h1,h2,h3,label,span,div,[aria-label],[title]'
))).filter(visible).flatMap(surfaceTextsOf).map(normalize);
const has=(labels)=>labels.some(label=>texts.some(text=>text===label));
const editable=documents.flatMap(({document})=>Array.from(document.querySelectorAll(
  'input:not([type="hidden"]),textarea,select,[contenteditable="true"]'
))).filter(element=>visible(element)&&enabled(element));
if(editable.length===0)return false;
if(activeWorkSystem==='neis'){
  return has(['근무상황신청','개인근무상황신청','출장신청']);
}
return has(['품의등록','품의 등록'])&&
  has(['기본정보','제목','개요','예산내역','품목내역']);
})()`;
}

function approvalCounterExpression(system: WebWorkflowSystem): string {
  const labels = system === 'neis'
    ? ['Total', 'TOTAL', 'total']
    : ['총', 'Total', 'TOTAL', 'total'];
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const approvalSystem=${JSON.stringify(system)};
const approvalHeaderGroups=approvalSystem==='edufine'
  ? [['문서번호'],['문서제목','제목','문서명'],['기안자'],['기안부서'],['기안일자'],['결재상태']]
  : [['문서번호'],['제목'],['기안자'],['신청자']];
const requiredHeaderMatches=approvalSystem==='edufine'?2:1;
const screenLabels=approvalSystem==='edufine'
  ? ['결재대기','결재 대기']
  : ['미결/협조함','미결 / 협조함'];
const displayedLabelMatches=(value,label)=>{
  if(value===label)return true;
  const compact=(input)=>Array.from(normalize(input).toLowerCase()).filter(char=>!' ·ㆍ:：-_/()[]{}（）'.includes(char)).join('');
  if(compact(value)===compact(label))return true;
  if(!value.startsWith(label))return false;
  const suffix=value.slice(label.length).trim();
  return /^(?:[:：]\\s*)?(?:[([{]\\s*)?\\d{1,4}\\s*(?:건)?\\s*(?:[)\\]}])?$/.test(suffix);
};
const labels=${JSON.stringify(labels)}.map(value=>normalize(value).replace(/\\s+/g,''));
const matchesLabel=(value,label)=>{
  const compact=normalize(value).replace(/\\s+/g,'');
  if(label==='총'){
    const remainder=compact.slice(label.length);
    return compact===label||(compact.startsWith(label)&&/^(?:[:：·]|[([{]|\\d)/.test(remainder));
  }
  return compact.includes(label);
};
const signal=(element)=>({
  text:normalize(element?.innerText||element?.textContent||'').slice(0,256),
  ariaLabel:normalize(element?.getAttribute?.('aria-label')).slice(0,256),
  title:normalize(element?.getAttribute?.('title')).slice(0,256),
  className:normalize(element?.className?.baseVal??element?.className).slice(0,256),
  role:normalize(element?.getAttribute?.('role')).toLowerCase().slice(0,64)
});
const candidates=[];
const rowCounts=[];
let emptyList=false;
const screenMarkerVisible=documents.some(({document})=>
  Array.from(document.querySelectorAll('h1,h2,h3,label,span,div,a,button,[role="tab"],[role="menuitem"],[aria-label],[title]')).slice(0,5000).some(element=>
    visible(element)&&surfaceTextsOf(element).some(text=>screenLabels.some(label=>displayedLabelMatches(normalize(text),normalize(label))))
  )
);
for(const {document} of documents){
  const elements=Array.from(document.querySelectorAll('[aria-label],[title],span,em,strong,b,a,button,div,td,th')).slice(0,5000);
  for(const element of elements){
    if(!visible(element))continue;
    const candidate=signal(element);
    const children=Array.from(element.children||[]).slice(0,16).filter(visible).map(signal);
    const previous=element.previousElementSibling&&visible(element.previousElementSibling)
      ? signal(element.previousElementSibling)
      : undefined;
    const next=element.nextElementSibling&&visible(element.nextElementSibling)
      ? signal(element.nextElementSibling)
      : undefined;
    const parentText=normalize(element.parentElement?.innerText||element.parentElement?.textContent||'');
    const parent=element.parentElement&&parentText.length<=160&&visible(element.parentElement)
      ? signal(element.parentElement)
      : undefined;
    const values=[candidate.text,candidate.ariaLabel,candidate.title,...children.flatMap(child=>[child.text,child.ariaLabel,child.title]),...(previous?[previous.text,previous.ariaLabel,previous.title]:[]),...(next?[next.text,next.ariaLabel,next.title]:[]),...(parent?[parent.text,parent.ariaLabel,parent.title]:[])];
    if(!values.some(value=>labels.some(label=>matchesLabel(value,label))))continue;
    candidates.push({...candidate,children,...(previous?{previous}:{}),...(next?{next}:{}),...(parent?{parent}:{})});
    if(candidates.length>=100)break;
  }
  const containers=Array.from(document.querySelectorAll('table,[role="grid"],[role="table"]')).filter(visible).slice(0,50);
  for(const container of containers){
    const semanticRows=Array.from(container.querySelectorAll('tbody>tr,[role="row"]')).filter(row=>{
      if(!visible(row))return false;
      if(row.querySelector?.('th,[role="columnheader"]'))return false;
      const text=normalize(row.innerText||row.textContent||'');
      if(!text||/^(조회|검색)?된?\\s*(자료|데이터|문서|목록).*(없습니다|없음)|^내역이\\s*없습니다/.test(text))return false;
      return Boolean(row.querySelector?.('td,[role="gridcell"],[role="cell"]'));
    });
    const rect=container.getBoundingClientRect();
    const headerText=normalize(Array.from(container.querySelectorAll('th,[role="columnheader"]')).map(element=>element.innerText||element.textContent||'').join(' '));
    const headerMatches=approvalHeaderGroups.filter(group=>group.some(label=>headerText.includes(label))).length;
    const headerRelevant=headerMatches>=requiredHeaderMatches;
    if(semanticRows.length>0||headerRelevant){
      rowCounts.push({
        count:semanticRows.length,
        area:Math.max(0,Math.round(rect.width*rect.height)),
        relevant:headerRelevant,
        source:'dom'
      });
    }
  }
  const emptyElements=Array.from(document.querySelectorAll('td,[role="gridcell"],[role="cell"],.empty,.no-data')).filter(visible).slice(0,500);
  if(emptyElements.some(element=>{
    const text=normalize(element.innerText||element.textContent||'');
    return text.length<=120&&(
      /(조회|검색)?된?\\s*(자료|데이터|문서|목록|내역).*(없습니다|없음)/.test(text)||
      /(조회|검색)\\s*(결과|내역).*(없습니다|없음|0건)/.test(text)||
      /데이터가?\\s*존재하지\\s*않/.test(text)||
      /no\\s*(data|rows?)/i.test(text)
    );
  }))emptyList=true;
  try{
    const view=document.defaultView;
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
    const visitComponent=(component,depth=0)=>{
      if(!component||typeof component!=='object'||depth>24||seen.has(component))return;
      seen.add(component);
      if(component.visible===false||(typeof component._isVisible==='function'&&component._isVisible()===false))return;
      const type=normalize(component._type_name||component._classname||component.constructor?.name);
      if(/grid/i.test(type)){
        const dataset=component.getBindDataset?.()||component._binddataset;
        const count=Number(dataset?.getRowCount?.());
        const headCount=Math.min(Number(component.getCellCount?.('head'))||0,100);
        const handle=component._control_element?.handle;
        const propertyHeaderText=Array.from({length:headCount},(_,index)=>(
          component.getCellProperty?.('head',index,'text')||component.getCellText?.(-1,index)||''
        )).join(' ');
        const renderedHeaderText=handle?.querySelectorAll
          ? Array.from(handle.querySelectorAll('[id*="head"],th,[role="columnheader"]')).slice(0,100)
              .map(element=>element.innerText||element.textContent||'').join(' ')
          : '';
        const headerText=normalize(propertyHeaderText+' '+renderedHeaderText);
        const headerMatches=approvalHeaderGroups.filter(group=>group.some(label=>headerText.includes(label))).length;
        const rect=handle?.getBoundingClientRect?.();
        const width=Number(rect?.width)||Number(component.getOffsetWidth?.())||Number(component._adjust_width)||0;
        const height=Number(rect?.height)||Number(component.getOffsetHeight?.())||Number(component._adjust_height)||0;
        const area=Math.max(0,Math.round(width*height));
        const handleVisible=!handle||visible(handle);
        // A visible "결재대기" label only proves which screen is open. It must
        // never turn page-size combos such as "전체 100" into approval lists.
        const relevant=headerMatches>=requiredHeaderMatches;
        if(Number.isSafeInteger(count)&&count>=0&&count<=9999&&area>0&&headCount>=2&&handleVisible){
          rowCounts.push({count,area,relevant,source:'nexacro'});
        }
      }
      for(const collection of [component.components,component.frames,component.all]){
        for(const item of collectionItems(collection))visitComponent(item,depth+1);
      }
      for(const child of [component.form,component.frame,component.mainframe,component.childframe]){
        visitComponent(child,depth+1);
      }
    };
    for(const root of roots)visitComponent(root);
  }catch{}
}
const listReady=rowCounts.some(candidate=>candidate.relevant)||(emptyList&&screenMarkerVisible);
rowCounts.sort((left,right)=>Number(right.relevant)-Number(left.relevant)||right.area-left.area);
return {candidates:candidates.slice(0,100),rowCounts:rowCounts.slice(0,50),emptyList,listReady};
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

async function extendSystemSessionIfPrompted(
  session: WindowsManagedBrowserSession,
  sessionId: string,
): Promise<boolean> {
  try {
    const result = await evaluateValue<{ handled?: unknown; x?: unknown; y?: unknown }>(
      session,
      sessionId,
      SESSION_EXTENSION_EXPRESSION,
      true,
    );
    if (
      result?.handled !== true ||
      typeof result.x !== 'number' ||
      typeof result.y !== 'number'
    ) return false;
    await dispatchCdpMouseClick(session, sessionId, result.x, result.y);
    return true;
  } catch {
    // A cross-origin frame or a document reload can make the prompt unavailable briefly.
    return false;
  }
}

async function dispatchCdpMouseClick(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  x: number,
  y: number,
): Promise<void> {
  const protocol = session.connection.protocol;
  await protocol.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y,
  }, sessionId);
  await protocol.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  }, sessionId);
  await protocol.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  }, sessionId);
}

async function extendManagedSystemSessions(
  session: WindowsManagedBrowserSession,
): Promise<void> {
  if (!session.isAlive()) return;
  const office = getEducationOffice(session.officeCode);
  const allowedOrigins = new Set([
    new URL(office.portalUrl).origin,
    new URL(office.neisUrl).origin,
    new URL(office.edufineUrl).origin,
  ]);
  let targets: WindowsTargetInfo[];
  try {
    targets = readTargetInfos(
      await session.connection.protocol.send('Target.getTargets', {}),
    ).filter((target) => {
      if (target.type !== 'page') return false;
      try {
        return allowedOrigins.has(new URL(target.url).origin);
      } catch {
        return false;
      }
    });
  } catch {
    return;
  }
  for (const target of targets) {
    let attachedSessionId: string | undefined;
    try {
      const attached = await session.connection.protocol.send<{ sessionId?: unknown }>(
        'Target.attachToTarget',
        { targetId: target.targetId, flatten: true },
      );
      if (typeof attached.sessionId !== 'string') continue;
      attachedSessionId = attached.sessionId;
      await extendSystemSessionIfPrompted(session, attachedSessionId);
    } catch {
      // A page can reload or close while the safe session-extension sweep is running.
    } finally {
      if (attachedSessionId) {
        try {
          await session.connection.protocol.send('Target.detachFromTarget', {
            sessionId: attachedSessionId,
          });
        } catch {
          // The target may already be detached after a navigation.
        }
      }
    }
  }
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
      (candidate.left !== undefined && typeof candidate.left !== 'number') ||
      (candidate.top !== undefined && typeof candidate.top !== 'number') ||
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
      || (
        candidate.contextText !== undefined &&
        (typeof candidate.contextText !== 'string' || candidate.contextText.length > 4_000)
      )
      || (
        candidate.shadowedByEquivalentDescendant !== undefined &&
        typeof candidate.shadowedByEquivalentDescendant !== 'boolean'
      )
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
      left: typeof candidate.left === 'number' ? candidate.left : undefined,
      top: typeof candidate.top === 'number' ? candidate.top : undefined,
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
      contextText: typeof candidate.contextText === 'string' ? candidate.contextText : '',
      shadowedByEquivalentDescendant: candidate.shadowedByEquivalentDescendant === true,
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
      ...(typeof target.openerId === 'string' ? { openerId: target.openerId } : {}),
    }];
  });
}

interface AttachedWindowsTarget {
  target: WindowsTargetInfo;
  sessionId: string;
}

interface WorkflowTargetOptions {
  background?: boolean;
  cloneExistingTargetUrl?: boolean;
  closeCreatedTargetOnRelease?: boolean;
  failFastOnLoginRequired?: boolean;
  forceNewTarget?: boolean;
  keepCreatedTargetOnFailure?: boolean;
  navigateExistingTarget?: boolean;
  /** Recreate an expired system session through the authenticated office portal. */
  recoverViaPortal?: boolean;
  signal?: AbortSignal;
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
${PAGE_ELEMENT_HELPERS}
const password=documents.some(({document})=>
  Array.from(document.querySelectorAll('input[type="password"]')).some(visible)
);
const loginLabels=new Set([
  '로그인','로그인하기','로그인 화면','아이디 로그인','ID 로그인',
  '인증서로그인','인증서 로그인','공동인증서 로그인','사용자인증','사용자 인증'
].map(normalize));
const loginControl=documents.some(({document})=>
  Array.from(document.querySelectorAll('a,button,input[type="button"],input[type="submit"],[role="button"],h1,h2,h3'))
    .some(element=>visible(element)&&loginLabels.has(textOf(element)))
);
const loginPath=location.pathname.toLowerCase().split(/[^a-z]+/)
  .some(part=>['login','certlogin','signin'].includes(part));
return {href:location.href,origin:location.origin,readyState:document.readyState,loginVisible:password||loginControl||loginPath};
})()`;

function isBootstrapTarget(target: WindowsTargetInfo): boolean {
  if (target.type !== 'page') return false;
  const normalized = target.url.toLowerCase().replace(/\/+$/, '');
  return normalized === 'about:blank' ||
    normalized === 'edge://newtab' ||
    normalized === 'edge://new-tab-page' ||
    normalized === 'chrome://newtab';
}

function requestSystem(
  workflowId: WebWorkflowId,
  workflowSpec?: WebWorkflowSpec,
): WebWorkflowSystem | null {
  const spec = requestWorkflowSpec(workflowId, workflowSpec);
  return spec ? getWebWorkflowSystem(spec) : null;
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
  let attached: { sessionId?: unknown } | undefined;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      attached = await protocol.send<{ sessionId?: unknown }>('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
      });
      break;
    } catch {
      if (attempt === 9) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
  if (typeof attached?.sessionId !== 'string') {
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
  const command = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; $h=$p.MainWindowHandle; if($h -eq 0){exit 2}; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class StreamPanelWindow { [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'; if([StreamPanelWindow]::IsIconic($h)){[StreamPanelWindow]::ShowWindowAsync($h,9)|Out-Null}; [StreamPanelWindow]::SetForegroundWindow($h)|Out-Null`;
  return (await runWindowsCommand(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
  )) !== null;
}

export async function restoreAndActivateTarget(
  session: WindowsManagedBrowserSession,
  targetId: string,
  sessionId?: string,
  focusOwnedWindow: (
    session: WindowsManagedBrowserSession,
  ) => Promise<boolean> = restoreOwnedBrowserWindow,
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
  // Browser.getWindowForTarget identifies the exact native window that owns this tab.
  // Process.MainWindowHandle can point at a different Edge window, so use the native
  // fallback only when Chromium cannot resolve the target window at all.
  if (!cdpWindowFound) await focusOwnedWindow(session);
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
  rejectState?: (state: PageReadinessState) => Error | null,
  signal?: AbortSignal,
): Promise<PageReadinessState> {
  const deadline = Date.now() + timeoutMs;
  let stableHref = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    throwIfApprovalCheckCancelled(signal);
    if (!session.isAlive()) {
      throw new Error('업무용 브라우저가 닫혔습니다. 브라우저를 다시 연 뒤 시도해 주세요.');
    }
    let state: PageReadinessState | null = null;
    try {
      state = readPageReadinessState(
        await evaluateValue(session, sessionId, PAGE_READINESS_EXPRESSION),
      );
    } catch {
      // The document can be unavailable briefly while a direct login redirects.
    }
    if (
      state &&
      /^https?:\/\//.test(state.origin) &&
      (state.readyState === 'interactive' || state.readyState === 'complete')
    ) {
      const stateError = rejectState?.(state);
      if (stateError) throw stateError;
      if (accepts(state)) {
        stableCount = state.href === stableHref ? stableCount + 1 : 1;
        stableHref = state.href;
        if (stableCount >= 2) return state;
      } else {
        stableHref = '';
        stableCount = 0;
      }
    } else {
      stableHref = '';
      stableCount = 0;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
  }
  throwIfApprovalCheckCancelled(signal);
  throw new Error('업무 시스템 화면이 열리는 시간이 지났습니다. 네트워크와 로그인 화면을 확인해 주세요.');
}

async function pressCandidateWithCdp(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  candidate: CandidateSummary,
  interaction: WorkflowStep['interaction'],
  navigationOnly = false,
  allowedNavigationOrigin?: string,
  menuOnly = false,
  contextLabels: readonly string[] = [],
  allowActionText = false,
  allowedActionLabels: readonly string[] = [],
): Promise<void> {
  const protocol = session.connection.protocol;
  const normalizedText = candidate.text.replace(/\s+/g, ' ').trim();
  const isSpecializedInteraction = interaction.startsWith('edufine-') ||
    interaction === 'frame-exact-text';
  const action = await evaluateValue<{
    ok?: unknown;
    direct?: unknown;
    x?: unknown;
    y?: unknown;
  }>(
    session,
    sessionId,
    isSpecializedInteraction
      ? edufineCandidateActionExpression(
          interaction,
          normalizedText,
          allowActionText,
          allowedActionLabels,
        )
      : candidateActionExpression(
          candidate.index,
          normalizedText,
          interaction === 'dom-click',
          navigationOnly,
          allowedNavigationOrigin,
          menuOnly,
          contextLabels,
          allowActionText,
          allowedActionLabels,
        ),
    interaction === 'dom-click' || interaction === 'edufine-job' || interaction === 'edufine-exact-text',
  );
  if (!action?.ok) {
    if (isSpecializedInteraction && await pressEdufineCandidateAcrossFrames(
      session,
      sessionId,
      interaction,
      normalizedText,
      allowActionText,
      allowedActionLabels,
    )) return;
    throw new Error(`'${normalizedText}' 메뉴의 위치가 바뀌었습니다. 화면을 확인한 뒤 다시 시도해 주세요.`);
  }
  if (
    action.direct === true ||
    interaction === 'dom-click' ||
    interaction === 'edufine-job' ||
    interaction === 'edufine-exact-text'
  ) return;
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

async function childFrameExecutionContexts(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  purpose: string,
): Promise<number[]> {
  let frameIds: string[];
  try {
    frameIds = portalFrameIds(
      await session.connection.protocol.send('Page.getFrameTree', {}, sessionId),
    ).slice(1);
  } catch {
    return [];
  }
  const contexts: number[] = [];
  for (const frameId of frameIds) {
    try {
      const world = await session.connection.protocol.send<{ executionContextId?: unknown }>(
        'Page.createIsolatedWorld',
        {
          frameId,
          worldName: `stream-panel-${purpose}`,
          grantUniveralAccess: false,
        },
        sessionId,
      );
      if (Number.isInteger(world.executionContextId)) {
        contexts.push(Number(world.executionContextId));
      }
    } catch {
      // A Nexacro frame can be replaced while a menu is opening.
    }
  }
  return contexts;
}

async function evaluateValuesInChildFrames<T>(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  expression: string,
  purpose: string,
): Promise<T[]> {
  const values: T[] = [];
  for (const contextId of await childFrameExecutionContexts(session, sessionId, purpose)) {
    try {
      const response = await session.connection.protocol.send<CdpEvaluationResponse>(
        'Runtime.evaluate',
        {
          expression,
          contextId,
          returnByValue: true,
          awaitPromise: false,
        },
        sessionId,
      );
      if (!response.exceptionDetails && response.result && 'value' in response.result) {
        values.push(response.result.value as T);
      }
    } catch {
      // Continue with another live frame when this one navigates.
    }
  }
  return values;
}

async function inspectEdufineCandidatesAcrossFrames(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  step: WorkflowStep,
): Promise<CandidateSummary[]> {
  const values = await evaluateValuesInChildFrames<unknown>(
    session,
    sessionId,
    edufineCandidateScanExpression(step),
    `edufine-scan-${step.id}`,
  );
  for (const value of values) {
    const candidates = readCandidateSummaries(value);
    if (candidates.length > 0) return candidates;
  }
  return [];
}

async function checkEdufinePostconditionAcrossFrames(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  step: WorkflowStep,
): Promise<boolean> {
  const values = await evaluateValuesInChildFrames<unknown>(
    session,
    sessionId,
    postconditionExpression(step),
    `edufine-state-${step.id}`,
  );
  return values.some((value) => value === true);
}

async function pressEdufineCandidateAcrossFrames(
  session: WindowsManagedBrowserSession,
  sessionId: string,
  interaction: WorkflowStep['interaction'],
  expectedText: string,
  allowActionText: boolean,
  allowedActionLabels: readonly string[],
): Promise<boolean> {
  const expression = edufineCandidateActionExpression(
    interaction,
    expectedText,
    allowActionText,
    allowedActionLabels,
    true,
  );
  for (const contextId of await childFrameExecutionContexts(
    session,
    sessionId,
    `edufine-action-${expectedText.slice(0, 24)}`,
  )) {
    let objectId: string | undefined;
    try {
      const response = await session.connection.protocol.send<CdpEvaluationResponse>(
        'Runtime.evaluate',
        {
          expression,
          contextId,
          returnByValue: false,
          awaitPromise: false,
          userGesture: true,
          objectGroup: 'stream-panel-edufine-action',
        },
        sessionId,
      );
      if (
        response.exceptionDetails ||
        response.result?.subtype !== 'node' ||
        typeof response.result.objectId !== 'string'
      ) continue;
      objectId = response.result.objectId;
      const center = portalQuadCenter(await session.connection.protocol.send(
        'DOM.getContentQuads',
        { objectId },
        sessionId,
      ));
      if (!center) continue;
      await dispatchCdpMouseClick(session, sessionId, center.x, center.y);
      return true;
    } catch {
      // Continue with another frame if the menu was re-rendered mid-click.
    } finally {
      if (objectId) {
        try {
          await session.connection.protocol.send(
            'Runtime.releaseObject',
            { objectId },
            sessionId,
          );
        } catch {
          // The frame may already have navigated after the successful click.
        }
      }
    }
  }
  return false;
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
  const system = requestSystem(workflowId, workflowSpec);
  const connectedTargetId = system ? connectionTargetMap(session)[system] : undefined;
  const rememberedTargetId = system ? systemTargetMap(session)[system] : undefined;
  const rememberedTarget = [connectedTargetId, rememberedTargetId]
    .filter((targetId): targetId is string => typeof targetId === 'string')
    .map((targetId) => targets.find((target) => target.targetId === targetId))
    .find((target): target is WindowsTargetInfo => Boolean(
      target &&
      target.type === 'page' &&
      workflowTargetAllowed(target.url, session.officeCode, workflowId, workflowSpec),
    ));
  const existingTarget = rememberedTarget ?? selectWindowsWorkflowTarget(
    targets,
    session.officeCode,
    workflowId,
    workflowSpec,
  );
  if (system && existingTarget) systemTargetMap(session)[system] = existingTarget.targetId;
  let target = options.forceNewTarget
    ? null
    : existingTarget;
  let shouldNavigate = Boolean(target && options.navigateExistingTarget);
  if (!target && !options.forceNewTarget) {
    target = targets.find((candidate) => (
      candidate.targetId === session.bootstrapTargetId && isBootstrapTarget(candidate)
    )) ?? targets.find(isBootstrapTarget) ?? null;
    shouldNavigate = Boolean(target);
  }
  if (!target) {
    const createdUrl = options.cloneExistingTargetUrl && existingTarget
      ? existingTarget.url
      : targetUrl;
    if (options.forceNewTarget && !options.background && existingTarget) {
      const targetIdsBeforeOpen = new Set(targets.map(({ targetId }) => targetId));
      let anchor: AttachedWindowsTarget | undefined;
      try {
        anchor = await attachWindowsTarget(session, existingTarget);
        await evaluateValue(
          session,
          anchor.sessionId,
          `(()=>{window.open(${JSON.stringify(createdUrl)},'_blank');return true;})()`,
          true,
        );
      } catch {
        // A managed browser can block a scripted tab in hardened environments.
        // Target.createTarget below remains a tab-only fallback in the same profile.
      } finally {
        if (anchor) await detachWindowsTarget(session, anchor);
      }
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const opened = readTargetInfos(
          await protocol.send('Target.getTargets', {}),
        ).find((candidate) => (
          candidate.type === 'page' &&
          !targetIdsBeforeOpen.has(candidate.targetId) &&
          workflowTargetAllowed(
            candidate.url,
            session.officeCode,
            workflowId,
            workflowSpec,
          )
        ));
        if (opened) {
          target = opened;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    }
    if (!target) {
      const created = await protocol.send<{ targetId?: unknown }>('Target.createTarget', {
        url: createdUrl,
        ...(options.background ? { background: true } : {}),
      });
      if (typeof created.targetId !== 'string') {
        throw new Error('업무용 브라우저 탭을 만들지 못했습니다. 브라우저를 다시 열어 주세요.');
      }
      target = { targetId: created.targetId, type: 'page', url: createdUrl };
    }
    if (options.closeCreatedTargetOnRelease) {
      lifecycle.closeTargetIds.push(target.targetId);
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

function createWindowsWorkflowPage(
  session: WindowsManagedBrowserSession,
  attached: AttachedWindowsTarget,
  release: (options?: { keepCreatedTargets?: boolean }) => Promise<void>,
  workflowId: WebWorkflowId,
  workflowSpec: WebWorkflowSpec | undefined,
  lifecycle: WorkflowTargetLifecycle,
): WindowsWorkflowPage {
  let active = attached;
  let targetIdsBeforeNewPage: Set<string> | null = null;
  const newPageAttachments = new Map<string, AttachedWindowsTarget>();
  const workflowSystem = requestSystem(workflowId, workflowSpec);
  const approvalListSystem = (step: WorkflowStep): WebWorkflowSystem | null => {
    if (workflowId === 'neis-approval-inbox' && step.id === 'open-pending-cooperation-inbox') {
      return 'neis';
    }
    if (workflowId === 'edufine-approval-inbox' && step.id === 'open-waiting-approval-inbox') {
      return 'edufine';
    }
    return null;
  };
  const readApprovalCountFromCurrentPage = async (
    system: WebWorkflowSystem,
    requireListReady: boolean,
  ): Promise<number> => {
    let rootError: unknown;
    try {
      return parseApprovalCounterCandidates(
        system,
        await evaluateValue<unknown>(
          session,
          active.sessionId,
          approvalCounterExpression(system),
        ),
        requireListReady,
      );
    } catch (error) {
      rootError = error;
    }
    if (system === 'edufine') {
      const values = await evaluateValuesInChildFrames<unknown>(
        session,
        active.sessionId,
        approvalCounterExpression(system),
        'edufine-approval-count',
      );
      for (const value of values) {
        try {
          return parseApprovalCounterCandidates(system, value, requireListReady);
        } catch {
          // The approval list can live in only one of several Nexacro frames.
        }
      }
    }
    throw rootError;
  };
  const approvalListReady = async (system: WebWorkflowSystem): Promise<boolean> => {
    try {
      await readApprovalCountFromCurrentPage(system, true);
      return true;
    } catch {
      return false;
    }
  };
  return {
    async currentOrigin() {
      await extendSystemSessionIfPrompted(session, active.sessionId);
      const origin = await evaluateValue<unknown>(session, active.sessionId, 'location.origin');
      return typeof origin === 'string' ? origin : '';
    },
    async inspectCandidates(step) {
      await extendSystemSessionIfPrompted(session, active.sessionId);
      const candidates = readCandidateSummaries(
        await evaluateValue(session, active.sessionId, candidateScanExpression(step)),
      );
      if (candidates.length > 0 || workflowSystem !== 'edufine') return candidates;
      return inspectEdufineCandidatesAcrossFrames(session, active.sessionId, step);
    },
    async pressCandidate(candidate, step) {
      await extendSystemSessionIfPrompted(session, active.sessionId);
      if (step.postcondition.kind === 'new-page-any') {
        targetIdsBeforeNewPage = new Set(readTargetInfos(
          await session.connection.protocol.send('Target.getTargets', {}),
        ).map(({ targetId }) => targetId));
      }
      await pressCandidateWithCdp(
        session,
        active.sessionId,
        candidate,
        step.interaction,
        Boolean(step.navigationOnly),
        undefined,
        Boolean(step.menuOnly),
        step.contextLabels,
        Boolean(step.requiresConfirmation || step.allowActionText),
        step.candidateLabels,
      );
    },
    async checkCurrentState(step) {
      await extendSystemSessionIfPrompted(session, active.sessionId);
      const approvalSystem = approvalListSystem(step);
      if (approvalSystem) return approvalListReady(approvalSystem);
      if (await evaluateValue(
        session,
        active.sessionId,
        postconditionExpression(step),
      )) return true;
      return workflowSystem === 'edufine'
        ? checkEdufinePostconditionAcrossFrames(session, active.sessionId, step)
        : false;
    },
    async checkPostcondition(step) {
      await extendSystemSessionIfPrompted(session, active.sessionId);
      const approvalSystem = approvalListSystem(step);
      if (approvalSystem) return approvalListReady(approvalSystem);
      if (await evaluateValue(
        session,
        active.sessionId,
        postconditionExpression(step),
      )) return true;
      if (
        workflowSystem === 'edufine' &&
        await checkEdufinePostconditionAcrossFrames(session, active.sessionId, step)
      ) return true;
      if (step.postcondition.kind !== 'new-page-any' || !targetIdsBeforeNewPage) {
        return false;
      }
      const targets = readTargetInfos(
        await session.connection.protocol.send('Target.getTargets', {}),
      ).filter((target) => (
        target.type === 'page' &&
        !targetIdsBeforeNewPage?.has(target.targetId) &&
        workflowTargetAllowed(
          target.url,
          session.officeCode,
          workflowId,
          workflowSpec,
        )
      ));
      for (const target of targets) {
        let next = newPageAttachments.get(target.targetId);
        if (!next) {
          next = await attachWindowsTarget(session, target, lifecycle);
          newPageAttachments.set(target.targetId, next);
        } else {
          next.target = target;
        }
        try {
          if (!await evaluateValue(
            session,
            next.sessionId,
            postconditionExpression(step),
          )) continue;
          active = next;
          targetIdsBeforeNewPage = null;
          return true;
        } catch {
          // The new page may still be loading. The workflow engine will poll again.
        }
      }
      return false;
    },
    async wait(delayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      await extendSystemSessionIfPrompted(session, active.sessionId);
    },
    async activate() {
      await restoreAndActivateTarget(session, active.target.targetId, active.sessionId);
    },
    release,
    async readApprovalCount(system) {
      await extendSystemSessionIfPrompted(session, active.sessionId);
      return readApprovalCountFromCurrentPage(system, false);
    },
  };
}

export async function openCdpWindowsApprovalPage(
  session: WindowsManagedBrowserSession,
  input: ApprovalScanInput,
  signal?: AbortSignal,
): Promise<WindowsApprovalPage> {
  if (!input.interactive) {
    const workflowId = input.system === 'neis'
      ? 'neis-approval-inbox' as const
      : 'edufine-approval-inbox' as const;
    const targets = readTargetInfos(
      await session.connection.protocol.send('Target.getTargets', {}),
    );
    const rememberedTargetId = systemTargetMap(session)[input.system];
    const target = targets.find((candidate) => candidate.targetId === rememberedTargetId) ??
      selectWindowsWorkflowTarget(targets, session.officeCode, workflowId);
    if (target) {
      let attached: AttachedWindowsTarget | undefined;
      try {
        attached = await attachWindowsTarget(session, target);
        const expression = activeWorkFormExpression(input.system);
        let rootActive: unknown = false;
        try {
          rootActive = await evaluateValue<unknown>(
            session,
            attached.sessionId,
            expression,
          );
        } catch {
          // A frame can be rebuilding before the normal workflow readiness wait.
        }
        const childActive = rootActive === true
          ? []
          : await evaluateValuesInChildFrames<unknown>(
              session,
              attached.sessionId,
              expression,
              `${input.system}-active-work-form`,
            );
        if (rootActive === true || childActive.some((value) => value === true)) {
          throw createApprovalCheckCancelledError();
        }
      } finally {
        if (attached) await detachWindowsTarget(session, attached);
      }
    }
  }
  const page = await openCdpWindowsWorkflowPage(
    session,
    input.system === 'neis' ? 'neis-approval-inbox' : 'edufine-approval-inbox',
    undefined,
    {
      background: input.interactive !== true,
      failFastOnLoginRequired: true,
      navigateExistingTarget: true,
      keepCreatedTargetOnFailure: input.interactive === true,
      // The explicit Connect button owns SSO preparation. Approval scans reuse
      // that verified tab and fail quickly instead of creating another login flow.
      recoverViaPortal: false,
      signal,
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
  const release = async (releaseOptions: { keepCreatedTargets?: boolean } = {}): Promise<void> => {
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
    if (!releaseOptions.keepCreatedTargets) {
      for (const targetId of [...new Set(lifecycle.closeTargetIds)]) {
        try {
          await protocol.send('Target.closeTarget', { targetId });
        } catch {
          cleanupFailed = true;
        }
      }
    }
    if (cleanupFailed && !releaseOptions.keepCreatedTargets) {
      try {
        await session.close();
      } catch {
        // The session manager will create a new browser session on the next request.
      }
    }
  };
  let attached: AttachedWindowsTarget | undefined;
  try {
    const targets = readTargetInfos(await protocol.send('Target.getTargets', {}));
    attached = await acquireDirectWorkflowTarget(
      session,
      targets,
      workflowId,
      workflowSpec,
      options,
      lifecycle,
    );
    const system = requestSystem(workflowId, workflowSpec);
    const systemLabel = system === 'neis' ? '나이스' : 'K-에듀파인';
    const waitUntilWorkflowReady = (rejectLoginImmediately: boolean) => waitForReadyPage(
      session,
      attached!.sessionId,
      (state) => {
        if (state.loginVisible) session.workflowState = 'WAITING_FOR_USER';
        else session.workflowState = 'CHECKING_AUTH';
        return !state.loginVisible && workflowTargetAllowed(
          state.href,
          session.officeCode,
          workflowId,
          workflowSpec,
        );
      },
      system ? (options.failFastOnLoginRequired ? 15_000 : 120_000) : 30_000,
      rejectLoginImmediately && system
        ? (state) => state.loginVisible
          ? new Error(`${systemLabel} 세션이 만료되어 업무포털 공식 연결이 필요합니다.`)
          : null
        : undefined,
      options.signal,
    );
    try {
      await waitUntilWorkflowReady(Boolean(system));
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (system && options.recoverViaPortal !== false) {
        const preparations = await prepareOfficeSystemsViaPortal(
          session,
          [system],
          () => undefined,
          options.signal,
          !options.background,
        );
        const preparation = preparations.get(system);
        if (!preparation?.ready) {
          throw new Error(
            preparation?.message ??
            `${systemLabel} 세션을 업무포털 공식 연결로 복구하지 못했습니다.`,
          );
        }
        await navigateAttachedTarget(
          session,
          attached,
          requestTarget(workflowId, session.officeCode, workflowSpec),
        );
        await waitUntilWorkflowReady(true);
      } else {
        if (options.failFastOnLoginRequired && system) {
          const message = error instanceof Error ? error.message : '';
          if (!/로그인|인증/.test(message)) {
            throw new Error(`${systemLabel} 전용 탭에서 로그인 또는 인증을 완료한 뒤 다시 연결해 주세요.`);
          }
        }
        throw error;
      }
    }
    if (!options.background) session.workflowState = 'NAVIGATING_DUTY_MENU';
    return createWindowsWorkflowPage(
      session,
      attached,
      release,
      workflowId,
      workflowSpec,
      lifecycle,
    );
  } catch (error) {
    if (options.keepCreatedTargetOnFailure && attached && !options.signal?.aborted) {
      try {
        await restoreAndActivateTarget(
          session,
          attached.target.targetId,
          attached.sessionId,
        );
      } catch {
        // Keep reporting the original workflow error if foreground activation fails.
      }
      await release({ keepCreatedTargets: true });
    } else {
      await release();
    }
    throw error;
  }
}

function connectionProbeWorkflowId(system: WebWorkflowSystem): BuiltInWebWorkflowId {
  return system === 'neis' ? 'neis-approval-inbox' : 'edufine-approval-inbox';
}

const PORTAL_SSO_LABELS: Record<WebWorkflowSystem, readonly string[]> = {
  neis: ['나이스', 'NEIS', '나이스(NEIS)', '나이스 (NEIS)', '나이스 업무'],
  edufine: [
    'K-에듀파인',
    'K에듀파인',
    'K 에듀파인',
    '에듀파인',
    'K-에듀파인 업무관리',
  ],
};

function orderedConnectionSystems(
  systems: readonly WebWorkflowSystem[],
): WebWorkflowSystem[] {
  const requested = new Set(systems);
  return (['neis', 'edufine'] as const).filter((system) => requested.has(system));
}

function connectionTabName(system: WebWorkflowSystem): string {
  return `stream-panel-${system}`;
}

async function recordConnectionDiagnostic(
  diagnose: WindowsConnectionDiagnosticReporter | undefined,
  event: WindowsConnectionDiagnosticEvent,
): Promise<void> {
  try {
    await diagnose?.(event);
  } catch {
    // Diagnostics must never turn a successful official SSO connection into an error.
  }
}

function portalSsoClickExpression(
  system: WebWorkflowSystem,
  returnElement = false,
): string {
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const returnElement=${JSON.stringify(returnElement)};
const tabName=${JSON.stringify(connectionTabName(system))};
const ssoLabels=${JSON.stringify(PORTAL_SSO_LABELS[system])}.map(normalize);
const otherLabels=${JSON.stringify(PORTAL_SSO_LABELS[system === 'neis' ? 'edufine' : 'neis'])}.map(normalize);
const systemTokens=${JSON.stringify(system === 'neis'
    ? ['neis', '나이스', 'neis.go.kr']
    : ['edufine', '에듀파인', 'klef.', 'k-에듀파인'])}.map(value=>String(value).toLowerCase());
const otherTokens=${JSON.stringify(system === 'neis'
    ? ['edufine', '에듀파인', 'klef.']
    : ['neis', '나이스', 'neis.go.kr'])}.map(value=>String(value).toLowerCase());
const fold=(value)=>normalize(value).toLowerCase().replace(/[\\s\\-()（）]/g,'');
const wantedKeys=Array.from(new Set(ssoLabels.map(fold).filter(Boolean)));
const otherKeys=Array.from(new Set(otherLabels.map(fold).filter(Boolean)));
const selector='a,button,input[type="button"],input[type="image"],[role="link"],[role="button"],[role="menuitem"],[onclick],[tabindex],img,span,div,strong,p';
const topContainerSelector='header,nav,#header,#gnb,.header,.gnb,.top-menu,.topMenu,[class*="header"],[class*="gnb"],[id*="header"],[id*="gnb"]';
const candidates=[];
const seen=new Set();
for(const {document} of documents){
  for(const element of Array.from(document.querySelectorAll(selector)).slice(0,5000)){
    if(seen.has(element)||!visible(element)||!enabled(element))continue;
    const inputType=normalize(element.getAttribute?.('type')||element.type).toLowerCase();
    if(inputType==='submit')continue;
    const texts=surfaceTextsOf(element).map(normalize).filter(text=>text&&text.length<=96);
    const attributeSignal=[
      'href','onclick','id','name','class','src','alt','data-url','data-href',
      'data-link','data-system','data-service','data-program','data-menu'
    ].map(name=>normalize(element.getAttribute?.(name))).filter(Boolean).join(' ').toLowerCase();
    let score=0;
    let matchedText='';
    for(const text of texts){
      const key=fold(text);
      if(!key||otherKeys.some(other=>key.includes(other)))continue;
      for(const wanted of wantedKeys){
        if(key===wanted&&score<120){score=120;matchedText=text;}
        else if((key.startsWith(wanted)||key.endsWith(wanted))&&key.length<=wanted.length+16&&score<100){score=100;matchedText=text;}
        else if(key.includes(wanted)&&key.length<=wanted.length+24&&score<80){score=80;matchedText=text;}
      }
    }
    const hasSystemToken=systemTokens.some(token=>attributeSignal.includes(token));
    const hasOtherToken=otherTokens.some(token=>attributeSignal.includes(token));
    if(hasOtherToken&&!hasSystemToken)continue;
    if(hasSystemToken&&score<90){score=90;matchedText=matchedText||attributeSignal.slice(0,96);}
    if(score===0)continue;
    const clickableAncestor=element.closest?.('a,button,input[type="button"],input[type="image"],[role="link"],[role="button"],[role="menuitem"],[onclick],[tabindex]');
    const clickElement=clickableAncestor||element;
    if(!visible(clickElement)||!enabled(clickElement)||seen.has(clickElement))continue;
    const clickType=normalize(clickElement.getAttribute?.('type')||clickElement.type).toLowerCase();
    if(clickType==='submit')continue;
    if(clickableAncestor)score+=20;
    const rect=clickElement.getBoundingClientRect();
    // The official portal exposes NEIS and K-Edufine in its upper service bar.
    // Prefer that exact route over similarly named notices or dashboard cards.
    if(clickElement.closest?.(topContainerSelector))score+=80;
    const viewportHeight=Number(clickElement.ownerDocument?.defaultView?.innerHeight)||0;
    if(rect.top>=-4&&rect.top<=Math.min(420,Math.max(220,viewportHeight*0.45)))score+=25;
    seen.add(element);
    seen.add(clickElement);
    candidates.push({element:clickElement,score,area:Math.max(1,rect.width*rect.height),matchedText});
  }
}
candidates.sort((left,right)=>right.score-left.score||left.area-right.area);
if(candidates.length===0)return returnElement?null:{clicked:false,count:0};
const winner=candidates[0];
winner.element.scrollIntoView?.({block:'center',inline:'center'});
winner.element.focus?.({preventScroll:false});
const targetElements=[];
const anchor=winner.element.matches?.('a')?winner.element:winner.element.querySelector?.('a');
const form=winner.element.matches?.('form')?winner.element:winner.element.closest?.('form');
for(const element of [anchor,form]){
  if(!element||targetElements.includes(element))continue;
  targetElements.push(element);
  element.setAttribute?.('target',tabName);
}
const restored=[];
for(const {document} of documents){
  const view=document.defaultView;
  if(!view||typeof view.open!=='function'||restored.some(entry=>entry.view===view))continue;
  const stateKey='__streamPanelSsoWindowOpenState';
  try{
    const state=view[stateKey]||{original:view.open,token:0};
    state.token+=1;
    view[stateKey]=state;
    const original=state.original;
    const token=state.token;
    view.open=function(url){return original.call(this,url,tabName);};
    restored.push({view,stateKey,state,token});
  }catch{}
}
setTimeout(()=>{for(const {view,stateKey,state,token} of restored){try{if(state.token===token){view.open=state.original;delete view[stateKey];}}catch{}}},1500);
const rect=winner.element.getBoundingClientRect();
const owner=documents.find(({document})=>document===winner.element.ownerDocument);
return returnElement?winner.element:{
  clicked:true,
  count:candidates.length,
  matchedText:winner.matchedText,
  x:(owner?.offsetX||0)+rect.left+rect.width/2,
  y:(owner?.offsetY||0)+rect.top+rect.height/2
};
})()`;
}

interface PortalSystemPreparation {
  ready: boolean;
  targetId?: string;
  message?: string;
}

interface PortalSsoCandidate {
  clicked: true;
  count: number;
  x: number;
  y: number;
}

function portalFrameIds(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const root = (value as Record<string, unknown>).frameTree;
  const ids: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    const frame = record.frame;
    if (frame && typeof frame === 'object' && !Array.isArray(frame)) {
      const id = (frame as Record<string, unknown>).id;
      if (typeof id === 'string' && id.length > 0) ids.push(id);
    }
    if (Array.isArray(record.childFrames)) {
      for (const child of record.childFrames) visit(child);
    }
  };
  visit(root);
  return [...new Set(ids)];
}

function portalQuadCenter(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const quads = (value as Record<string, unknown>).quads;
  if (!Array.isArray(quads)) return null;
  for (const quad of quads) {
    if (!Array.isArray(quad) || quad.length !== 8 || quad.some((item) => (
      typeof item !== 'number' || !Number.isFinite(item)
    ))) continue;
    const xs = [quad[0], quad[2], quad[4], quad[6]] as number[];
    const ys = [quad[1], quad[3], quad[5], quad[7]] as number[];
    if (Math.max(...xs) - Math.min(...xs) < 1 || Math.max(...ys) - Math.min(...ys) < 1) continue;
    return {
      x: xs.reduce((sum, item) => sum + item, 0) / xs.length,
      y: ys.reduce((sum, item) => sum + item, 0) / ys.length,
    };
  }
  return null;
}

async function findPortalSsoCandidateAcrossFrames(
  session: WindowsManagedBrowserSession,
  portalSessionId: string,
  system: WebWorkflowSystem,
): Promise<PortalSsoCandidate | null> {
  const protocol = session.connection.protocol;
  let frameIds: string[];
  try {
    frameIds = portalFrameIds(await protocol.send('Page.getFrameTree', {}, portalSessionId));
  } catch {
    return null;
  }
  for (const frameId of frameIds) {
    let objectId: string | undefined;
    try {
      const world = await protocol.send<{ executionContextId?: unknown }>(
        'Page.createIsolatedWorld',
        {
          frameId,
          worldName: `stream-panel-office-sso-${system}`,
          grantUniveralAccess: false,
        },
        portalSessionId,
      );
      if (!Number.isInteger(world.executionContextId)) continue;
      const response = await protocol.send<CdpEvaluationResponse>(
        'Runtime.evaluate',
        {
          expression: portalSsoClickExpression(system, true),
          contextId: Number(world.executionContextId),
          returnByValue: false,
          awaitPromise: false,
          userGesture: true,
          objectGroup: 'stream-panel-office-sso',
        },
        portalSessionId,
      );
      if (response.exceptionDetails || typeof response.result?.objectId !== 'string') continue;
      objectId = response.result.objectId;
      const center = portalQuadCenter(await protocol.send(
        'DOM.getContentQuads',
        { objectId },
        portalSessionId,
      ));
      if (center) return { clicked: true, count: 1, ...center };
    } catch {
      // A frame can navigate or disappear while the portal finishes rendering.
    } finally {
      if (objectId) {
        try {
          await protocol.send('Runtime.releaseObject', { objectId }, portalSessionId);
        } catch {
          // The execution context may already be gone after an SSO navigation.
        }
      }
    }
  }
  return null;
}

function systemTargetAllowed(
  target: WindowsTargetInfo,
  officeCode: EducationOfficeCode,
  system: WebWorkflowSystem,
): boolean {
  return target.type === 'page' && isAllowedWebWorkflowTarget(
    connectionProbeWorkflowId(system),
    target.url,
    officeCode,
  );
}

function systemConnectionLandingUrl(
  officeCode: EducationOfficeCode,
  system: WebWorkflowSystem,
): string {
  const office = getEducationOffice(officeCode);
  return system === 'neis' ? office.neisUrl : office.edufineUrl;
}

function isSystemConnectionLandingUrl(current: string, expected: string): boolean {
  try {
    const currentUrl = new URL(current);
    const expectedUrl = new URL(expected);
    const normalizedPath = (value: string): string => (
      value === '/' ? value : value.replace(/\/+$/, '')
    );
    return currentUrl.origin === expectedUrl.origin &&
      normalizedPath(currentUrl.pathname) === normalizedPath(expectedUrl.pathname);
  } catch {
    return false;
  }
}

async function detachWindowsTarget(
  session: WindowsManagedBrowserSession,
  attached: AttachedWindowsTarget,
): Promise<void> {
  try {
    await session.connection.protocol.send('Target.detachFromTarget', {
      sessionId: attached.sessionId,
    });
  } catch {
    // A navigation can detach a target before the best-effort cleanup runs.
  }
}

async function normalizeConnectedSystemTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
  target: WindowsTargetInfo,
  signal?: AbortSignal,
): Promise<WindowsTargetInfo> {
  // Other offices can redirect their configured root to a product-specific path.
  // Gyeonggi publishes stable landing addresses, so make those exact addresses
  // the visible, reusable tabs created by the explicit Connect action.
  if (session.officeCode !== 'goe') return target;
  const destination = systemConnectionLandingUrl(session.officeCode, system);
  let attached: AttachedWindowsTarget | undefined;
  try {
    attached = await attachWindowsTarget(session, target);
    let currentState: PageReadinessState | null = null;
    try {
      currentState = readPageReadinessState(
        await evaluateValue(session, attached.sessionId, PAGE_READINESS_EXPRESSION),
      );
    } catch {
      // An SSO redirect can still be replacing the initial document.
    }
    if (!currentState || !isSystemConnectionLandingUrl(currentState.href, destination)) {
      await navigateAttachedTarget(session, attached, destination);
    }
    let loginHref = '';
    let stableLoginChecks = 0;
    const readyState = await waitForReadyPage(
      session,
      attached.sessionId,
      (state) => !state.loginVisible &&
        isSystemConnectionLandingUrl(state.href, destination) &&
        systemTargetAllowed(
          { ...target, url: state.href },
          session.officeCode,
          system,
        ),
      60_000,
      (state) => {
        if (!state.loginVisible) {
          loginHref = '';
          stableLoginChecks = 0;
          return null;
        }
        stableLoginChecks = state.href === loginHref ? stableLoginChecks + 1 : 1;
        loginHref = state.href;
        // K-Edufine briefly renders its login shell before the portal SSO
        // assertion is consumed. Only report login-required after the same
        // screen has remained stable long enough to rule out that redirect.
        return stableLoginChecks >= 100
          ? new Error(`${system === 'neis' ? '나이스' : 'K-에듀파인'} 추가 로그인이 필요합니다.`)
          : null;
      },
      signal,
    );
    const normalizedTarget = { ...target, url: readyState.href };
    systemTargetMap(session)[system] = target.targetId;
    return normalizedTarget;
  } finally {
    if (attached) await detachWindowsTarget(session, attached);
  }
}

interface InspectedSystemTarget {
  target: WindowsTargetInfo;
  loginRequired: boolean;
}

interface InspectSystemTargetOptions {
  knownTargetIds?: ReadonlySet<string>;
  portalTargetId?: string;
  allowedTargetIds?: ReadonlySet<string>;
}

async function inspectSystemTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
  options: InspectSystemTargetOptions = {},
): Promise<InspectedSystemTarget | null> {
  let targets: WindowsTargetInfo[];
  try {
    targets = readTargetInfos(
      await session.connection.protocol.send('Target.getTargets', {}),
    ).filter((target) => (
      (!options.allowedTargetIds || options.allowedTargetIds.has(target.targetId)) &&
      systemTargetAllowed(target, session.officeCode, system)
    ));
  } catch {
    return null;
  }
  const rememberedTargetId = systemTargetMap(session)[system];
  const priority = (target: WindowsTargetInfo): number => (
    (!options.knownTargetIds?.has(target.targetId) ? 100 : 0) +
    (target.openerId === options.portalTargetId ? 50 : 0) +
    (target.targetId === rememberedTargetId ? 25 : 0)
  );
  targets.sort((left, right) => priority(right) - priority(left));
  let loginTarget: WindowsTargetInfo | null = null;
  for (const target of targets) {
    let attached: AttachedWindowsTarget | undefined;
    try {
      attached = await attachWindowsTarget(session, target);
      const state = readPageReadinessState(
        await evaluateValue(session, attached.sessionId, PAGE_READINESS_EXPRESSION),
      );
      if (state && systemTargetAllowed(
        { ...target, url: state.href },
        session.officeCode,
        system,
      )) {
        const inspectedTarget = { ...target, url: state.href };
        if (!state.loginVisible) {
          systemTargetMap(session)[system] = target.targetId;
          return { target: inspectedTarget, loginRequired: false };
        }
        loginTarget ??= inspectedTarget;
      }
    } catch {
      // Loading or closed system tabs are retried through the portal or direct route.
    } finally {
      if (attached) await detachWindowsTarget(session, attached);
    }
  }
  delete systemTargetMap(session)[system];
  return loginTarget ? { target: loginTarget, loginRequired: true } : null;
}

async function findDedicatedConnectionTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
): Promise<WindowsTargetInfo | null> {
  let targets: WindowsTargetInfo[];
  try {
    targets = readTargetInfos(
      await session.connection.protocol.send('Target.getTargets', {}),
    ).filter((target) => target.type === 'page');
  } catch {
    return null;
  }
  const rememberedTargetId = connectionTargetMap(session)[system];
  const remembered = targets.find((target) => target.targetId === rememberedTargetId);
  if (remembered) return remembered;
  delete connectionTargetMap(session)[system];

  const expectedName = connectionTabName(system);
  const orderedTargets = [
    ...targets.filter((target) => systemTargetAllowed(target, session.officeCode, system)),
    ...targets.filter((target) => !systemTargetAllowed(target, session.officeCode, system)),
  ];
  for (const target of orderedTargets) {
    let attached: AttachedWindowsTarget | undefined;
    try {
      attached = await attachWindowsTarget(session, target);
      const name = await evaluateValue<unknown>(
        session,
        attached.sessionId,
        'String(window.name||\'\')',
      );
      if (name === expectedName) {
        connectionTargetMap(session)[system] = target.targetId;
        return target;
      }
    } catch {
      // A loading or protected tab cannot be adopted unless its exact name is readable.
    } finally {
      if (attached) await detachWindowsTarget(session, attached);
    }
  }
  return null;
}

async function claimDedicatedConnectionTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
  target: WindowsTargetInfo,
): Promise<void> {
  connectionTargetMap(session)[system] = target.targetId;
  systemTargetMap(session)[system] = target.targetId;
  let attached: AttachedWindowsTarget | undefined;
  try {
    attached = await attachWindowsTarget(session, target);
    await session.connection.protocol.send('Runtime.evaluate', {
      expression: `(()=>{window.name=${JSON.stringify(connectionTabName(system))};return window.name;})()`,
      returnByValue: true,
      awaitPromise: false,
    }, attached.sessionId);
  } catch {
    // The target id remains authoritative while an SSO navigation replaces the document.
  } finally {
    if (attached) await detachWindowsTarget(session, attached);
  }
}

async function openDirectConnectionTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
): Promise<WindowsTargetInfo> {
  const destination = systemConnectionLandingUrl(session.officeCode, system);
  let target = await findDedicatedConnectionTarget(session, system);
  if (target) {
    let attached: AttachedWindowsTarget | undefined;
    try {
      attached = await attachWindowsTarget(session, target);
      await navigateAttachedTarget(session, attached, destination);
      target = { ...target, url: destination };
    } finally {
      if (attached) await detachWindowsTarget(session, attached);
    }
  } else {
    const created = await session.connection.protocol.send<{ targetId?: unknown }>(
      'Target.createTarget',
      { url: destination },
    );
    if (typeof created.targetId !== 'string') {
      throw new Error('업무 시스템 링크를 새 탭으로 열지 못했습니다. 업무용 브라우저를 다시 열어 주세요.');
    }
    target = { targetId: created.targetId, type: 'page', url: destination };
  }
  connectionTargetMap(session)[system] = target.targetId;
  systemTargetMap(session)[system] = target.targetId;
  return target;
}

async function findAuthenticatedConnectionTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
): Promise<WindowsTargetInfo | null> {
  const dedicated = await findDedicatedConnectionTarget(session, system);
  if (!dedicated) return null;
  const inspected = await inspectSystemTarget(session, system, {
    allowedTargetIds: new Set([dedicated.targetId]),
  });
  if (!inspected || inspected.loginRequired) return null;
  await claimDedicatedConnectionTarget(session, system, inspected.target);
  return inspected.target;
}

async function findAuthenticatedSystemTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
): Promise<WindowsTargetInfo | null> {
  const inspected = await inspectSystemTarget(session, system);
  return inspected && !inspected.loginRequired ? inspected.target : null;
}

async function focusExistingSystemTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
  includeLoginRequired = false,
): Promise<boolean> {
  const inspected = includeLoginRequired ? await inspectSystemTarget(session, system) : null;
  const target = inspected?.target ?? await findAuthenticatedSystemTarget(session, system);
  if (!target) return false;
  let attached: AttachedWindowsTarget | undefined;
  try {
    attached = await attachWindowsTarget(session, target);
    await restoreAndActivateTarget(session, target.targetId, attached.sessionId);
    return true;
  } finally {
    if (attached) await detachWindowsTarget(session, attached);
  }
}

async function acquireLoggedInPortalTarget(
  session: WindowsManagedBrowserSession,
  signal?: AbortSignal,
  foreground = true,
): Promise<AttachedWindowsTarget> {
  throwIfApprovalCheckCancelled(signal);
  const protocol = session.connection.protocol;
  const office = getEducationOffice(session.officeCode);
  const portalOrigin = new URL(office.portalUrl).origin;
  const targets = readTargetInfos(await protocol.send('Target.getTargets', {}));
  const portalTargets = targets.filter((candidate) => {
    if (candidate.type !== 'page') return false;
    try {
      return new URL(candidate.url).origin === portalOrigin;
    } catch {
      return false;
    }
  });
  // A previous attempt can leave both a portal login page and the authenticated
  // main page open. Selecting the first target made Connect wait on the stale
  // login page even though the user had already logged in in another tab.
  let target: WindowsTargetInfo | undefined;
  for (const candidate of portalTargets) {
    let attachedCandidate: AttachedWindowsTarget | undefined;
    try {
      attachedCandidate = await attachWindowsTarget(session, candidate);
      const state = readPageReadinessState(
        await evaluateValue(session, attachedCandidate.sessionId, PAGE_READINESS_EXPRESSION),
      );
      if (state && !state.loginVisible && state.origin === portalOrigin) {
        target = { ...candidate, url: state.href };
        break;
      }
    } catch {
      // A stale or redirecting portal tab is ignored in favour of another tab.
    } finally {
      if (attachedCandidate) await detachWindowsTarget(session, attachedCandidate);
    }
  }
  target ??= portalTargets.find((candidate) => candidate.url === office.portalUrl)
    ?? portalTargets[0];
  let shouldNavigate = false;
  if (!target) {
    target = targets.find((candidate) => (
      candidate.targetId === session.bootstrapTargetId && isBootstrapTarget(candidate)
    )) ?? targets.find(isBootstrapTarget);
    shouldNavigate = Boolean(target);
  }
  if (!target) {
    const created = await protocol.send<{ targetId?: unknown }>('Target.createTarget', {
      url: office.portalUrl,
    });
    if (typeof created.targetId !== 'string') {
      throw new Error('업무포털 탭을 만들지 못했습니다. 업무용 브라우저를 다시 열어 주세요.');
    }
    target = { targetId: created.targetId, type: 'page', url: office.portalUrl };
  }
  const attached = await attachWindowsTarget(session, target);
  try {
    if (shouldNavigate) await navigateAttachedTarget(session, attached, office.portalUrl);
    if (foreground) {
      await restoreAndActivateTarget(session, target.targetId, attached.sessionId);
    }
    await waitForReadyPage(
      session,
      attached.sessionId,
      (state) => {
        session.workflowState = state.loginVisible ? 'WAITING_FOR_USER' : 'CHECKING_AUTH';
        return !state.loginVisible && state.origin === portalOrigin;
      },
      foreground ? 180_000 : 15_000,
      foreground
        ? undefined
        : (state) => state.loginVisible
          ? new Error('업무포털 로그인이 필요합니다. 업무용 브라우저에서 로그인해 주세요.')
          : null,
      signal,
    );
    return attached;
  } catch (error) {
    await detachWindowsTarget(session, attached);
    throw error;
  }
}

async function focusExistingPortalTarget(
  session: WindowsManagedBrowserSession,
): Promise<void> {
  const protocol = session.connection.protocol;
  const portalOrigin = new URL(getEducationOffice(session.officeCode).portalUrl).origin;
  const target = readTargetInfos(
    await protocol.send('Target.getTargets', {}),
  ).find((candidate) => {
    if (candidate.type !== 'page') return false;
    try {
      return new URL(candidate.url).origin === portalOrigin;
    } catch {
      return false;
    }
  });
  if (!target) return;
  let attached: AttachedWindowsTarget | undefined;
  try {
    attached = await attachWindowsTarget(session, target);
    await restoreAndActivateTarget(session, target.targetId, attached.sessionId);
  } finally {
    if (attached) await detachWindowsTarget(session, attached);
  }
}

async function waitForSystemTarget(
  session: WindowsManagedBrowserSession,
  system: WebWorkflowSystem,
  signal?: AbortSignal,
  timeoutMs = 30_000,
  options: InspectSystemTargetOptions & {
    connectionTargetId?: string;
    onTargetDetected?: (target: WindowsTargetInfo) => void | Promise<void>;
  } = {},
): Promise<{
  state: 'connected' | 'login-required' | 'missing';
  target?: WindowsTargetInfo;
}> {
  const deadline = Date.now() + timeoutMs;
  let loginTarget: WindowsTargetInfo | undefined;
  let targetDetected = false;
  while (Date.now() < deadline) {
    throwIfApprovalCheckCancelled(signal);
    const targets = readTargetInfos(
      await session.connection.protocol.send('Target.getTargets', {}),
    );
    const candidateTargetIds = new Set<string>();
    for (const target of targets) {
      if (target.type !== 'page') continue;
      if (
        target.targetId === options.connectionTargetId ||
        !options.knownTargetIds?.has(target.targetId) ||
        (
          target.openerId === options.portalTargetId &&
          systemTargetAllowed(target, session.officeCode, system)
        )
      ) {
        candidateTargetIds.add(target.targetId);
      }
    }
    const inspected = candidateTargetIds.size > 0
      ? await inspectSystemTarget(session, system, {
          ...options,
          allowedTargetIds: candidateTargetIds,
        })
      : null;
    if (!targetDetected) {
      const detected = inspected?.target ?? targets.find((target) => (
        candidateTargetIds.has(target.targetId) &&
        systemTargetAllowed(target, session.officeCode, system)
      ));
      if (detected) {
        targetDetected = true;
        await options.onTargetDetected?.(detected);
      }
    }
    if (inspected && !inspected.loginRequired) {
      return { state: 'connected', target: inspected.target };
    }
    if (inspected?.loginRequired) loginTarget = inspected.target;
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
  }
  return loginTarget
    ? { state: 'login-required', target: loginTarget }
    : { state: 'missing' };
}

async function prepareOfficeSystemsViaPortal(
  session: WindowsManagedBrowserSession,
  systems: readonly WebWorkflowSystem[],
  report: WindowsSystemConnectionReporter,
  signal?: AbortSignal,
  foreground = true,
  diagnose?: WindowsConnectionDiagnosticReporter,
): Promise<Map<WebWorkflowSystem, PortalSystemPreparation>> {
  const results = new Map<WebWorkflowSystem, PortalSystemPreparation>();
  const orderedSystems = orderedConnectionSystems(systems);
  for (const system of orderedSystems) {
    const label = system === 'neis' ? '나이스' : 'K-에듀파인';
    report({
      system,
      state: 'connecting',
      message: `업무포털 로그인 후 ${label} 공식 연결을 확인하고 있습니다.`,
    });
  }
  let portal: AttachedWindowsTarget | undefined;
  const portalStartedAt = Date.now();
  try {
    portal = await acquireLoggedInPortalTarget(session, signal, foreground);
    await recordConnectionDiagnostic(diagnose, {
      stepId: 'connection-portal-target',
      outcome: 'success',
      durationMs: Math.max(0, Date.now() - portalStartedAt),
      currentUrl: portal.target.url,
    });
  } catch (error) {
    throwIfApprovalCheckCancelled(signal);
    const message = error instanceof Error
      ? error.message
      : '업무포털 로그인 상태를 확인하지 못했습니다.';
    await recordConnectionDiagnostic(diagnose, {
      stepId: 'connection-portal-target',
      outcome: 'failed',
      durationMs: Math.max(0, Date.now() - portalStartedAt),
    });
    for (const system of orderedSystems) results.set(system, { ready: false, message });
    return results;
  }

  try {
    for (const system of orderedSystems) {
      throwIfApprovalCheckCancelled(signal);
      const label = system === 'neis' ? '나이스' : 'K-에듀파인';
      const reuseStartedAt = Date.now();
      const authenticatedTarget = await findAuthenticatedConnectionTarget(session, system);
      if (authenticatedTarget) {
        try {
          const normalized = await normalizeConnectedSystemTarget(
            session,
            system,
            authenticatedTarget,
            signal,
          );
          await claimDedicatedConnectionTarget(session, system, normalized);
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-target-reused',
            outcome: 'success',
            durationMs: Math.max(0, Date.now() - reuseStartedAt),
            currentUrl: normalized.url,
          });
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-authenticated',
            outcome: 'success',
            durationMs: Math.max(0, Date.now() - reuseStartedAt),
            currentUrl: normalized.url,
          });
          results.set(system, { ready: true, targetId: normalized.targetId });
          continue;
        } catch {
          delete connectionTargetMap(session)[system];
          delete systemTargetMap(session)[system];
        }
      }

      let existingDedicated = await findDedicatedConnectionTarget(session, system);
      const knownTargetIds = new Set(readTargetInfos(
        await session.connection.protocol.send('Target.getTargets', {}),
      ).map(({ targetId }) => targetId));
      const clickStartedAt = Date.now();
      let clicked = false;
      let candidateCount = 0;
      let clickFailureMessage: string | undefined;
      try {
        await restoreAndActivateTarget(session, portal.target.targetId, portal.sessionId);
        const clickDeadline = Date.now() + 30_000;
        let consecutiveEvaluationFailures = 0;
        while (Date.now() < clickDeadline) {
          throwIfApprovalCheckCancelled(signal);
          let result: {
            clicked?: unknown;
            count?: unknown;
            x?: unknown;
            y?: unknown;
          } | null = null;
          try {
            result = await evaluateValue<{
              clicked?: unknown;
              count?: unknown;
              x?: unknown;
              y?: unknown;
            }>(
              session,
              portal.sessionId,
              portalSsoClickExpression(system),
              true,
            );
            if (result?.clicked !== true) {
              result = await findPortalSsoCandidateAcrossFrames(
                session,
                portal.sessionId,
                system,
              ) ?? result;
            }
            consecutiveEvaluationFailures = 0;
          } catch (error) {
            consecutiveEvaluationFailures += 1;
            if (consecutiveEvaluationFailures >= 3) throw error;
          }
          candidateCount = typeof result?.count === 'number' ? result.count : 0;
          if (
            result?.clicked === true &&
            typeof result.x === 'number' &&
            typeof result.y === 'number'
          ) {
            await dispatchCdpMouseClick(session, portal.sessionId, result.x, result.y);
            clicked = true;
            break;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
        }
      } catch (error) {
        throwIfApprovalCheckCancelled(signal);
        clickFailureMessage = error instanceof Error
          ? error.message
          : `${label} 공식 연결 실행에 실패했습니다.`;
      }
      if (!clicked) {
        const message = clickFailureMessage ?? `${label} 공식 연결 메뉴를 업무포털 메인에서 찾지 못했습니다${candidateCount > 0 ? `(${candidateCount}개 후보)` : ''}.`;
        await recordConnectionDiagnostic(diagnose, {
          system,
          stepId: 'connection-sso-click',
          outcome: 'failed',
          durationMs: Math.max(0, Date.now() - clickStartedAt),
        });
        const directStartedAt = Date.now();
        try {
          existingDedicated = await openDirectConnectionTarget(session, system);
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-direct-link',
            outcome: 'success',
            durationMs: Math.max(0, Date.now() - directStartedAt),
            currentUrl: existingDedicated.url,
          });
        } catch (error) {
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-direct-link',
            outcome: 'failed',
            durationMs: Math.max(0, Date.now() - directStartedAt),
          });
          const directMessage = error instanceof Error ? error.message : '교육청 업무 시스템 링크를 열지 못했습니다.';
          results.set(system, { ready: false, message: `${message} ${directMessage}` });
          continue;
        }
      } else {
        await recordConnectionDiagnostic(diagnose, {
          system,
          stepId: 'connection-sso-click',
          outcome: 'success',
          durationMs: Math.max(0, Date.now() - clickStartedAt),
        });
      }

      const targetStartedAt = Date.now();
      let targetWasDetected = false;
      let targetResult = await waitForSystemTarget(
        session,
        system,
        signal,
        clicked ? 90_000 : 45_000,
        {
          knownTargetIds,
          portalTargetId: portal.target.targetId,
          connectionTargetId: existingDedicated?.targetId,
          onTargetDetected: async (target) => {
            targetWasDetected = true;
            await recordConnectionDiagnostic(diagnose, {
              system,
              stepId: 'connection-target-detected',
              outcome: 'success',
              durationMs: Math.max(0, Date.now() - targetStartedAt),
              currentUrl: target.url,
            });
          },
        },
      );
      if (targetResult.state === 'missing' && clicked) {
        const directStartedAt = Date.now();
        try {
          existingDedicated = await openDirectConnectionTarget(session, system);
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-direct-link',
            outcome: 'success',
            durationMs: Math.max(0, Date.now() - directStartedAt),
            currentUrl: existingDedicated.url,
          });
          targetResult = await waitForSystemTarget(
            session,
            system,
            signal,
            45_000,
            {
              knownTargetIds,
              portalTargetId: portal.target.targetId,
              connectionTargetId: existingDedicated.targetId,
              onTargetDetected: async (target) => {
                targetWasDetected = true;
                await recordConnectionDiagnostic(diagnose, {
                  system,
                  stepId: 'connection-target-detected',
                  outcome: 'success',
                  durationMs: Math.max(0, Date.now() - targetStartedAt),
                  currentUrl: target.url,
                });
              },
            },
          );
        } catch {
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-direct-link',
            outcome: 'failed',
            durationMs: Math.max(0, Date.now() - directStartedAt),
          });
        }
      }
      if (!targetWasDetected) {
        await recordConnectionDiagnostic(diagnose, {
          system,
          stepId: 'connection-target-detected',
          outcome: 'failed',
          durationMs: Math.max(0, Date.now() - targetStartedAt),
        });
      }
      const authStartedAt = Date.now();
      if (targetResult.state === 'connected' && targetResult.target) {
        try {
          await claimDedicatedConnectionTarget(session, system, targetResult.target);
          const normalized = await normalizeConnectedSystemTarget(
            session,
            system,
            targetResult.target,
            signal,
          );
          await claimDedicatedConnectionTarget(session, system, normalized);
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-authenticated',
            outcome: 'success',
            durationMs: Math.max(0, Date.now() - authStartedAt),
            currentUrl: normalized.url,
          });
          results.set(system, { ready: true, targetId: normalized.targetId });
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : `${label} 연결 탭을 준비하지 못했습니다.`;
          await recordConnectionDiagnostic(diagnose, {
            system,
            stepId: 'connection-authenticated',
            outcome: 'failed',
            durationMs: Math.max(0, Date.now() - authStartedAt),
            currentUrl: targetResult.target.url,
          });
          results.set(system, { ready: false, message });
        }
      } else if (targetResult.state === 'login-required') {
        if (targetResult.target) {
          connectionTargetMap(session)[system] = targetResult.target.targetId;
        }
        const message = `${label} 창은 열렸지만 공식 SSO 로그인이 완료되지 않았습니다. 열린 시스템 창에서 추가 인증을 완료해 주세요.`;
        await recordConnectionDiagnostic(diagnose, {
          system,
          stepId: 'connection-authenticated',
          outcome: 'failed',
          durationMs: Math.max(0, Date.now() - authStartedAt),
          currentUrl: targetResult.target?.url,
        });
        results.set(system, { ready: false, message });
      } else {
        results.set(system, {
          ready: false,
          message: `${label} 공식 연결을 실행했지만 시스템 탭이 열리지 않았습니다. 업무포털 팝업 허용 상태를 확인해 주세요.`,
        });
      }
    }
  } finally {
    await detachWindowsTarget(session, portal);
  }
  return results;
}

export async function connectWindowsOfficeSystems(
  session: WindowsManagedBrowserSession,
  systems: readonly WebWorkflowSystem[],
  report: WindowsSystemConnectionReporter = () => undefined,
  signal?: AbortSignal,
  foreground = false,
  diagnose?: WindowsConnectionDiagnosticReporter,
): Promise<void> {
  const portalPreparations = foreground
    ? await prepareOfficeSystemsViaPortal(session, systems, report, signal, true, diagnose)
    : null;
  try {
    for (const system of orderedConnectionSystems(systems)) {
      throwIfApprovalCheckCancelled(signal);
      const label = system === 'neis' ? '나이스' : 'K-에듀파인';
      const preparation = portalPreparations?.get(system);
      if (preparation && !preparation.ready) {
        const message = preparation.message ?? `${label} 공식 연결을 완료하지 못했습니다.`;
        report({
          system,
          state: /로그인|인증/.test(message) ? 'login-required' : 'error',
          message,
        });
        continue;
      }
      report({ system, state: 'connecting', message: `${label}에 연결하고 있습니다.` });
      let page: WindowsWorkflowPage | undefined;
      try {
        page = await openCdpWindowsWorkflowPage(
          session,
          connectionProbeWorkflowId(system),
          undefined,
          {
            background: portalPreparations !== null || !foreground,
            failFastOnLoginRequired: true,
            recoverViaPortal: false,
            signal,
          },
        );
        throwIfApprovalCheckCancelled(signal);
        if (portalPreparations !== null) {
          const verifiedTarget = await findAuthenticatedConnectionTarget(session, system);
          if (
            !verifiedTarget ||
            !preparation?.targetId ||
            verifiedTarget.targetId !== preparation.targetId
          ) {
            throw new Error(`${label} 전용 연결 탭의 로그인 상태를 확인하지 못했습니다. 업무포털에서 다시 연결해 주세요.`);
          }
        }
        report({ system, state: 'connected', checkedAt: Date.now() });
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : `${label} 연결에 실패했습니다.`;
        const loginRequired = /로그인|인증|기다리는 시간이 지났습니다/.test(message);
        report({
          system,
          state: loginRequired ? 'login-required' : 'error',
          message,
        });
      } finally {
        await page?.release?.();
      }
    }
  } finally {
    if (foreground) {
      let systemFocused = false;
      for (const system of orderedConnectionSystems(systems)) {
        try {
          systemFocused = await focusExistingSystemTarget(session, system, true) || systemFocused;
        } catch {
          // Keep the other connected system available when one tab disappears.
        }
      }
      if (!systemFocused) {
        try {
          await focusExistingPortalTarget(session);
        } catch {
          // System connection status is more important than best-effort portal focus.
        }
      }
    }
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
  ) ?? targets.find(isBootstrapTarget);
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
  const locations = [
    ['HKCR\\wxsclient\\shell\\open\\command', '/reg:64'],
    ['HKCR\\wxsclient\\shell\\open\\command', '/reg:32'],
    ['HKCU\\Software\\Classes\\wxsclient\\shell\\open\\command'],
  ] as const;
  for (const [location, view] of locations) {
    const output = await runWindowsCommand(
      'reg.exe',
      ['query', location, '/ve', ...(view ? [view] : [])],
    );
    if (output?.trim()) return true;
  }
  return false;
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
      const handle = Number(record.MainWindowHandle);
      return [{
        id: Number(record.Id),
        title: record.MainWindowTitle,
        ...(Number.isSafeInteger(handle) && handle > 0 ? { handle } : {}),
      }];
    });
  } catch {
    return [];
  }
}

export async function listWxsClientWindows(): Promise<WxsClientWindow[]> {
  const command = "Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -like 'WXSClient*' -and $_.MainWindowHandle -ne 0} | Select-Object Id,MainWindowTitle,MainWindowHandle | ConvertTo-Json -Compress";
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

export async function closeWxsClientWindow(id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const command = `$p=Get-Process -Id ${Number(id)} -ErrorAction Stop; if($p.ProcessName -notlike 'WXSClient*'){exit 2}; if(-not $p.CloseMainWindow()){exit 3}; for($i=0;$i -lt 30;$i++){Start-Sleep -Milliseconds 100; if($p.HasExited){exit 0}; $p.Refresh(); if($p.MainWindowHandle -eq 0){exit 0}}; exit 4`;
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
  cancelApprovalChecks(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): void;
  beginInteractiveWork(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): void;
  endInteractiveWork(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): void;
  connectSystems(
    input: WindowsSystemConnectionRequest,
    report?: WindowsSystemConnectionReporter,
  ): Promise<void>;
};

export function createWindowsManagedSessionManager(
  options: CreateWindowsManagedSessionManagerOptions,
): WindowsManagedSessionController {
  const workflowDependencies: ExecuteWindowsWorkflowDependencies = {
    openWorkflowPage: async (session, workflowId, workflowSpec) => {
      if (!('connection' in session)) {
        throw new Error('업무용 브라우저 연결 정보가 없습니다. 브라우저를 다시 열어 주세요.');
      }
      const windowsSession = session as WindowsManagedBrowserSession;
      await resetWindowsWorkflowTargets(windowsSession, workflowId, workflowSpec);
      return openCdpWindowsWorkflowPage(
        windowsSession,
        workflowId,
        workflowSpec,
        // Keep the connected system at its current screen. Global/left menu
        // traversal can start there without discarding an already opened form.
        { navigateExistingTarget: false },
      );
    },
    isWxsClientRegistered,
    listWxsClientWindows,
    closeWxsClientWindow,
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
  const approvalChecks = new Map<string, AbortController>();
  const interactiveWork = new Map<string, number>();
  const approvalKey = (
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ) => `${officeCode}:${browserId}`;
  return Object.assign(manager, {
    connectSystems(
      input: WindowsSystemConnectionRequest,
      report?: WindowsSystemConnectionReporter,
    ) {
      return manager.use(input.officeCode, input.browserId, (session) => (
        connectWindowsOfficeSystems(
          session,
          input.systems,
          report,
          input.signal,
          input.foreground,
          input.diagnose,
        )
      ));
    },
    checkApproval(input: ApprovalScanInput) {
      const key = approvalKey(input.officeCode, input.browserId);
      if ((interactiveWork.get(key) ?? 0) > 0) {
        return Promise.reject(createApprovalCheckCancelledError());
      }
      approvalChecks.get(key)?.abort();
      const abortController = new AbortController();
      approvalChecks.set(key, abortController);
      const check = manager.use(input.officeCode, input.browserId, async (session) => {
        throwIfApprovalCheckCancelled(abortController.signal);
        if ((interactiveWork.get(key) ?? 0) > 0) {
          throw createApprovalCheckCancelledError();
        }
        return scanWindowsApprovalCount(session, input, {
          openPage: (managedSession, scanInput, signal) => openCdpWindowsApprovalPage(
            managedSession as WindowsManagedBrowserSession,
            scanInput,
            signal,
          ),
        }, abortController.signal);
      });
      return check.finally(() => {
        if (approvalChecks.get(key) === abortController) approvalChecks.delete(key);
      });
    },
    cancelApprovalChecks(
      officeCode: EducationOfficeCode,
      browserId: WebConnectorBrowserId,
    ) {
      approvalChecks.get(approvalKey(officeCode, browserId))?.abort();
    },
    beginInteractiveWork(
      officeCode: EducationOfficeCode,
      browserId: WebConnectorBrowserId,
    ) {
      const key = approvalKey(officeCode, browserId);
      interactiveWork.set(key, (interactiveWork.get(key) ?? 0) + 1);
      approvalChecks.get(key)?.abort();
    },
    endInteractiveWork(
      officeCode: EducationOfficeCode,
      browserId: WebConnectorBrowserId,
    ) {
      const key = approvalKey(officeCode, browserId);
      const remaining = Math.max(0, (interactiveWork.get(key) ?? 0) - 1);
      if (remaining === 0) interactiveWork.delete(key);
      else interactiveWork.set(key, remaining);
    },
  });
}
