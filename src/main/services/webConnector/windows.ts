import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { win32 } from 'node:path';
import { getEducationOffice, isAllowedOfficeHost } from '../../../shared/educationOffices';
import type {
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebWorkflowId,
} from '../../../shared/types';
import {
  getWebWorkflowTarget,
  isAllowedWebWorkflowTarget,
} from '../../../shared/webWorkflows';
import type { ManagedBrowserConnection } from './cdp/transport';
import {
  connectManagedBrowser,
  type ManagedBrowserConnectOptions,
} from './cdp/transport';
import type { CandidateSummary, WorkflowStep } from './workflows/common';
import { runWorkflow, type WorkflowPageAdapter, type WorkflowRunResult } from './workflows/engine';
import { EDUFINE_WORKFLOWS } from './workflows/edufine';
import { NEIS_WORKFLOWS } from './workflows/neis';
import {
  ManagedBrowserSessionManager,
  type ManagedBrowserSession,
  type ManagedWorkflowRequest,
} from './sessionManager';

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

export interface WindowsManagedBrowserSession extends ManagedBrowserSession {
  readonly connection: ManagedBrowserConnection;
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
}

export interface ExecuteWindowsWorkflowDependencies {
  openWorkflowPage(
    session: ManagedBrowserSession,
    workflowId: WebWorkflowId,
  ): Promise<WindowsWorkflowPage>;
  isWxsClientRegistered(): Promise<boolean>;
  listWxsClientWindows(): Promise<readonly WxsClientWindow[]>;
  focusWindow(id: number): Promise<boolean>;
}

const MANAGED_WORKFLOWS = { ...NEIS_WORKFLOWS, ...EDUFINE_WORKFLOWS };

function managedWorkflowDefinition(workflowId: WebWorkflowId) {
  return MANAGED_WORKFLOWS[workflowId];
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
): WindowsTargetInfo | null {
  return targets.find((target) => (
    target.type === 'page' &&
    isAllowedWebWorkflowTarget(workflowId, target.url, officeCode)
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
  let closed = false;
  return {
    officeCode,
    browserId,
    connection,
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
  if (
    !isAllowedOfficeHost(officeCode, parsed.href) ||
    !isAllowedWebWorkflowTarget(workflowId, parsed.href, officeCode)
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
  const definition = managedWorkflowDefinition(request.workflowId);
  if (request.workflowId === 'edufine-draft' && !await dependencies.isWxsClientRegistered()) {
    throw new Error('기안 편집 프로그램이 설치되어 있지 않습니다. 에듀파인 설치 안내에서 WXSClient를 설치한 뒤 다시 시도해 주세요.');
  }
  const existingWindows = request.workflowId === 'edufine-draft'
    ? new Set((await dependencies.listWxsClientWindows()).map(({ id }) => id))
    : new Set<number>();
  let newEditorWindow: WxsClientWindow | undefined;
  const page = await dependencies.openWorkflowPage(session, request.workflowId);
  const assertOrigin = async (): Promise<void> => validateWorkflowOrigin(
    await page.currentOrigin(),
    request.officeCode,
    request.workflowId,
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
  return result;
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
const visible=(element)=>{
  if(element.hidden||element.getAttribute?.('aria-hidden')==='true')return false;
  const view=element.ownerDocument?.defaultView;
  const style=view?.getComputedStyle(element);
  if(!style||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
  const rect=element.getBoundingClientRect();
  return rect.width>0&&rect.height>0;
};
const enabled=(element)=>!(element.disabled===true||element.getAttribute?.('aria-disabled')==='true');
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
  return {index,text:textOf(element),visible:visible(element),enabled:enabled(element),width:rect.width,height:rect.height};
});
})()`;

function candidateActionExpression(
  index: number,
  expectedText: string,
  domClick: boolean,
): string {
  return `(()=>{
${PAGE_ELEMENT_HELPERS}
const item=clickable()[${index}];
if(!item||textOf(item.element)!==${JSON.stringify(expectedText)}||!visible(item.element)||!enabled(item.element))return {ok:false};
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
      typeof candidate.height !== 'number'
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

export async function openCdpWindowsWorkflowPage(
  session: WindowsManagedBrowserSession,
  workflowId: WebWorkflowId,
): Promise<WindowsWorkflowPage> {
  const protocol = session.connection.protocol;
  const targets = readTargetInfos(await protocol.send('Target.getTargets', {}));
  let target = selectWindowsWorkflowTarget(targets, session.officeCode, workflowId);
  if (!target) {
    const created = await protocol.send<{ targetId?: unknown }>('Target.createTarget', {
      url: getWebWorkflowTarget(workflowId, session.officeCode),
    });
    if (typeof created.targetId !== 'string') {
      throw new Error('업무용 브라우저 탭을 만들지 못했습니다. 브라우저를 다시 열어 주세요.');
    }
    target = {
      targetId: created.targetId,
      type: 'page',
      url: getWebWorkflowTarget(workflowId, session.officeCode),
    };
  }
  const attached = await protocol.send<{ sessionId?: unknown }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  if (typeof attached.sessionId !== 'string') {
    throw new Error('업무용 브라우저 탭에 연결하지 못했습니다. 브라우저를 다시 열어 주세요.');
  }
  const sessionId = attached.sessionId;
  await protocol.send('Page.enable', {}, sessionId);
  let reachedHttpOrigin = false;
  for (let check = 0; check < 60; check += 1) {
    const origin = await evaluateValue<unknown>(session, sessionId, 'location.origin');
    if (typeof origin === 'string' && /^https?:\/\//.test(origin)) {
      reachedHttpOrigin = true;
      break;
    }
    if (check < 59) await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (!reachedHttpOrigin) {
    throw new Error('업무 시스템 화면이 열리는 시간이 지났습니다. 네트워크를 확인한 뒤 업무용 브라우저를 다시 열어 주세요.');
  }
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
      const normalizedText = candidate.text.replace(/\s+/g, ' ').trim();
      const action = await evaluateValue<{ ok?: unknown; x?: unknown; y?: unknown }>(
        session,
        sessionId,
        candidateActionExpression(candidate.index, normalizedText, step.interaction === 'dom-click'),
        step.interaction === 'dom-click',
      );
      if (!action?.ok) {
        throw new Error(`'${normalizedText}' 메뉴의 위치가 바뀌었습니다. 화면을 확인한 뒤 키를 다시 눌러 주세요.`);
      }
      if (step.interaction === 'dom-click') return;
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
      await protocol.send('Target.activateTarget', { targetId: target.targetId });
      await protocol.send('Page.bringToFront', {}, sessionId);
    },
  };
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

export function createWindowsManagedSessionManager(
  options: CreateWindowsManagedSessionManagerOptions,
): ManagedBrowserSessionManager<WindowsManagedBrowserSession, WorkflowRunResult> {
  const workflowDependencies: ExecuteWindowsWorkflowDependencies = {
    openWorkflowPage: async (session, workflowId) => {
      if (!('connection' in session)) {
        throw new Error('업무용 브라우저 연결 정보가 없습니다. 브라우저를 다시 열어 주세요.');
      }
      return openCdpWindowsWorkflowPage(session as WindowsManagedBrowserSession, workflowId);
    },
    isWxsClientRegistered,
    listWxsClientWindows,
    focusWindow: focusWxsClientWindow,
    ...options.workflowDependencies,
  };
  return new ManagedBrowserSessionManager({
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
  });
}

export function resolveWindowsConnectorBrowserExecutable(
  browserPath: string,
  exists: (path: string) => boolean,
): string | null {
  return exists(browserPath) ? browserPath : null;
}
