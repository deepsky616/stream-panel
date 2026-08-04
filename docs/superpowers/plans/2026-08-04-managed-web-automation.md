# 업무용 브라우저 자동 이동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 윈도우에서 별도 확장 기능 없이 전용 엣지 또는 크롬으로 나이스 복무·출장과 에듀파인 기안·품의 화면까지 안전하게 이동하고, 맥과 개인 브라우저는 건드리지 않는다.

**Architecture:** 기존 `WebConnectorService`와 IPC 모양은 유지하되 내부를 전용 브라우저 프로세스, 개발 도구 통신, 세션 관리, 상태 기반 업무 엔진으로 교체한다. 교육청과 브라우저별 프로필을 분리하고 파이프 연결을 먼저 쓰며, 실패할 때만 무작위 로컬 포트로 한 번 다시 시도한다. 렌더러는 교육청과 업무용 브라우저만 고르고 임의 주소, 선택자, 스크립트 또는 개발 도구 명령을 보낼 수 없다.

**Tech Stack:** Electron 43, TypeScript 6, Node 자식 프로세스와 파일 입출력, 크롬 개발 도구 규약, React 18, Vitest 4, 순수 CSS

## 전체 제약

- `AppConfig`에 승인된 `educationOfficeCode`만 추가하고 `WebWorkflowSpec`, `WebConnectorStatus`, IPC 이름과 IPC 입력·출력 모양은 바꾸지 않는다.
- 윈도우 전용 동작은 `services/webConnector/windows.ts` 경계 안에서 고르고 맥 구현은 실행·연결 없이 안전한 기본값을 반환한다.
- 자식 프로세스는 인자 배열로 실행하며 `shell: true`를 쓰지 않는다.
- 개인 브라우저 프로필, 고정 제어 포트, 외부 인터페이스, 임의 실행 파일 경로, 임의 스크립트와 임의 선택자를 허용하지 않는다.
- 저장·제출·상신·승인·결재·확정은 누르지 않는다. 후보가 없거나 둘 이상이면 중단한다.
- 새 기능은 먼저 실패하는 시험을 만들고 최소 구현으로 통과시킨다.
- 실제 나이스·에듀파인 계정과 기관 권한이 필요한 성공 여부는 자동 시험 통과와 구분한다.

---

## 작업 1: 교육청 목록과 설정 이전

**파일:**

- 새 파일: `src/shared/educationOffices.ts`
- 수정: `src/shared/types.ts`
- 수정: `src/shared/defaults.ts`
- 수정: `src/shared/webWorkflows.ts`
- 수정: `src/main/store.ts`
- 수정: `src/main/security/inputValidation.ts`
- 수정: `src/main/security/validate.ts`
- 시험: `tests/educationOffices.test.ts`
- 시험: `tests/store-migration.test.ts`
- 시험: `tests/validate.test.ts`
- 시험: `tests/webWorkflows.test.ts`

- [ ] 1.1 `EducationOfficeCode`와 17개 교육청의 고정 주소 시험을 먼저 추가한다.

```ts
expect(EDUCATION_OFFICES).toHaveLength(17);
expect(getEducationOffice('goe')).toMatchObject({
  portalUrl: 'https://goe.eduptl.kr/',
  neisUrl: 'https://goe.neis.go.kr/',
  edufineUrl: 'https://klef.goe.go.kr/',
});
expect(getEducationOffice('gbe').edufineUrl).toBe('https://klef.gbe.kr/');
expect(isAllowedOfficeHost('goe', 'https://goe.neis.go.kr/path?token=secret')).toBe(true);
expect(isAllowedOfficeHost('goe', 'https://evil.example/')).toBe(false);
```

- [ ] 1.2 설정에 교육청 값이 없거나 잘못되면 `goe`로 이전하고, 승인된 값만 IPC 설정 변경으로 받는 시험을 추가한다.

```ts
expect(recoverConfigText(JSON.stringify(legacy), defaults).config.educationOfficeCode).toBe('goe');
expect(recoverConfigText(JSON.stringify({ ...legacy, educationOfficeCode: 'sen' }), defaults)
  .config.educationOfficeCode).toBe('sen');
expect(() => assertConfigPatch({ educationOfficeCode: 'wrong' })).toThrow(/교육청/);
```

- [ ] 1.3 해당 시험이 실패하는지 확인한다.

실행: `npm test -- --run tests/educationOffices.test.ts tests/store-migration.test.ts tests/validate.test.ts tests/webWorkflows.test.ts`

기대: `EducationOfficeCode`, `EDUCATION_OFFICES` 또는 `educationOfficeCode`가 없어 실패한다.

- [ ] 1.4 타입과 고정 목록을 최소 구현한다.

```ts
export type EducationOfficeCode =
  | 'sen' | 'goe' | 'gne' | 'pen' | 'dge' | 'dje'
  | 'gbe' | 'sje' | 'use' | 'ice' | 'gen' | 'jne'
  | 'jbe' | 'cne' | 'cbe' | 'gwe' | 'jje';

export interface AppConfig {
  educationOfficeCode: EducationOfficeCode;
}
```

`src/shared/educationOffices.ts`에는 각 코드, 한국어 이름, `portalUrl`, `neisUrl`, `edufineUrl`을 값으로 적는다. 주소는 사용자 문자열 조합이 아니라 이 목록에서만 꺼낸다.

- [ ] 1.5 `createDefaultConfig`, `migrateKnownConfig`, `assertConfigPatch`에 `goe` 기본값과 정확한 값 검사를 넣는다.

- [ ] 1.6 `createWebWorkflowTemplate`와 허용 주소 검사를 교육청 인자로 바꾸고, 교육청이 바뀌어도 키 식별자·이름·아이콘·브라우저와 멀티 액션 참조를 유지하는 `retargetWebWorkflowItems`를 구현한다.

```ts
export function retargetWebWorkflowItems(
  items: readonly DeckItem[],
  officeCode: EducationOfficeCode,
): DeckItem[];
```

- [ ] 1.7 시험을 다시 실행해 통과를 확인한다.

실행: `npm test -- --run tests/educationOffices.test.ts tests/store-migration.test.ts tests/validate.test.ts tests/webWorkflows.test.ts`

기대: 네 시험 파일이 모두 통과한다.

- [ ] 1.8 커밋한다.

```bash
git add src/shared/educationOffices.ts src/shared/types.ts src/shared/defaults.ts src/shared/webWorkflows.ts src/main/store.ts src/main/security/inputValidation.ts src/main/security/validate.ts tests/educationOffices.test.ts tests/store-migration.test.ts tests/validate.test.ts tests/webWorkflows.test.ts
git commit -m "feat: 교육청별 웹 업무 주소 추가"
```

## 작업 2: 전용 프로필과 안전한 브라우저 실행 계획

**파일:**

- 새 파일: `src/main/services/webConnector/browserProcess.ts`
- 수정: `src/main/services/webConnector/windows.ts`
- 수정: `src/main/services/webConnector/macos.ts`
- 시험: `tests/webConnectorBrowserProcess.test.ts`

- [ ] 2.1 교육청·브라우저별 프로필 경로, 알려진 실행 파일 탐색, 실행 인자와 소유 프로세스 종료 시험을 먼저 쓴다.

```ts
expect(resolveManagedProfilePath('C:\\Data', 'sen', 'edge'))
  .toBe('C:\\Data\\web-browsers\\sen\\edge');
expect(buildManagedBrowserLaunch('edge', profile, 'pipe').args).toEqual([
  `--user-data-dir=${profile}`,
  '--new-window',
  '--remote-debugging-pipe',
]);
expect(buildManagedBrowserLaunch('chrome', profile, 'port').args)
  .toContain('--remote-debugging-port=0');
expect(args.some((value) => value.includes('profile-directory'))).toBe(false);
expect(args.some((value) => value.includes('9222'))).toBe(false);
```

- [ ] 2.2 시험을 실행해 새 모듈 부재로 실패하는지 확인한다.

실행: `npm test -- --run tests/webConnectorBrowserProcess.test.ts`

기대: `browserProcess.ts`를 찾지 못해 실패한다.

- [ ] 2.3 경로 이탈을 막는 `resolveManagedProfilePath`, 고정 인자만 만드는 `buildManagedBrowserLaunch`, 엣지와 크롬의 알려진 위치만 확인하는 `resolveManagedBrowserExecutable`을 구현한다.

```ts
export interface ManagedBrowserLaunch {
  executable: string;
  args: readonly string[];
  stdio: 'pipe' | ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'];
}
```

- [ ] 2.4 `spawn` 결과를 `OwnedBrowserProcess`로 감싸고, 해당 객체가 만든 프로세스만 정상 종료 요청 뒤 제한 시간 내 종료 확인을 하도록 구현한다. 소유권 없는 프로세스 번호를 받는 함수는 만들지 않는다.

- [ ] 2.5 `windows.ts`는 윈도우 실행 계획을 반환하고 `macos.ts`는 항상 안전한 미지원 결과를 반환하는 주입 가능 어댑터를 제공한다.

- [ ] 2.6 시험을 다시 실행하고 통과를 확인한다.

실행: `npm test -- --run tests/webConnectorBrowserProcess.test.ts`

기대: 모든 전용 프로필·인자·소유권 시험이 통과한다.

- [ ] 2.7 커밋한다.

```bash
git add src/main/services/webConnector/browserProcess.ts src/main/services/webConnector/windows.ts src/main/services/webConnector/macos.ts tests/webConnectorBrowserProcess.test.ts
git commit -m "feat: 안전한 업무용 브라우저 실행 경계 추가"
```

## 작업 3: 개발 도구 통신과 무작위 포트 예비 연결

**파일:**

- 새 파일: `src/main/services/webConnector/cdp/transport.ts`
- 새 파일: `src/main/services/webConnector/cdp/pipeTransport.ts`
- 새 파일: `src/main/services/webConnector/cdp/portTransport.ts`
- 새 파일: `src/main/services/webConnector/cdp/protocol.ts`
- 시험: `tests/webConnectorCdp.test.ts`

- [ ] 3.1 `DevToolsActivePort` 검증 시험과 명령 응답 연결 시험을 먼저 작성한다.

```ts
expect(parseDevToolsActivePort('53421\n/devtools/browser/abc-123\n')).toEqual({
  port: 53421,
  browserPath: '/devtools/browser/abc-123',
});
expect(() => parseDevToolsActivePort('1023\n/devtools/browser/abc\n')).toThrow(/범위/);
expect(() => parseDevToolsActivePort('53421\nws:\/\/evil.example\/x\n')).toThrow(/형식/);
await expect(protocol.send('Target.getTargets', {})).resolves.toMatchObject({ targetInfos: [] });
expect(() => protocol.send('Network.getAllCookies' as never, {})).toThrow(/허용/);
```

- [ ] 3.2 파이프가 제한 시간 안에 응답하지 않으면 소유 자식만 닫고 `--remote-debugging-port=0`으로 정확히 한 번 다시 시도하는 시험을 작성한다.

- [ ] 3.3 시험을 실행해 실패를 확인한다.

실행: `npm test -- --run tests/webConnectorCdp.test.ts`

기대: 개발 도구 통신 모듈을 찾지 못해 실패한다.

- [ ] 3.4 크로미움 원본 구현과 같은 널 문자로 끝나는 JSON 파이프 전송과 요청 번호별 응답을 연결하는 `CdpProtocol`을 구현한다. 허용 명령은 코드에 고정된 합집합 타입으로 제한한다.

```ts
export type AllowedCdpMethod =
  | 'Browser.getVersion'
  | 'Browser.close'
  | 'Target.getTargets'
  | 'Target.createTarget'
  | 'Target.attachToTarget'
  | 'Target.activateTarget'
  | 'Target.setDiscoverTargets'
  | 'Page.enable'
  | 'Page.navigate'
  | 'Page.bringToFront'
  | 'Runtime.evaluate'
  | 'Input.dispatchMouseEvent';
```

- [ ] 3.5 무작위 포트 방식은 전용 프로필 바로 아래의 `DevToolsActivePort`만 읽고 포트 1024~65535, 식별자 문자와 길이, `127.0.0.1`, 브라우저 제품 이름을 검증한다. 전체 웹소켓 주소와 포트는 저장하거나 기록하지 않는다.

- [ ] 3.6 파이프 우선과 한 번의 포트 예비 연결을 `connectManagedBrowser`로 묶는다.

```ts
export async function connectManagedBrowser(
  options: ManagedBrowserConnectOptions,
): Promise<ManagedBrowserConnection>;
```

- [ ] 3.7 시험을 다시 실행해 통과를 확인한다.

실행: `npm test -- --run tests/webConnectorCdp.test.ts`

기대: 정상 응답, 제한 시간, 잘못된 포트, 외부 주소, 브라우저 불일치와 한 번 재시도 시험이 모두 통과한다.

- [ ] 3.8 커밋한다.

```bash
git add src/main/services/webConnector/cdp tests/webConnectorCdp.test.ts
git commit -m "feat: 업무용 브라우저 개발 도구 통신 추가"
```

## 작업 4: 민감 정보 없는 상태와 진단 기록

**파일:**

- 수정: `src/main/services/webConnector/state.ts`
- 새 파일: `src/main/services/webConnector/diagnostics.ts`
- 시험: `tests/webConnectorState.test.ts`
- 시험: `tests/webConnectorDiagnostics.test.ts`

- [ ] 4.1 예전 토큰·확장 짝 상태를 읽지 않고 새 `managed-state.json` 형식으로 이전하는 시험을 작성한다.

```ts
expect(await loadManagedState({ read: async () => legacyText, write })).toEqual({
  version: 1,
  offices: {},
  legacyExtensionNoticeShown: false,
});
expect(JSON.stringify(saved)).not.toMatch(/token|port|pid|websocket|url/i);
```

- [ ] 4.2 진단 기록이 전체 주소, 검색값, 쿠키, 입력값과 화면 글자를 버리고 호스트와 고정 단계만 남기는 시험을 작성한다.

- [ ] 4.3 시험 실패를 확인한다.

실행: `npm test -- --run tests/webConnectorState.test.ts tests/webConnectorDiagnostics.test.ts`

기대: 새 상태와 진단 함수가 없어 실패한다.

- [ ] 4.4 다음 모양으로 상태를 최소 구현한다.

```ts
export interface ManagedWebConnectorState {
  version: 1;
  offices: Partial<Record<EducationOfficeCode, Partial<Record<WebConnectorBrowserId, {
    lastSeenAt: number;
  }>>>>;
  legacyExtensionNoticeShown: boolean;
}
```

- [ ] 4.5 진단 파일은 `userData/web-connector/diagnostics/` 안에만 쓰고 브라우저, 교육청, 업무, 단계, 결과, 걸린 시간, 호스트만 허용한다. 오류 객체의 원문과 개발 도구 응답 본문은 기록하지 않는다.

- [ ] 4.6 시험을 다시 실행해 통과를 확인한다.

실행: `npm test -- --run tests/webConnectorState.test.ts tests/webConnectorDiagnostics.test.ts`

기대: 이전·허용 필드·민감 값 제거 시험이 통과한다.

- [ ] 4.7 커밋한다.

```bash
git add src/main/services/webConnector/state.ts src/main/services/webConnector/diagnostics.ts tests/webConnectorState.test.ts tests/webConnectorDiagnostics.test.ts
git commit -m "feat: 업무용 브라우저 상태와 안전 진단 추가"
```

## 작업 5: 상태 기반 안전 업무 엔진

**파일:**

- 새 파일: `src/main/services/webConnector/workflows/common.ts`
- 새 파일: `src/main/services/webConnector/workflows/engine.ts`
- 새 파일: `src/main/services/webConnector/workflows/neis.ts`
- 새 파일: `src/main/services/webConnector/workflows/edufine.ts`
- 시험: `tests/webWorkflowEngine.test.ts`
- 시험: `tests/webWorkflowDefinitions.test.ts`

- [ ] 5.1 보이는 활성 후보 하나만 고르고 금지 문구와 모호한 후보를 거부하는 순수 로직 시험을 먼저 쓴다.

```ts
expect(selectSafeCandidate([{ text: '복무', visible: true, enabled: true }], ['복무']))
  .toMatchObject({ text: '복무' });
expect(() => selectSafeCandidate([
  { text: '복무', visible: true, enabled: true },
  { text: '복무', visible: true, enabled: true },
], ['복무'])).toThrow(/둘 이상/);
expect(() => selectSafeCandidate([{ text: '결재 승인', visible: true, enabled: true }], ['결재 승인']))
  .toThrow(/누를 수 없는/);
```

- [ ] 5.2 네 업무의 단계 식별자, 승인된 정확한 이름과 별칭, 뒤 조건, 제한 시간과 끝 지점을 시험한다. 저장·제출·상신·승인·결재·확정 문구가 어느 허용 후보에도 없음을 함께 검사한다.

- [ ] 5.3 단계 누르기 뒤 뒤 조건이 확인되지 않으면 다음 단계로 넘어가지 않고 세 번째 실패 또는 모호함에서 즉시 중단하는 시험을 쓴다.

- [ ] 5.4 시험 실패를 확인한다.

실행: `npm test -- --run tests/webWorkflowEngine.test.ts tests/webWorkflowDefinitions.test.ts`

기대: 새 업무 엔진과 정의가 없어 실패한다.

- [ ] 5.5 화면 조사 결과를 최소한의 `CandidateSummary`로 줄이고 정확한 이름만 비교하는 함수를 구현한다. 화면 전체 글자, 입력값과 자바스크립트 원문은 엔진 밖으로 내보내지 않는다.

```ts
export interface CandidateSummary {
  index: number;
  text: string;
  visible: boolean;
  enabled: boolean;
  width: number;
  height: number;
}
```

- [ ] 5.6 `runWorkflow`는 각 단계의 조사, 안전 후보 판정, 사용자 입력 사건, 뒤 조건 검사를 순서대로 수행하고 고정된 오류 코드와 원인·해결 안내를 반환하게 한다.

- [ ] 5.7 나이스 복무·출장과 에듀파인 기안·품의의 끝 지점에서 멈추는 정의를 구현한다.

- [ ] 5.8 시험을 다시 실행해 통과를 확인한다.

실행: `npm test -- --run tests/webWorkflowEngine.test.ts tests/webWorkflowDefinitions.test.ts`

기대: 안전 후보, 금지 문구, 뒤 조건, 재시도 한계와 네 업무 정의 시험이 모두 통과한다.

- [ ] 5.9 커밋한다.

```bash
git add src/main/services/webConnector/workflows tests/webWorkflowEngine.test.ts tests/webWorkflowDefinitions.test.ts
git commit -m "feat: 상태 기반 웹 업무 이동 엔진 추가"
```

## 작업 6: 세션 관리자와 윈도우 자동 이동 어댑터

**파일:**

- 새 파일: `src/main/services/webConnector/sessionManager.ts`
- 수정: `src/main/services/webConnector/windows.ts`
- 수정: `src/main/services/webConnector/macos.ts`
- 시험: `tests/webConnectorSessionManager.test.ts`
- 시험: `tests/webConnectorPlatform.test.ts`

- [ ] 6.1 같은 교육청·브라우저 요청 직렬화, 세션 재사용, 브라우저 종료 뒤 업무 전 한 번 복구, 교육청 변경과 앱 종료 때 소유 세션만 닫는 시험을 먼저 쓴다.

- [ ] 6.2 대상은 선택한 교육청의 포털·나이스·에듀파인 호스트만 인정하고 다른 호스트 탭은 무시하거나 중단하는 시험을 쓴다.

- [ ] 6.3 로그인 필요, 공지창, 이미 열린 신청창, 에듀파인 새 편집기 창과 편집 프로그램 없음 결과를 주입 어댑터로 시험한다.

- [ ] 6.4 맥 어댑터가 브라우저 실행, 파일 쓰기, 개발 도구 연결을 한 번도 부르지 않고 미지원 결과와 빈 상태만 반환하는 시험을 쓴다.

- [ ] 6.5 시험 실패를 확인한다.

실행: `npm test -- --run tests/webConnectorSessionManager.test.ts tests/webConnectorPlatform.test.ts`

기대: 세션 관리자와 새 플랫폼 어댑터가 없어 실패한다.

- [ ] 6.6 `ManagedBrowserSessionManager`를 구현한다.

```ts
export interface ManagedBrowserSessionManager {
  prepare(officeCode: EducationOfficeCode, browserId: WebConnectorBrowserId): Promise<ManagedSession>;
  run(request: ManagedWorkflowRequest): Promise<ManagedWorkflowResult>;
  closeOtherOffices(officeCode: EducationOfficeCode): Promise<void>;
  closeAll(): Promise<void>;
}
```

- [ ] 6.7 윈도우 어댑터는 허용 호스트 탭만 붙이고, 고정 조사 스크립트와 고정 입력 사건만 개발 도구 통신에 보낸다. 나이스·에듀파인 공지창은 안전 후보 하나일 때만 닫는다.

- [ ] 6.8 에듀파인 기안은 작업 전 알려진 편집기 창 목록과 작업 뒤 목록을 비교해 새 창만 앞으로 가져온다. 브라우저 환경 파일은 바꾸지 않고 공식 외부 프로그램 확인창은 사용자에게 맡긴다.

- [ ] 6.9 연결된 세션이 있을 때만 1분 간격으로 표시된 접속 종료 시각을 확인하고, 임박하면 브라우저를 앞으로 가져와 알림만 보낸다. 연장 단추는 누르지 않는다.

- [ ] 6.10 시험을 다시 실행해 통과를 확인한다.

실행: `npm test -- --run tests/webConnectorSessionManager.test.ts tests/webConnectorPlatform.test.ts`

기대: 세션 분리·복구·호스트 제한·윈도우 흐름·맥 안전 기본값 시험이 통과한다.

- [ ] 6.11 커밋한다.

```bash
git add src/main/services/webConnector/sessionManager.ts src/main/services/webConnector/windows.ts src/main/services/webConnector/macos.ts tests/webConnectorSessionManager.test.ts tests/webConnectorPlatform.test.ts
git commit -m "feat: 업무용 브라우저 세션과 윈도우 자동 이동 연결"
```

## 작업 7: 서비스와 IPC 호환 교체

**파일:**

- 수정: `src/main/services/webConnector/index.ts`
- 수정: `src/main/ipc/webConnectorHandlers.ts`
- 수정: `src/main/index.ts`
- 시험: `tests/webConnectorService.test.ts`
- 시험: `tests/webConnectorHandlers.test.ts`

- [ ] 7.1 기존 IPC 입력·출력 모양을 유지하면서 의미만 새 서비스로 바꾸는 시험을 먼저 쓴다.

```ts
expect(service.getStatuses()).toEqual([
  { browserId: 'edge', paired: false, connected: false },
  { browserId: 'chrome', paired: false, connected: false },
]);
await expect(service.test('edge')).resolves.toEqual({ ok: true });
await expect(service.openSetup('edge', 'extensions')).resolves.toMatchObject({ ok: true });
```

`paired`는 현재 교육청과 브라우저의 이전 성공 시각 존재 여부, `connected`는 현재 소유 세션 생존 여부, `lastSeenAt`은 마지막 성공 시각으로 확인한다. `extensionVersion`은 넣지 않는다.

- [ ] 7.2 `pair`는 전용 업무 포털을 열고, `folder`는 정제된 진단 폴더만 열며, `extensions`는 확장 기능이 필요 없다는 안내만 반환하는 시험을 쓴다.

- [ ] 7.3 모든 IPC 처리기의 첫 실행문이 입력 검사인지 기존 정적 시험과 함께 확인한다.

- [ ] 7.4 시험 실패를 확인한다.

실행: `npm test -- --run tests/webConnectorService.test.ts tests/webConnectorHandlers.test.ts tests/validate.test.ts`

기대: 현재 확장 서버 기반 서비스 의미와 달라 실패한다.

- [ ] 7.5 `WebConnectorService` 내부를 세션 관리자와 상태 저장소로 교체한다. `queue`는 요청을 검증하고 직렬 실행 줄에 넣은 뒤 즉시 `{ queued: true }`를 반환하며 실제 결과는 기존 알림으로 보낸다.

- [ ] 7.6 `registerWebConnectorHandlers`에서 일반 브라우저 실행과 확장 주소 복사를 제거하고 서비스의 `test`, `openSetup`만 호출한다. IPC 이름과 입력·출력 모양은 유지한다.

- [ ] 7.7 `src/main/index.ts`는 `userDataPath`, 현재 설정을 읽는 함수, 알림과 플랫폼을 서비스에 주입하고 종료 때 `closeAll`을 기다린다. 맥에서는 자동 이동 구현을 초기화하지 않는다.

- [ ] 7.8 시험을 다시 실행해 통과를 확인한다.

실행: `npm test -- --run tests/webConnectorService.test.ts tests/webConnectorHandlers.test.ts tests/validate.test.ts`

기대: 새 상태 의미와 세 IPC 동작 시험이 통과한다.

- [ ] 7.9 커밋한다.

```bash
git add src/main/services/webConnector/index.ts src/main/ipc/webConnectorHandlers.ts src/main/index.ts tests/webConnectorService.test.ts tests/webConnectorHandlers.test.ts tests/validate.test.ts
git commit -m "refactor: 확장 연결을 업무용 브라우저 서비스로 교체"
```

## 작업 8: 실행기와 멀티 액션 연결

**파일:**

- 수정: `src/main/services/launcher/index.ts`
- 수정: `src/main/services/launcher/common.ts`
- 수정: `src/main/services/multiAction/index.ts`
- 시험: `tests/launcher.test.ts`
- 시험: `tests/multiAction.test.ts`

- [ ] 8.1 웹 업무 키가 일반 URL과 선택 브라우저 실행을 전혀 부르지 않고 전용 업무 요청만 접수하는 시험을 먼저 바꾼다.

```ts
expect(await launchDeckItem([workflow], [], workflow.id, deps, 'win32')).toEqual({ ok: true });
expect(deps.queueWebWorkflow).toHaveBeenCalledWith(workflow);
expect(deps.openExternal).not.toHaveBeenCalled();
expect(deps.spawnProcess).not.toHaveBeenCalled();
```

- [ ] 8.2 접수 실패 때 개인 기본 브라우저로 우회하지 않고 오류를 반환하며, 접수 성공은 실제 업무 완료를 기다리지 않는 시험을 쓴다.

- [ ] 8.3 맥에서는 웹 업무 키를 차단하고 사이트만 열지 않는 시험을 쓴다. 일반 URL 키의 맥·윈도우 브라우저 선택 동작은 그대로인지 회귀 시험을 유지한다.

- [ ] 8.4 멀티 액션은 웹 업무 요청 접수를 해당 단계 성공으로 보고 다음 단계로 진행하지만 접수 실패는 전체 작업을 멈추는 시험을 쓴다.

- [ ] 8.5 시험 실패를 확인한다.

실행: `npm test -- --run tests/launcher.test.ts tests/multiAction.test.ts`

기대: 현재 웹 업무 뒤 일반 URL을 여는 동작 때문에 실패한다.

- [ ] 8.6 `launchResolvedAction`의 웹 업무 분기를 가장 먼저 반환하도록 바꾼다.

```ts
if (item.webWorkflow) {
  if (!isWebConnectorSupportedPlatform(platform)) {
    return launchFailure('BLOCKED', '나이스와 에듀파인 자동 이동은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 실행해 주세요.');
  }
  const queued = dependencies.queueWebWorkflow(item);
  return queued.queued
    ? { ok: true }
    : launchFailure('FAILED', queued.message ?? '업무용 브라우저를 준비하지 못했습니다. 설정에서 연결을 시험해 주세요.');
}
```

- [ ] 8.7 멀티 액션 회귀 시험과 실행기 시험을 다시 실행한다.

실행: `npm test -- --run tests/launcher.test.ts tests/multiAction.test.ts`

기대: 전용 경로, 실패 차단, 맥 차단과 멀티 액션 접수 의미가 모두 통과한다.

- [ ] 8.8 커밋한다.

```bash
git add src/main/services/launcher/index.ts src/main/services/launcher/common.ts src/main/services/multiAction/index.ts tests/launcher.test.ts tests/multiAction.test.ts
git commit -m "feat: 웹 업무를 전용 실행 경로로 분리"
```

## 작업 9: 윈도우 설정과 편집 화면 교체

**파일:**

- 수정: `src/renderer/src/editor/SettingsModal.tsx`
- 수정: `src/renderer/src/editor/ActionLibrary.tsx`
- 수정: `src/renderer/src/editor/PropertiesPanel.tsx`
- 수정: `src/renderer/src/editor/EditorApp.tsx`
- 새 파일: `src/renderer/src/editor/webWorkViewModel.ts`
- 수정: `src/renderer/src/styles/editor.css`
- 시험: `tests/webWorkflows.test.ts`
- 시험: `tests/settingsWebWork.test.ts`

- [ ] 9.1 윈도우에서만 교육청 선택과 엣지·크롬 카드를 보이고 맥에서는 웹 업무 설정과 템플릿을 숨기는 시험을 먼저 작성한다.

- [ ] 9.2 교육청 변경이 `educationOfficeCode`와 웹 업무 키 주소만 함께 갱신하고 키 식별자·브라우저·멀티 액션 참조를 보존하는 시험을 쓴다.

- [ ] 9.3 웹 업무 키 편집기는 `webWorkflow.browserId`만 고르고 일반 `BrowserSpec` 경로·프로필·앱 모드 입력을 보이지 않는 시험을 쓴다. 일반 URL 키 화면은 기존 브라우저 선택을 유지한다.

- [ ] 9.4 시험 실패를 확인한다.

실행: `npm test -- --run tests/settingsWebWork.test.ts tests/webWorkflows.test.ts`

기대: 현재 확장 설치 화면과 경기 고정 템플릿 때문에 실패한다.

- [ ] 9.5 상태 문구와 단추 표시 여부를 `webWorkViewModel.ts`의 순수 함수로 만들고 설정 화면을 다음 상태로 교체한다.

- 소속 교육청 선택
- 업무용 엣지 카드와 추천 표시
- 업무용 크롬 카드
- `준비됨`, `실행 중`, `연결 필요`, `오류` 상태
- `업무용 브라우저 열기`, `연결 시험`
- 오류가 있을 때만 `문제 해결 폴더 열기`
- 예전 확장 기능이 더 이상 필요하지 않다는 한 번 안내
- 로그인·인증서 직접 입력과 저장·제출·상신·승인·결재 자동 실행 금지 안내

- [ ] 9.6 `ActionLibrary`에 `educationOfficeCode`를 넘겨 현재 교육청 주소로 템플릿을 만들고, `PropertiesPanel`은 업무용 엣지·크롬 선택만 저장한다.

- [ ] 9.7 순수 CSS로 카드 상태, 추천 배지, 교육청 선택과 안내를 기존 설정 화면 분위기에 맞춘다.

- [ ] 9.8 시험과 타입 검사를 실행한다.

실행: `npm test -- --run tests/settingsWebWork.test.ts tests/webWorkflows.test.ts && npm run typecheck`

기대: 화면 시험과 두 타입 검사 모두 통과한다.

- [ ] 9.9 커밋한다.

```bash
git add src/renderer/src/editor/SettingsModal.tsx src/renderer/src/editor/ActionLibrary.tsx src/renderer/src/editor/PropertiesPanel.tsx src/renderer/src/editor/EditorApp.tsx src/renderer/src/editor/webWorkViewModel.ts src/renderer/src/styles/editor.css tests/settingsWebWork.test.ts tests/webWorkflows.test.ts
git commit -m "feat: 업무용 브라우저 설정 화면 추가"
```

## 작업 10: 확장 기능 제거와 사용자 문서 갱신

**파일:**

- 삭제: `browser-extension/manifest.json`
- 삭제: `browser-extension/background.js`
- 삭제: `browser-extension/content.js`
- 삭제: `browser-extension/setup.html`
- 삭제: `browser-extension/setup.js`
- 삭제: `browser-extension/workflow-engine.js`
- 삭제: `browser-extension/workflows.js`
- 삭제: `src/main/services/webConnector/core.ts`
- 삭제: `src/main/services/webConnector/server.ts`
- 삭제: `tests/webConnector.test.ts`
- 삭제: `tests/webConnectorServer.test.ts`
- 수정: `electron-builder.yml`
- 수정: `README.md`
- 수정: `PLAN.md`

- [ ] 10.1 새 서비스·업무 엔진 시험이 기존 확장 시험의 보안 범위를 모두 대체하는지 목록으로 대조한다. 빠진 항목이 있으면 해당 새 시험 파일에 먼저 보강한다.

- [ ] 10.2 `electron-builder.yml`에서 `browser-extension` 추가 자원을 제거하고 확장 서버·확장 소스·기존 확장 전용 시험을 삭제한다.

- [ ] 10.3 `README.md`에 다음을 추가한다.

- 업무용 브라우저 원리와 개인 프로필 분리
- 지원하는 네 업무와 자동화가 멈추는 지점
- 17개 교육청과 엣지·크롬 선택
- 로그인, 인증서와 외부 프로그램 확인은 사용자 수행
- 예전 확장 기능을 엣지·크롬에서 직접 제거하는 절차
- 설계 문서 20절의 윈도우 실기 확인표 전체
- 자동 시험만으로 실제 계정 성공을 주장하지 않는다는 제한

- [ ] 10.4 `PLAN.md`의 웹 업무 연결 부분을 확장 설치 방식에서 승인된 전용 브라우저 방식으로 갱신하고 완료 여부는 실제 구현과 일치하게 표시한다.

- [ ] 10.5 확장 기능과 고정 포트 흔적이 없는지 검사한다.

실행: `rg -n "browser-extension|38473|9222|압축 해제된 확장|remote-debugging-port=9222" src tests electron-builder.yml README.md PLAN.md`

기대: 이전 방식 설명이나 코드가 나오지 않는다. README의 예전 확장 제거 안내처럼 의도한 과거 설명만 나오면 문맥을 직접 확인한다.

- [ ] 10.6 전체 시험, 타입 검사, 린트와 빌드를 실행한다.

실행: `npm test && npm run typecheck && npm run lint && npm run build`

기대: 모든 명령이 종료 코드 0으로 끝난다.

- [ ] 10.7 커밋한다.

```bash
git add -A browser-extension src/main/services/webConnector tests electron-builder.yml README.md PLAN.md
git commit -m "docs: 확장 없는 업무용 브라우저 흐름으로 이전"
```

## 작업 11: 맥 안전 실행, 전체 검증과 배포 준비

**파일:**

- 수정: `package.json`
- 수정: `package-lock.json`
- 필요할 때 수정: 검증에서 드러난 해당 소스와 시험 파일

- [ ] 11.1 버전을 `1.3.0`으로 올리고 잠금 파일을 맞춘다. 새 의존성은 추가하지 않는다.

- [ ] 11.2 시험 개수와 핵심 시험 파일을 확인하고 전체 검증을 새로 실행한다.

실행:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

기대: 모두 종료 코드 0. 웹 업무 관련 시험에는 교육청, 전용 프로필, 파이프와 포트 예비 연결, 민감 정보 제거, 안전 후보, 세션, 플랫폼, IPC, 실행기와 설정 화면이 포함된다.

- [ ] 11.3 맥에서 `npm run dev`를 실행해 앱이 오류 없이 시작되는지 확인하고, 웹 업무 탭과 템플릿이 없으며 업무용 브라우저 세션 파일·프로세스가 생기지 않는지 확인한 뒤 종료한다.

실행: `npm run dev`

기대: 맥 앱이 시작되고 웹 업무 자동 이동이 초기화되지 않는다.

- [ ] 11.4 맥 꾸러미 빌드를 실행한다.

실행: `npm run build:mac`

기대: x64와 arm64 디엠지 산출물이 생기고 빌드가 종료 코드 0으로 끝난다.

- [ ] 11.5 최종 변경과 금지 항목을 확인한다.

실행:

```bash
git status --short
git diff --check
rg -n "shell:\s*true|remote-debugging-port=9222|127\.0\.0\.1:38473" src tests electron-builder.yml
```

기대: 의도한 변경만 보이고 공백 오류와 금지 문자열이 없다.

- [ ] 11.6 버전 커밋을 만든다.

```bash
git add package.json package-lock.json
git commit -m "chore: 스트림 패널 1.3.0 배포 준비"
```

- [ ] 11.7 원격 브랜치에 올리고 풀 리퀘스트를 만든다. 윈도우·맥 자동 작업 결과를 모두 확인하며, 실제 교육청 계정 실기 확인은 미완료라고 본문에 분명히 적는다.

- [ ] 11.8 자동 작업이 모두 통과한 뒤에만 합치고 `v1.3.0` 태그와 릴리즈를 만든다. 윈도우 설치 파일, 블록맵, `latest.yml`, 맥 arm64와 x64 디엠지 다섯 산출물을 확인한다.

- [ ] 11.9 윈도우 실기 확인표를 아직 수행하지 못했다면 릴리즈 설명과 최종 보고에서 미확인으로 표시한다. 자동 시험 또는 맥 확인을 윈도우 실기 성공으로 표현하지 않는다.
