# Stream Panel — 구현 명세서 (v1.5)

> Windows·macOS 바탕화면에 항상 떠 있는 **Elgato Stream Deck 스타일 런처**.
> 물리 장치 없이, 소프트웨어 패널 + 편집기 앱으로 스트림덱의 사용 흐름을 재현한다.
> 이 문서는 **코드 작성 에이전트(Codex)가 이 문서만 읽고 처음부터 끝까지 구현**할 수 있도록 작성되었다.
> 추측이 필요한 부분은 이미 "결정"으로 답이 적혀 있다. 명세에 없는 것만 자유롭게 판단한다.

---

## 0. 한 줄 목표

사용자가 **링크(URL) / 폴더 / 파일 / 설치된 앱**을 편집기에서 키로 드래그해 배치하고 이름을 붙이면,
바탕화면에 항상 고정된 패널의 해당 키를 눌러 즉시 실행할 수 있는 **Windows·macOS 데스크톱 앱**.
GitHub 공개 저장소에 올리고 태그를 푸시하면 GitHub Actions가 Windows 설치 파일(.exe)과
macOS 설치 파일(.dmg, arm64·x64)을 각각 빌드해 릴리즈에 자동 첨부한다.
사용자는 자기 OS에 맞는 설치 파일 하나만 받아 설치하면 바로 동작한다.

**플랫폼 지원 등급**

| OS | 등급 | 비고 |
|---|---|---|
| Windows 10/11 (x64) | **1급** | 모든 기능. 자동 업데이트 동작 |
| macOS 12+ (arm64 / x64) | **1급** | 모든 기능. **단 무서명 배포라 첫 실행 시 Gatekeeper 허용 필요, 자동 업데이트 미지원** (§10.1) |
| Linux | 미지원 | 빌드 대상에서 제외 |

---

## 1. 스트림덱 사용 흐름 대응표

이 앱은 아래 스트림덱 동작을 그대로 흉내 낸다. (출처: Elgato Stream Deck 퀵스타트 가이드)

| 스트림덱 | Stream Panel |
|---|---|
| USB로 연결된 물리 키 장치 | 바탕화면에 항상 최상위로 떠 있는 **패널 창** (§6.5) |
| Stream Deck 앱 (설정 화면) | **편집기 창** (§9.4) — 왼쪽 키 그리드, 오른쪽 액션 라이브러리 |
| 오른쪽 패널에서 액션을 끌어다 왼쪽 키에 놓기 | 동일. 라이브러리 → 그리드 드래그 앤 드롭 (§9.5) |
| 키에 커스텀 아이콘 지정 (144×144 jpg/png 권장) | 동일. 아이콘 드롭 시 144×144 PNG로 자동 정규화 (§6.6) |
| "폴더 만들기"를 키에 놓고 그 안에 액션 배치 | 동일. **폴더 키** (§4.1) |
| 폴더 안에서 `뒤로` 키를 눌러 상위로 복귀 | 동일. 폴더 진입 시 0번 슬롯이 `↩ 뒤로`로 자동 예약 (§4.3) |
| 키 우클릭 → 복사 / 삭제 / 이동 | 동일 + 잘라내기·붙여넣기·편집·아이콘 변경 (§9.7) |
| 액션 라이브러리 검색 | 동일. 설치된 앱 목록도 라이브러리에 함께 노출 (§9.4) |

**의도적으로 다르게 한 것**

- 스트림덱은 키 개수가 하드웨어로 고정이지만, 여기서는 **그리드 크기(열×행)를 설정에서 바꿀 수 있다.**
- 키가 그리드 용량을 넘으면 **자동 페이지네이션**된다. 패널 하단 도트로 전환한다 (§4.3).
- 다이얼·터치스크린·소셜 연동은 구현하지 않는다 (§2.2).
- 여러 실행 키와 기다리기를 묶는 멀티 액션은 소프트웨어에 맞는 안전한 방식으로 제공한다 (§6.15).

---

## 2. 확정된 제품 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 창 구성 | **패널 창 + 편집기 창** 2개 | 스트림덱의 "장치 + 앱" 구조 재현. 패널은 작고 실행 전용 |
| 패널 형태 | 프레임리스 항상-최상위 플로팅 창 (드래그로 이동) | 스트림덱 데스크톱 앱과 동일한 사용감 |
| 작업표시줄 | 표시하지 않음 (`skipTaskbar: true`), 트레이로 제어 | 상시 실행 유틸리티 |
| 전역 단축키 | `Ctrl+Alt+D` 표시/숨김 토글 (설정에서 변경 가능) | 가려졌을 때 즉시 호출 |
| 패널 크기 | **수동 리사이즈 없음.** 그리드 설정에서 자동 계산 | Windows에서 투명 창 리사이즈는 깜빡임 버그가 잦음 |
| 화면 가림 방지 | **실행 후 자동 숨김 + 가장자리 피크(peek)** 기본 켜짐 (§6.10) | 항상 최상위 창이 작업 화면을 가리는 문제를 해결. 소프트웨어 패널의 최대 약점 |
| 키보드 실행 | **전역 숫자 단축키(기본 켬) + 퀵 런처 오버레이** (§6.11, §6.12) | 패널을 띄우거나 클릭하는 단계 없이 어디서든 바로 실행. 이것이 주 사용 경로다 |
| 패널의 역할 | **마우스로 둘러볼 때의 보조 수단** | 키보드 사용자는 패널을 거의 열지 않는다. 패널은 시각적 브라우징용 |
| 계층 구조 | 폴더 키로 무한 중첩 (실용상 깊이 5 제한) | 스트림덱 폴더 |
| 저장소 | `github.com/deepsky616/stream-panel` (**공개**) | 릴리즈 다운로드·자동 업데이트에 인증 불필요 |
| 설치 방식 (Win) | NSIS, **사용자 단위 설치**(`perMachine: false`) | UAC 관리자 권한 프롬프트 회피 |
| 설치 방식 (mac) | **DMG**, arm64·x64 각각 빌드 | 유니버설 바이너리는 용량이 두 배라 분리 배포 |
| 코드 서명 | v1.0에서는 **양쪽 다 하지 않음** | 비용 문제. Windows는 SmartScreen 경고, macOS는 Gatekeeper 허용 절차를 README에 명시 (§13) |
| 자동 업데이트 | `electron-updater` + GitHub 프로바이더. **Windows 전용** | macOS는 서명이 없으면 Squirrel.Mac이 거부한다 (§10.1) |
| 플랫폼 분기 | 플랫폼 의존 코드는 **`services/<이름>/{index,windows,macos}.ts`로 분리** | 조건문을 코드 전체에 흩뿌리면 유지보수가 불가능해진다 (§6.0) |

### 2.1 현재 범위 (반드시 구현)

- 패널 창: 키 클릭 실행, 폴더 진입/복귀, 페이지 전환, 드래그 이동, 잠금
- **패널 노출 정책 3종** (§6.10): 실행 후 자동 숨김 · 가장자리 피크 · 유휴 시 반투명+클릭 통과
- **키보드 실행 4종**: 숫자 힌트 배지(§6.11-A) · 키별 전역 단축키(§6.11-B) ·
  **전역 숫자 단축키(§6.11-C, 기본 켬)** · **퀵 런처 오버레이(§6.12)**
- **한글 초성 검색** — 퀵 런처에서 `ㄱㅂ`으로 "개발"을 찾을 수 있어야 한다 (§6.12)
- 편집기 창: 키 그리드 + 액션 라이브러리 + 속성 편집 패널
- 드래그 앤 드롭: 라이브러리→키, 키↔키 이동/교환, 키→폴더 안, 키→삭제, **OS 파일/폴더/URL 드롭**
- 액션 4종: `url` / `folder` / `file` / `app`(+Windows 전용 `uwp`) + **폴더 키**
- 설치된 앱 목록 — Windows: 시작 메뉴 스캔 + Microsoft Store 앱 / macOS: `.app` 번들 스캔
- **Windows·macOS 양쪽 빌드 및 릴리즈** (§12)
- 아이콘: 자동 추출(exe 아이콘·파비콘) / 이모지 / 커스텀 이미지(144×144 정규화) / 글자
- 복사·잘라내기·붙여넣기·복제·삭제 (마우스 + 키보드)
- 트레이, 전역 단축키, 로그인 시 자동 시작
- 설정: 그리드 크기, 테마, 투명도, 단축키, 잠금
- 자동 업데이트 + GitHub Actions 릴리즈 파이프라인
- **Windows 전용 나이스·에듀파인 웹 업무 연결** — 전용 엣지·크롬으로 작성 화면까지 안전하게 이동 (§6.14)
- **멀티 액션** — 기존 실행 키와 기다리기를 최대 20단계로 순차 실행 (§6.15)
- **Windows 전용 결재 대기 알림** — 결재함의 보이는 수량만 읽어 키 배지와 알림으로 표시 (§6.16)

### 2.2 현재 범위 밖 (구현하지 말 것)

프로필(여러 세트 전환), 키보드 매크로 전송,
플러그인 시스템, 클라우드 동기화, 소셜 계정 연동, 다이얼/터치스트립,
**Linux 지원**, **macOS 코드 서명·공증**, **macOS 자동 업데이트**,
**설정 파일의 플랫폼 간 이식**(경로 체계가 달라 URL 키 외에는 옮겨갈 수 없다).

---

## 3. 기술 스택

```
Electron (최신 안정 버전으로 고정)
electron-vite          — main / preload / renderer 통합 번들러
React 18 + TypeScript  — 렌더러 (패널 창 + 편집기 창)
Zustand                — 렌더러 상태 관리
@dnd-kit/core          — 드래그 앤 드롭 (라이브러리→그리드, 그리드 내 이동)
electron-store         — 설정 영속화 (원자적 쓰기 + 마이그레이션)
electron-updater       — 자동 업데이트
electron-builder       — NSIS 인스톨러 빌드 및 GitHub 퍼블리시
Vitest                 — 단위 테스트
ESLint + Prettier      — 린트/포맷
```

**CSS 프레임워크(Tailwind 등)는 쓰지 않는다.** 순수 CSS + CSS 변수로 테마를 구현한다.

**런타임 네트워크 의존성 금지:** 파비콘 조회를 제외한 모든 기능이 오프라인에서 동작해야 한다.
폰트·아이콘·스크립트를 CDN에서 불러오지 않는다.

---

## 4. 데이터 모델 (`src/shared/types.ts`)

이 타입 정의를 **그대로** 사용한다. 필드를 임의로 바꾸지 않는다.

```ts
export type ActionType = 'url' | 'folder' | 'file' | 'app' | 'uwp' | 'multi';
/** 'folder'는 "폴더 열기" 액션. 계층 구조를 만드는 폴더 키는 FolderItem이다 — 혼동 주의. */
/** 'uwp'는 Windows 전용. Microsoft Store 앱이며 target에 AppUserModelID가 들어간다.
 *  macOS에서는 이 타입을 생성할 수 없고, 설정에 남아 있으면 키에 '이 플랫폼에서
 *  지원되지 않는 항목' 배지를 표시하고 실행 시 BLOCKED를 반환한다. */
/** 'app'의 target 형식은 플랫폼마다 다르다.
 *  Windows: 'C:\Program Files\...\app.exe'  (절대 경로)
 *  macOS:   '/Applications/Safari.app'      (.app 번들 절대 경로) */

export type IconSpec =
  | { kind: 'auto' }                    // 런타임에 target으로부터 추출 + 캐시
  | { kind: 'emoji'; value: string }    // 예: "🎬"
  | { kind: 'file'; path: string }      // userData/icons/ 기준 상대 경로 (144x144 PNG)
  | { kind: 'letter'; value: string };  // 1~2글자. 배경은 item.color 사용

interface DeckItemBase {
  id: string;        // crypto.randomUUID()
  label: string;     // 1~24자. 빈 문자열 금지
  icon: IconSpec;
  color: string;     // '#RRGGBB'. 키 배경 틴트
  position: number;  // 같은 계층·같은 그리드 내 0-based 슬롯 인덱스 (§4.3)
  globalHotkey?: string; // Electron accelerator. 지정하면 앱이 백그라운드여도 실행 (§6.11-B)
                         // 수식키(Control/Alt/Shift/Super) 최소 1개 필수. 전체 최대 20개
}

export interface ActionItem extends DeckItemBase {
  kind: 'action';
  type: ActionType;
  target: string;      // url | 절대 경로 | exe 경로 | AppUserModelID
  args: string[];      // type==='app' 일 때만 의미 있음. 기본 []
  workingDir?: string; // type==='app'
  browser?: BrowserSpec; // type==='url' 일 때만. 미지정이면 OS 기본 브라우저 (§6.13)
  webWorkflow?: WebWorkflowSpec; // type==='url' 일 때만. 전용 업무용 브라우저가 정해진 화면까지 이동 (§6.14)
  multiAction?: MultiActionSpec; // type==='multi' 일 때만. 기존 실행 키와 기다리기를 순서대로 실행 (§6.15)
}

export type MultiActionStep =
  | { id: string; kind: 'action'; actionId: string }
  | { id: string; kind: 'delay'; delayMs: number };

export interface MultiActionSpec {
  steps: MultiActionStep[];
}

export interface MultiActionProgress {
  runId: string;
  itemId: string;
  label: string;
  currentStep: number;
  totalSteps: number;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  message?: string;
}

export type BuiltInWebWorkflowId =
  | 'neis-leave'
  | 'neis-trip'
  | 'neis-approval-inbox'
  | 'edufine-draft'
  | 'edufine-purchase'
  | 'edufine-approval-inbox';

export type WebWorkflowId = BuiltInWebWorkflowId | 'custom';

export type WebWorkflowSystem = 'neis' | 'edufine';

export type WebConnectorBrowserId = 'chrome' | 'edge';

export interface CustomWebWorkflowStep {
  id: string;    // step-1부터 순서대로. 최대 8개
  label: string; // 화면에 보이는 정확한 메뉴 이름. 선택자나 스크립트 금지
}

export interface CustomWebWorkflowDefinition {
  name: string;
  system: WebWorkflowSystem;
  steps: CustomWebWorkflowStep[];
  finalText: string; // 마지막 클릭 뒤 반드시 보여야 하는 도착 확인 문구
}

export type WebWorkflowSpec =
  | { id: BuiltInWebWorkflowId; browserId: WebConnectorBrowserId }
  | {
      id: 'custom';
      browserId: WebConnectorBrowserId;
      custom: CustomWebWorkflowDefinition;
    };

export interface WebConnectorStatus {
  browserId: WebConnectorBrowserId;
  paired: boolean;
  connected: boolean;
  lastSeenAt?: number;
}

export interface ApprovalMonitorConfig {
  sources: Record<WebWorkflowSystem, {
    enabled: boolean;                    // 기본 false
    browserId: WebConnectorBrowserId;    // 기본 edge
  }>;
  intervalMinutes: 5 | 10 | 30;          // 기본 10
  notifyOnlyOnIncrease: boolean;         // 기본 true
  workHours: {
    enabled: boolean;                    // 기본 true
    start: string;                       // HH:mm, 기본 08:00
    end: string;                         // HH:mm, 기본 18:00
  };
}

export interface ApprovalMonitorStatus {
  system: WebWorkflowSystem;
  state: 'disabled' | 'idle' | 'checking' | 'ready' | 'login-required' | 'error';
  pendingCount?: number;
  lastCheckedAt?: number;
  message?: string;
}

/** URL을 특정 브라우저·프로필·전용 창으로 여는 설정 (§6.13) */
export interface BrowserSpec {
  path: string;          // 브라우저 실행 파일(Win) / .app 번들(mac) 절대 경로
  profileDir?: string;   // Chromium 계열 프로필 디렉터리명. 'Default', 'Profile 1' 등
  appMode: boolean;      // true면 --app= 으로 주소창·탭 없는 전용 창을 연다
}

/** browsers:list 가 반환하는 감지된 브라우저 (§6.13) */
export interface DetectedBrowser {
  id: 'chrome' | 'edge' | 'whale' | 'firefox' | 'safari';
  name: string;                 // 'Google Chrome'
  path: string;
  family: 'chromium' | 'firefox' | 'safari';
  supportsAppMode: boolean;     // chromium 만 true
  supportsProfiles: boolean;    // chromium 만 true (v1.0에서 firefox 프로필 미지원)
  profiles: BrowserProfile[];
  iconDataUrl?: string;
}

export interface BrowserProfile {
  dir: string;    // 'Default', 'Profile 1'
  name: string;   // '업무용'  — Local State 에서 읽은 표시 이름
}

export interface FolderItem extends DeckItemBase {
  kind: 'folder';
  children: DeckItem[];  // 재귀. 중첩 깊이 최대 5
}

export type DeckItem = ActionItem | FolderItem;

export interface GridConfig {
  cols: number;       // 2~8, 기본 5
  rows: number;       // 1~6, 기본 3
  buttonSize: number; // px, 64~140, 기본 88
  gap: number;        // px, 기본 8
}

export interface WindowConfig {
  x: number | null;      // null이면 최초 실행 시 화면 우상단에 배치
  y: number | null;
  alwaysOnTop: boolean;  // 기본 true
  opacity: number;       // 0.3~1.0, 기본 1.0
  locked: boolean;       // true면 패널에서 이동/재배치 금지. 기본 false
  hideOnLaunch: boolean; // 기본 false
}

/** 패널이 화면을 가리지 않게 하는 노출 정책 (§6.10) */
export interface BehaviorConfig {
  hideAfterLaunch: boolean;        // 액션 실행 후 패널을 숨긴다. 기본 true
  hideAfterLaunchDelayMs: number;  // 숨김까지 지연. 기본 180 (눌림 애니메이션이 보이도록)
  edgePeek: boolean;               // 숨김 상태에서 가장자리 트리거 스트립 표시. 기본 true
  peekEdge: 'right' | 'left' | 'top' | 'bottom'; // 기본 'right'. 패널 위치에서 자동 추론
  peekThickness: number;           // 트리거 스트립 두께 px. 4~12, 기본 6
  peekDelayMs: number;             // 스트립에 머문 뒤 나타나기까지. 기본 220 (오작동 방지)
  idleFade: boolean;               // 유휴 시 반투명 + 클릭 통과. 기본 false
  idleFadeAfterMs: number;         // 기본 4000
  idleOpacity: number;             // 0.1~0.9, 기본 0.25
}

/** 키보드만으로 실행하기 위한 설정 (§6.11, §6.12) */
export interface KeyboardConfig {
  quickHints: 'on-focus' | 'always' | 'never';  // 힌트 배지 표시 조건. 기본 'on-focus'
  hintKeys: string;                             // 힌트 문자 순서. 기본 §6.11-A의 40자
  hideAfterHotkeyLaunch: boolean;               // 힌트로 실행 후 패널 숨김. 기본 true

  // 전역 숫자 단축키 (§6.11-C) — 기본으로 켜진다
  globalNumberHotkeys: boolean;                 // 기본 true
  globalNumberModifier: string;                 // 기본 'Alt+Shift'(Win) / 'Control+Alt'(mac)

  // 퀵 런처 (§6.12)
  quickLauncher: boolean;                       // 기본 true
  quickLauncherHotkey: string;                  // 기본 'CommandOrControl+Alt+Space'
}

export interface AppConfig {
  version: number;                      // 스키마 버전. 현재 1
  platform: 'win32' | 'darwin';         // 이 설정이 만들어진 플랫폼 (§4.6)
  root: DeckItem[];                     // 최상위 키 목록
  grid: GridConfig;
  window: WindowConfig;
  behavior: BehaviorConfig;
  keyboard: KeyboardConfig;
  approvalMonitor: ApprovalMonitorConfig; // Windows 전용 결재 대기 알림 (§6.16)
  theme: 'dark' | 'light' | 'system';   // 기본 'system'
  hotkey: string;                       // Electron accelerator. 기본 'Control+Alt+D'
  launchAtLogin: boolean;               // 기본 false
  autoUpdate: boolean;                  // 기본 true
}

/** 편집기 왼쪽 그리드와 패널이 공유하는 "현재 보고 있는 위치" */
export interface DeckLocation {
  path: string[];   // FolderItem id의 배열. []이면 root
  page: number;     // 0-based
}

/** appScanner가 반환하는 설치된 앱 항목 */
export interface InstalledApp {
  name: string;
  type: 'app' | 'uwp';
  target: string;              // exe 절대 경로 | AppUserModelID
  args: string[];
  workingDir?: string;
  source: 'start-menu' | 'store';
  iconDataUrl?: string;        // 지연 로딩
}

/** 편집기 오른쪽 라이브러리의 드래그 소스 */
export type LibraryEntry =
  | { kind: 'action-template'; type: ActionType; label: string; emoji: string; target?: string; webWorkflow?: WebWorkflowSpec }
  | { kind: 'folder-template'; label: string; emoji: string }
  | { kind: 'installed-app'; app: InstalledApp };

export type LaunchResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'BLOCKED' | 'FAILED'; message: string };

/** 퀵 런처 검색 결과 한 줄 (§6.12) */
export interface LauncherResult {
  id: string;             // ActionItem.id
  label: string;
  type: ActionType;
  breadcrumb: string;     // 상위 폴더 경로. 예: '개발도구 › 문서'. root면 빈 문자열
  iconDataUrl?: string;   // 지연 로딩
  hint?: string;          // '1'~'9'. 표시 순서대로 배정. 10개 이상이면 앞 9개만 부여
  matchRanges: [number, number][]; // label 안에서 검색어와 일치한 구간 (강조 표시용)
}
```

### 4.1 액션 라이브러리 고정 항목

편집기 오른쪽 패널 상단에 항상 표시되는 템플릿 5개. 순서 고정.

| emoji | label | 생성되는 항목 |
|---|---|---|
| 🔗 | 웹사이트 | `ActionItem { type:'url', target:'' }` |
| 📁 | 폴더 열기 | `ActionItem { type:'folder', target:'' }` |
| 📄 | 파일 열기 | `ActionItem { type:'file', target:'' }` |
| 🖥️ | 앱 실행 | `ActionItem { type:'app', target:'' }` |
| 🗂️ | 폴더 만들기 | `FolderItem { label:'새 폴더', children:[] }` |

그 아래에 구분선과 `설치된 앱` 섹션이 오고, `InstalledApp` 목록이 검색 가능한 형태로 나열된다.
설치된 앱을 그리드에 드롭하면 `target`·`label`·`icon`이 즉시 채워져 **추가 입력 없이 바로 완성**된다.

### 4.2 기본 설정 (`src/shared/defaults.ts`)

최초 실행 시 빈 화면을 피하기 위해 예시 키 3개를 넣는다.

1. `label: "구글"`, `type: 'url'`, `target: 'https://www.google.com'`, `icon: {kind:'auto'}`, position 0
2. `label: "다운로드"`, `type: 'folder'`, `target: app.getPath('downloads')`, `icon: {kind:'emoji', value:'📁'}`, position 1
3. `label: "문서"`, `type: 'folder'`, `target: app.getPath('documents')`, `icon: {kind:'emoji', value:'📄'}`, position 2

### 4.3 슬롯 배치 규칙 (핵심 — 정확히 구현할 것)

패널과 편집기 그리드가 **동일한 규칙**으로 계산한다. 이 로직은 `src/shared/layout.ts`에
순수 함수로 구현하고 단위 테스트한다.

```
용량 C = grid.cols * grid.rows

현재 위치가 root인 경우:
  - 슬롯 0..C-1 이 모두 아이템에 사용 가능
  - 페이지 수 = max(1, ceil(itemCount / C))
  - 페이지 p의 슬롯 s ↔ 전역 position = p * C + s

현재 위치가 폴더 내부인 경우:
  - 페이지 0의 슬롯 0은 '↩ 뒤로' 키로 예약된다. 아이템을 놓을 수 없다.
  - 페이지 0은 C-1개, 이후 페이지는 C개를 담는다.
  - 예약 슬롯 계산은 위 공식에 오프셋 1을 적용한다.
```

- `position`은 **계층 내 전역 인덱스**다(페이지 번호를 따로 저장하지 않는다).
- 항목 삭제 시 뒤 항목의 `position`을 당기지 않는다 → **빈 칸이 유지된다.** 스트림덱과 동일.
  (사용자가 의도적으로 배치한 간격이 깨지지 않게 하기 위함)
- 단, 마지막 페이지가 완전히 비면 그 페이지는 사라진다.
- `position`이 중복되거나 음수인 손상된 설정은 로드 시 정규화한다 (앞에서부터 재배치 + 경고 로그).

### 4.4 저장 위치

- 설정: `app.getPath('userData')/config.json` (electron-store)
- 커스텀 아이콘: `app.getPath('userData')/icons/<uuid>.png` (144×144로 정규화 저장)
- 아이콘 캐시: `app.getPath('userData')/cache/icons/<sha256(type|target)>.png` (+ `.json` 메타)
- 파비콘 캐시: `app.getPath('userData')/cache/favicons/<host>.png`
- 앱 목록 캐시: `app.getPath('userData')/cache/apps.json` (TTL 24시간)

### 4.5 플랫폼별 기본값 차이

`defaults.ts`는 `process.platform`에 따라 다음 값을 다르게 준다. 나머지는 동일하다.

| 필드 | Windows | macOS |
|---|---|---|
| `hotkey` | `'Control+Alt+D'` | `'Command+Alt+D'` — 실제 구현은 `'CommandOrControl+Alt+D'` 하나로 통일 |
| `keyboard.quickLauncherHotkey` | 동일 — `'CommandOrControl+Alt+Space'` | 동일 |
| `keyboard.globalNumberModifier` | **`'Alt+Shift'`** | **`'Control+Alt'`** — 두 값이 실제로 다르다. `CommandOrControl`로 합칠 수 없다 |

**`globalNumberModifier` 기본값을 이렇게 정한 이유** (§6.11-C)

| 조합 | 판정 |
|---|---|
| `Super+숫자` (Win 키) | **사용 불가** — Windows가 작업표시줄 고정 앱 실행에 예약해 두었다 |
| `Control+Alt+숫자` (Win) | 위험 — 일부 IDE·그래픽 툴이 이미 쓴다 |
| `Control+Shift+숫자` | 위험 — 브라우저·IDE가 이미 쓴다 |
| `Command+숫자` (mac) | **사용 불가** — 브라우저 탭 전환, 앱 대부분이 쓴다 |
| **`Alt+Shift+숫자`** (Win) | 비교적 한산 → **기본값** |
| **`Control+Alt+숫자`** (mac) | macOS에서는 비교적 한산 → **기본값** |
| 예시 키 2번 대상 | `app.getPath('downloads')` | 동일 (`getPath`가 알아서 처리) |
| `autoUpdate` | `true` | **`false` 고정** — macOS는 자동 업데이트를 지원하지 않는다 (§10.1) |

단축키 표기는 저장할 때 `CommandOrControl` 형태로 두고, **UI에 보여줄 때만** 플랫폼에 맞게
`Ctrl` / `⌘`으로 변환한다 (`shared/accelerator.ts`의 `formatAccelerator()`).

### 4.6 설정의 플랫폼 이식성

`config.platform`에 설정을 만든 플랫폼을 기록한다. 앱 시작 시 현재 플랫폼과 다르면:

- **설정을 지우거나 마이그레이션하지 않는다.** 사용자가 파일을 옮겨왔을 수 있다.
- `url` 타입 키는 그대로 동작한다.
- `folder`/`file`/`app`/`uwp` 키는 경로가 유효하지 않을 가능성이 높다. 앱 시작 시 존재 여부를
  검사해, 없으면 키에 **흐린 처리 + 경고 배지**를 붙이고 툴팁에
  "다른 운영체제에서 만든 항목입니다. 대상을 다시 지정해 주세요"를 표시한다.
- 배지가 붙은 키를 클릭하면 실행 대신 편집기가 열리며 해당 키가 선택된다.
- 사용자가 대상을 다시 지정하면 `config.platform`을 현재 플랫폼으로 갱신한다.

### 4.7 마이그레이션

`electron-store`의 `migrations` 옵션을 사용한다. v1.0은 초기 버전이라 항목은 비어 있지만
**구조와 테스트는 지금 만들어 둔다.** `config.version`이 알 수 없는 미래 값이면
`config.backup-<timestamp>.json`으로 백업하고 기본값으로 초기화한 뒤 사용자에게 토스트로 알린다.
JSON이 손상된 경우도 동일하게 처리한다.

---

## 5. IPC 계약 (`src/shared/ipcChannels.ts`)

모든 채널은 `invoke`/`handle`을 쓴다. `send`는 메인 → 렌더러 단방향 이벤트에만 쓴다.
**두 창(패널·편집기)이 같은 설정을 보므로, 변경은 항상 메인을 거쳐 양쪽에 브로드캐스트된다.**

### 5.1 렌더러 → 메인 (invoke)

| 채널 | 인자 | 반환 | 설명 |
|---|---|---|---|
| `config:get` | — | `AppConfig` | 전체 설정 읽기 |
| `config:set` | `Partial<AppConfig>` | `AppConfig` | 얕은 병합 후 저장. 검증 실패 시 throw |
| `config:reset` | — | `AppConfig` | 기본값 복원 (확인 다이얼로그 후에만) |
| `deck:upsert` | `{ path: string[]; item: DeckItem }` | `AppConfig` | 해당 계층에 항목 추가/갱신 (id 기준) |
| `deck:remove` | `{ path: string[]; id: string }` | `AppConfig` | 항목 삭제 (폴더면 하위 전체) |
| `deck:move` | `{ from: {path,id}; to: {path,position} }` | `AppConfig` | 이동. 대상 슬롯이 차 있으면 **교환** |
| `deck:duplicate` | `{ path: string[]; id: string }` | `AppConfig` | 다음 빈 슬롯에 복제 |
| `button:launch` | `{ path: string[]; id: string; keepOpen?: boolean }` | `LaunchResult` | 액션 실행 (§7). `keepOpen`이면 자동 숨김을 건너뛴다 |
| `picker:folder` | — | `string \| null` | 폴더 선택 다이얼로그 |
| `picker:file` | — | `string \| null` | 파일 선택 다이얼로그 |
| `picker:executable` | — | `{target,args,workingDir,name} \| null` | `.exe`/`.lnk` 선택. `.lnk`면 자동 해석 |
| `picker:image` | — | `string \| null` | 아이콘 이미지 선택 → 144×144 PNG로 정규화 후 상대경로 반환 |
| `icon:importPath` | `string` | `string \| null` | OS 드롭으로 받은 이미지 경로를 아이콘으로 등록 |
| `apps:list` | `{ refresh?: boolean }` | `InstalledApp[]` | 설치된 앱 목록 (§6.1) |
| `browsers:list` | `{ refresh?: boolean }` | `DetectedBrowser[]` | 설치된 브라우저와 프로필 목록 (§6.13) |
| `web-connector:status` | `{}` | `WebConnectorStatus[]` | Windows 전용. 교육청별 업무용 엣지·크롬 준비와 실행 상태 (§6.14) |
| `web-connector:test` | `{ browserId: 'chrome'\|'edge' }` | `{ok:true} \| {ok:false; message:string}` | Windows 전용. 전용 프로필을 열고 소속 교육청 포털 연결을 확인 |
| `web-connector:open-setup` | `{ browserId: 'chrome'\|'edge'; target:'pair'\|'folder'\|'extensions' }` | `{ok:true} \| {ok:false; message:string}` | Windows 전용. 전용 업무 포털 또는 정제된 진단 폴더 열기. `extensions`는 예전 호출 호환 안내만 반환 |
| `web-approval:status` | `{}` | `ApprovalMonitorStatus[]` | Windows 전용. 나이스·에듀파인 결재 대기 수와 마지막 확인 상태 (§6.16) |
| `web-approval:check` | `{ system?: 'neis'\|'edufine' }` | `ApprovalMonitorStatus[]` | Windows 전용. 켜진 업무의 대기 수를 즉시 읽기 전용으로 확인 |
| `multi-action:cancel` | `{ itemId: string }` | `{ok:true} \| {ok:false; message:string}` | 실행 중인 멀티 액션 취소 (§6.15) |
| `icon:resolve` | `{ type: ActionType; target: string }` | `string \| null` | 아이콘 data URL (캐시 사용) |
| `drop:classify` | `{ paths: string[]; text?: string }` | `Partial<ActionItem>[]` | OS 드롭 대상을 액션으로 변환 (§9.6) |
| `window:hide` | — | `void` | 패널 숨기기 (피크 스트립이 켜져 있으면 스트립으로 전환) |
| `window:show` | — | `void` | 패널 다시 표시 (피크 스트립이 호출) |
| `window:relayout` | — | `void` | 그리드 변경 후 패널 크기 재계산 |
| `window:set-idle` | `boolean` | `void` | 유휴 반투명/클릭 통과 진입·해제 (§6.10 C) |
| `editor:open` | `{ path?: string[]; slot?: number }` | `void` | 편집기 창 열기/포커스. 슬롯 선택 상태로 진입 |
| `hotkey:validate` | `{ accelerator: string; itemId?: string }` | `{ok:true} \| {ok:false; reason:string}` | 전역 단축키 등록 가능 여부 검사 (§6.11-B). 실제 등록은 하지 않고 시험 등록 후 즉시 해제 |
| `launcher:query` | `{ text: string }` | `LauncherResult[]` | 퀵 런처 검색 (§6.12). `text`가 빈 문자열이면 root 페이지 1의 1~10번을 반환 |
| `launcher:run` | `{ id: string }` | `LaunchResult` | 퀵 런처에서 실행. 성공하면 런처 창이 닫힌다 |
| `launcher:close` | — | `void` | 퀵 런처 닫기 (`Esc`) |
| `launcher:resize` | `{ height: number }` | `void` | 결과 개수에 맞춰 런처 창 높이 조정 |
| `update:check` | — | `{status, version?}` | 수동 업데이트 확인 |
| `app:info` | — | `{version, platform, isPackaged}` | 정보 표시용 |
| `shell:reveal` | `string` | `void` | 탐색기에서 위치 열기 |

### 5.2 메인 → 렌더러 (send)

| 채널 | 페이로드 | 설명 |
|---|---|---|
| `config:changed` | `AppConfig` | 다른 창에서 설정이 바뀜 → 리렌더 |
| `update:status` | `{state, progress?, version?, message?}` | 업데이트 진행 상태 |
| `panel:visibility` | `boolean` | 단축키/트레이로 표시 상태 변경됨 |
| `editor:focus-slot` | `{ path: string[]; slot: number }` | 패널의 `+` 클릭으로 편집기가 열릴 때 |
| `toast` | `{ level:'info'\|'error', message:string }` | 실행 실패 등 한국어 알림 |
| `multi-action:progress` | `MultiActionProgress` | 실행 단계·완료·실패·취소 상태 (§6.15) |
| `web-approval:changed` | `ApprovalMonitorStatus[]` | 결재 대기 수·로그인 필요·오류 상태 변경 (§6.16) |

### 5.3 preload 노출 형태

`window.api` 하나만 노출한다. `ipcRenderer`를 통째로 노출하지 않는다.

```ts
contextBridge.exposeInMainWorld('api', {
  config: { get, set, reset },
  deck:   { upsert, remove, move, duplicate },
  button: { launch },
  picker: { folder, file, executable, image },
  icon:   { resolve, importPath },
  apps:   { list },
  browsers: { list },
  webConnector: { status, test, openSetup },
  approvalMonitor: { status, check },
  multiAction: { cancel },
  drop:   { classify },
  window: { hide, show, relayout, setIdle },
  editor: { open },
  hotkey: { validate },
  launcher: { query, run, close, resize },
  update: { check },
  app:    { info },
  shell:  { reveal },
  on: (channel: RendererEvent, cb: (payload: unknown) => void) => () => void, // 구독 해제 함수 반환
});
```

렌더러에는 `src/renderer/src/api.d.ts`로 `declare global { interface Window { api: ... } }`를 선언한다.

---

## 6. 플랫폼 통합 상세 (Windows · macOS)

이 절이 가장 실수하기 쉬운 부분이다. **명세대로 정확히 구현한다.**

### 6.0 플랫폼 분기 원칙

플랫폼 의존 코드는 **파일 단위로 분리한다.** `if (process.platform === 'win32')`를
코드 전체에 흩뿌리면 유지보수가 불가능해지고, macOS에서 Windows 전용 API를 호출해
크래시하는 사고가 반드시 난다.

```
src/main/services/appScanner/
  index.ts     // 플랫폼을 골라 구현체를 반환. 이 파일에만 분기가 있다
  types.ts     // AppScanner 인터페이스
  windows.ts   // shell.readShortcutLink, Get-StartApps
  macos.ts     // .app 번들 스캔, Info.plist 파싱
```

같은 패턴을 `launcher/`, `platform/`(창·트레이·자동시작 설정값)에 적용한다.

```ts
// index.ts 형태
export function createAppScanner(platform = process.platform): AppScanner {
  switch (platform) {
    case 'win32':  return new WindowsAppScanner();
    case 'darwin': return new MacAppScanner();
    default:       return new NullAppScanner();   // 빈 목록 반환. 절대 throw 하지 않는다
  }
}
```

- **`platform` 인자를 주입 가능하게 만든다.** 테스트에서 macOS 머신 위에서도
  Windows 구현의 순수 로직(필터링 규칙 등)을 검증할 수 있어야 한다.
- 어떤 플랫폼에서도 **throw 대신 안전한 기본값을 반환**한다.
- 플랫폼별 상수(창 레벨, 트레이 아이콘 경로, 기본 단축키)는 `main/platform/index.ts`에 모은다.

### 6.1 설치된 앱 목록 수집 (`services/appScanner/`)

#### 6.1.1 Windows (`appScanner/windows.ts`)

두 소스를 합치고 이름 기준으로 중복을 제거한다.

**소스 A — 시작 메뉴 바로가기 스캔 (주 소스)**

다음 두 디렉터리를 재귀 탐색해 `.lnk` 파일을 모두 찾는다.

```
%ProgramData%\Microsoft\Windows\Start Menu\Programs
%APPDATA%\Microsoft\Windows\Start Menu\Programs
```

각 `.lnk`에 Electron의 `shell.readShortcutLink(lnkPath)`를 호출한다.
반환값은 `{ target, cwd, args, description, icon, iconIndex, appUserModelId }`.

필터링 규칙:
- `target`이 존재하지 않는 파일이면 제외
- `target`의 확장자가 `.exe`가 아니면 제외 (`.url`, `.chm`, 언인스톨러 등)
- 파일명 또는 타겟에 다음 키워드가 포함되면 제외:
  `uninstall`, `제거`, `unins00`, `readme`, `help`, `설명서`, `license`, `changelog`, `website`, `홈페이지`
- 이름은 `.lnk` 파일명(확장자 제외)을 쓴다 (`description`보다 정확함)

**소스 B — Microsoft Store(UWP) 앱**

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress"
```

- 출력은 `[{Name, AppID}, ...]` JSON.
- **한글 앱 이름이 깨지지 않도록** 위처럼 출력 인코딩을 UTF-8로 강제하고, 자식 프로세스 출력도 UTF-8로 디코드한다.
- `AppID`에 `!`가 포함된 항목만 UWP로 간주한다 (`Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`).
  `!`가 없으면 소스 A와 중복되는 데스크톱 앱이므로 버린다.
- 타임아웃 5초. 실패하면 **조용히 빈 배열을 반환**하고 소스 A만 쓴다. 절대 앱을 죽이지 않는다.

#### 6.1.2 macOS (`appScanner/macos.ts`)

다음 디렉터리에서 `.app`으로 끝나는 항목을 찾는다. `.app`은 파일이 아니라 **디렉터리**다.

```
/Applications
/Applications/Utilities          (하위 1단계까지만 재귀)
/System/Applications
/System/Applications/Utilities
~/Applications
```

- 깊이 제한 **2단계**. 그 이상 파고들면 `.app` 번들 내부까지 훑게 되어 매우 느려진다.
  `.app` 디렉터리를 만나면 **그 안으로 들어가지 않는다.**
- 표시 이름은 `<앱>.app/Contents/Info.plist`의 `CFBundleDisplayName`,
  없으면 `CFBundleName`, 그것도 없으면 번들 파일명(`.app` 제외)을 쓴다.
  - plist는 **바이너리 형식일 수 있다.** `plutil -convert json -o - <plist경로>`로 변환해 읽거나,
    실패하면 파일명으로 폴백한다. plist 파싱 실패가 스캔 전체를 중단시키면 안 된다.
  - 한글 이름(예: `계산기.app`)이 깨지지 않도록 출력을 UTF-8로 다룬다.
- 제외 규칙: 이름이 `Uninstall`/`제거`로 시작하는 번들, `.app` 안에 중첩된 `.app`.
- `InstalledApp`으로 변환:
  - `type: 'app'`, `target: '/Applications/Safari.app'`, `args: []`, `source: 'start-menu'`
    → **`source` 필드는 그대로 두되 macOS에서는 항상 `'start-menu'`를 쓴다.**
      값 자체에 의미를 두지 말고 UI에서 노출하지 않는다.
- `mdfind`(Spotlight)를 쓰지 않는다. Spotlight 인덱스가 꺼져 있으면 빈 결과가 나오고,
  디렉터리 스캔이 더 단순하고 예측 가능하다.

#### 6.1.3 공통 — 캐싱 및 성능

- 결과를 메모리 + `cache/apps.json`에 캐시 (TTL 24시간). `refresh: true`면 재스캔.
- `fs.promises`로 비동기 수행한다.
- **아이콘 추출을 목록 반환 시점에 하지 않는다.** 이름·경로만 먼저 반환하고,
  렌더러가 화면에 보이는 항목만 `icon:resolve`로 개별 요청한다 (지연 로딩).
- 스캔 중에는 라이브러리에 스켈레톤을 표시한다.
- 지원되지 않는 플랫폼에서는 빈 배열을 반환하고, 라이브러리에
  "이 운영체제에서는 설치된 앱 목록을 지원하지 않습니다" 안내를 표시한다.

### 6.2 아이콘 추출 (`iconService.ts`)

`icon:resolve({type, target})` 동작:

1. 캐시 키 = `sha256(type + '|' + target)`. `cache/icons/<key>.png`가 있고 메타의 `mtimeMs`가
   현재 대상 파일과 같으면 즉시 반환.
2. `type`이 `app` / `file` / `folder`:
   - `await app.getFileIcon(target, { size: 'large' })` → `NativeImage`
   - **양쪽 플랫폼에서 모두 동작한다.** macOS에서는 `.app` 번들 경로를 그대로 넘기면
     번들 아이콘(`.icns`)을 뽑아준다. 별도 처리가 필요 없다.
   - `image.isEmpty()`면 `null` 반환 → 렌더러가 글자 아이콘으로 폴백
   - `image.toPNG()`를 캐시에 쓰고 `image.toDataURL()` 반환
3. `type`이 `uwp`(Windows 전용): `getFileIcon`이 동작하지 않는다. **`null`을 반환**하고
   글자 아이콘으로 폴백한다. (UWP 아이콘 추출은 매니페스트 파싱이 필요해 v1.0 범위 밖)
4. `type`이 `url`: `faviconService`로 넘긴다 (§6.3).
5. **모든 실패는 예외를 던지지 말고 `null`을 반환한다.**

### 6.3 파비콘 (`faviconService.ts`)

1. URL에서 호스트를 추출. `cache/favicons/<host>.png`가 있으면 반환.
2. 없으면 `https://icons.duckduckgo.com/ip3/<host>.ico`를 Electron `net.fetch`로 요청.
   타임아웃 4초, 리다이렉트 허용, 최대 512KB.
   200이고 Content-Type이 이미지면 `nativeImage.createFromBuffer`로 파싱 후 PNG로 캐시.
3. 실패 시 `https://www.google.com/s2/favicons?domain=<host>&sz=64`로 **한 번만** 재시도.
4. 그래도 실패하면 `null` → 렌더러가 호스트 첫 글자로 글자 아이콘 생성.
5. **오프라인이어도 앱은 정상 동작해야 한다.** 네트워크 실패는 로그만 남긴다.

### 6.4 로그인 시 자동 시작 (`autoLaunch.ts`)

```ts
// Windows
app.setLoginItemSettings({
  openAtLogin: enabled,
  path: process.execPath,
  args: ['--hidden'],
});

// macOS — path/args 를 넘기지 않는다. openAsHidden 을 쓴다.
app.setLoginItemSettings({
  openAtLogin: enabled,
  openAsHidden: true,
});
```

- 개발 모드(`!app.isPackaged`)에서는 호출하지 않는다. 설정 UI는 비활성화하고
  "설치 후 사용 가능" 툴팁을 표시한다.
- Windows는 `process.argv.includes('--hidden')`으로, macOS는
  `app.getLoginItemSettings().wasOpenedAsHidden`로 숨김 시작 여부를 판별한다.
  두 판별을 `platform/index.ts`의 `shouldStartHidden()` 하나로 감싼다.

### 6.5 패널 창 (`panelWindow.ts`)

```ts
new BrowserWindow({
  frame: false,
  transparent: true,
  resizable: false,          // 크기는 그리드 설정에서 계산
  maximizable: false,
  minimizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  hasShadow: false,
  show: false,               // ready-to-show 후 표시
  backgroundColor: '#00000000',
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
});

win.setAlwaysOnTop(config.window.alwaysOnTop, PLATFORM.alwaysOnTopLevel);
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
win.setOpacity(config.window.opacity);
```

**플랫폼별 창 설정** (`main/platform/index.ts`에 상수로 모은다)

| 항목 | Windows | macOS |
|---|---|---|
| `alwaysOnTopLevel` | `'screen-saver'` | **`'floating'`** — `'screen-saver'`는 macOS에서 메뉴 바·Mission Control 같은 시스템 UI까지 덮어버려 사용자를 가둔다. 절대 쓰지 않는다 |
| 작업표시줄/Dock 숨김 | `skipTaskbar: true` | `app.dock.hide()` + `Info.plist`에 `LSUIElement: true` (§12.2 `mac.extendInfo`) |
| 창 배경 | `transparent: true` + CSS 배경 | 동일. 추가로 `vibrancy: 'under-window'`를 켜면 네이티브 블러가 적용돼 더 자연스럽다 (선택) |
| `hasShadow` | `false` | `false` |
| 트래픽 라이트 버튼 | 해당 없음 | `frame: false`이므로 나타나지 않는다. `titleBarStyle`을 설정하지 않는다 |
| 종료 동작 | `close` 가로채고 숨김 | 동일. 추가로 **`window-all-closed`에서 `app.quit()`를 호출하지 않는다** (macOS 기본 동작이 이미 그렇지만 명시적으로 막는다) |

**macOS 주의 — `app.dock.hide()`와 포커스**

`LSUIElement: true`로 만들면 앱이 백그라운드 액세서리 앱이 되어, 창을 띄워도 키보드
포커스를 받지 못하는 경우가 있다. §6.11-A의 힌트 입력이 먹지 않게 되므로
`showPanel()`에서 `app.focus({ steal: true })`를 반드시 호출한다 (§6.11-A 참조).

**크기 계산 공식** (`window:relayout`):

```
contentWidth  = cols * buttonSize + (cols + 1) * gap
contentHeight = TITLEBAR_H + rows * buttonSize + (rows + 1) * gap + FOOTER_H
TITLEBAR_H = 34
FOOTER_H   = 26  (페이지가 2개 이상이거나 폴더 경로를 표시할 때), 아니면 0
```

`win.setContentSize(contentWidth, contentHeight)` 사용.

**위치 복원 시 화면 밖 방지:** 저장된 x/y가 현재 연결된 어느 디스플레이의 `workArea`에도
들어가지 않으면 주 디스플레이 우상단(`workArea.x + workArea.width - w - 24`, `workArea.y + 24`)으로
재배치한다. 모니터 구성이 바뀌면 창이 사라지는 흔한 버그를 막는다.

**이동:** 타이틀바에 `-webkit-app-region: drag`, 그 안의 버튼에 `no-drag`.
`window.locked === true`면 `drag`를 제거한다.
`moved` 이벤트를 **500ms 디바운스**해 좌표를 저장한다.

**닫기 동작:** `close`를 `preventDefault()`하고 숨긴다. 실제 종료는 트레이 "종료"에서
`app.isQuitting = true`를 세운 뒤 수행한다.

### 6.6 커스텀 아이콘 정규화

`picker:image` 또는 `icon:importPath`로 받은 이미지를:

1. `nativeImage.createFromPath()`로 로드. 실패하면 `null` 반환.
2. 정사각형이 아니면 **가운데 정사각형으로 크롭**한다.
3. `image.resize({ width: 144, height: 144, quality: 'best' })`
4. `toPNG()`를 `userData/icons/<uuid>.png`로 저장하고 파일명을 반환.
5. 허용 확장자: `.png`, `.jpg`, `.jpeg`, `.ico`, `.bmp`, `.webp`. 최대 10MB.
6. 아이콘이 교체·삭제될 때 이전 파일을 지운다 (고아 파일 방지).
   앱 시작 시 `config`에서 참조되지 않는 `icons/*.png`를 정리한다.

### 6.7 트레이 / 메뉴 막대 (`tray.ts`)

메뉴: `패널 표시/숨기기` · `편집기 열기` · `설정...` · `업데이트 확인` · 구분선 · `종료`
좌클릭 = 표시/숨김 토글. 툴팁 `Stream Panel v{version}`.

**아이콘 에셋이 플랫폼마다 다르다.**

| | Windows | macOS |
|---|---|---|
| 파일 | `resources/tray.ico` (16/24/32 멀티사이즈) | `resources/trayTemplate.png` (16×16) + `resources/trayTemplate@2x.png` (32×32) |
| 형식 | 컬러 | **단색 실루엣 + 알파.** 파일명이 `Template`으로 끝나야 macOS가 템플릿 이미지로 인식해 다크/라이트 모드에 맞춰 자동 반전한다 |
| 로드 | `nativeImage.createFromPath('tray.ico')` | `nativeImage.createFromPath('trayTemplate.png')` → `image.setTemplateImage(true)` |

- macOS에서 컬러 아이콘을 쓰면 다크 모드에서 보이지 않게 된다. 반드시 템플릿으로 만든다.
- `업데이트 확인` 항목은 macOS에서 **`릴리즈 페이지 열기`로 라벨을 바꾸고**
  브라우저로 GitHub 릴리즈를 연다 (§10.1 — macOS는 자동 업데이트를 하지 않는다).

### 6.8 전역 단축키 (`shortcuts.ts`)

- 시작 시 `config.hotkey`(패널 표시/숨김 토글) 등록.
- 등록 실패(다른 앱이 선점)하면 `toast`로 알리고 설정 창에서 다시 지정하도록 안내한다.
- 설정에서 변경 시 기존 것을 `unregister` 후 새로 등록한다. 실패하면 이전 값으로 롤백한다.
- `will-quit`에서 `globalShortcut.unregisterAll()`.
- 키별 전역 단축키와 전역 숫자 단축키도 이 모듈이 함께 관리한다 (§6.11-B, §6.11-C).
  등록 목록을 하나의 레지스트리로 유지해 중복 등록·해제 누락이 없게 한다.
- **accelerator 표기는 `CommandOrControl`로 저장한다.** Electron이 Windows에서는 `Ctrl`,
  macOS에서는 `⌘`으로 해석한다. `Control`을 하드코딩하면 macOS에서 어색한 조합이 된다.
- 화면에 보여줄 때만 `shared/accelerator.ts`의 `formatAccelerator()`로 변환한다
  (`CommandOrControl+Alt+D` → Windows `Ctrl+Alt+D` / macOS `⌘⌥D`).
- macOS에서 `globalShortcut`은 별도 권한 없이 동작한다. 접근성 권한을 요구하지 않는다.
  (키 입력을 가로채는 것이 아니라 시스템에 핫키를 등록하는 방식이기 때문)

### 6.9 단일 인스턴스

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => showPanel());
```

### 6.10 패널 노출 정책 — 화면 가림 방지 (`services/visibility.ts`)

**해결하려는 문제:** 항상 최상위 패널이 링크·폴더·앱을 실행한 뒤에도 화면 우상단에 남아
작업 화면을 가린다. 물리 장치인 스트림덱에는 없는, 소프트웨어 패널만의 문제다.

세 가지 정책을 겹쳐서 제공한다. A·B는 기본으로 켜고, C는 선택이다.

#### A. 실행 후 자동 숨김 (`behavior.hideAfterLaunch`, 기본 `true`)

- `button:launch`가 `{ok:true}`를 반환하면 `hideAfterLaunchDelayMs`(기본 180ms) 뒤에 패널을 숨긴다.
  지연을 두는 이유는 키의 눌림 애니메이션이 보인 뒤 사라지게 하기 위함이다.
- **폴더 키 진입은 숨기지 않는다.** 실제 액션 실행에만 적용된다.
- 실행이 실패하면(`ok:false`) 숨기지 않는다. 사용자가 오류 토스트를 봐야 하기 때문이다.
- **연속 실행 예외:** `Shift`를 누른 채 클릭하면 `keepOpen: true`로 실행되어 패널이 남는다.
  이 동작을 키 툴팁과 README에 안내한다.
- 편집기 창에서의 테스트 실행에는 적용되지 않는다.

#### B. 가장자리 피크 (`behavior.edgePeek`, 기본 `true`)

작업표시줄 자동 숨기기와 같은 방식. 숨김 상태에서도 단축키를 외우지 않고 되부를 수 있게 한다.

- 패널이 숨겨질 때, 별도의 **트리거 스트립 창**을 화면 가장자리에 붙여 표시한다.
  ```ts
  new BrowserWindow({
    width: peekThickness,           // 기본 6px
    height: 160,
    x: workArea.x + workArea.width - peekThickness,  // peekEdge='right'
    y: 패널이 숨기 직전에 있던 y 위치 (workArea 안으로 클램프),
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    focusable: false, hasShadow: false, alwaysOnTop: true,
  });
  ```
- 이 창은 **포커스를 받지 않는다**(`focusable: false`). 다른 앱의 포커스를 빼앗으면 안 된다.
- 스트립 렌더러가 `mouseenter`를 감지하면 `peekDelayMs`(기본 220ms) 타이머를 건다.
  타이머 만료 전에 `mouseleave`가 오면 취소한다 → 마우스가 가장자리를 스쳐 지나갈 때
  오작동으로 튀어나오는 것을 막는다.
- 타이머가 만료되면 `window:show` → 패널이 슬라이드 인하고 스트립은 숨는다.
- 스트립 시각 디자인: 평소 `--accent` 25% 알파의 얇은 띠, 호버 시 100%로 밝아지고
  가운데에 `‹` 모양 화살표가 나타난다. 존재를 알리되 거슬리지 않아야 한다.
- **`peekEdge` 자동 추론:** 패널을 숨기는 시점에 패널 중심이 작업 영역의 어느 가장자리에
  가장 가까운지 계산해 자동 결정한다. 설정에서 수동 고정도 가능하다.
- `edgePeek`이 꺼져 있으면 스트립을 만들지 않는다. 이때는 `Ctrl+Alt+D`와 트레이가 유일한 복귀 수단이다.
- 스트립 창은 패널이 보이는 동안 항상 `hide()` 상태다. 두 창이 동시에 보이면 안 된다.

#### C. 유휴 시 반투명 + 클릭 통과 (`behavior.idleFade`, 기본 `false`)

패널을 계속 보이게 두고 싶은 사용자를 위한 대안. A와 함께 켜도 되지만 보통은 A 대신 쓴다.

- 패널 렌더러가 루트 요소의 `mouseenter`/`mouseleave`를 추적한다.
- `mouseleave` 후 `idleFadeAfterMs`(기본 4000ms)가 지나면 `window:set-idle(true)` 호출:
  ```ts
  win.setOpacity(behavior.idleOpacity);                    // 기본 0.25
  win.setIgnoreMouseEvents(true, { forward: true });       // 클릭이 뒤 창으로 통과
  ```
- `forward: true` 덕분에 창은 여전히 `mousemove`를 받는다. 커서가 패널 영역으로 다시 들어오면
  `window:set-idle(false)`로 복귀한다:
  ```ts
  win.setOpacity(config.window.opacity);
  win.setIgnoreMouseEvents(false);
  ```
- 복귀 판정은 렌더러의 `mousemove` 좌표로 한다. 커서 위치 폴링(`setInterval`)을 쓰지 않는다.
- **주의:** `setIgnoreMouseEvents(true)` 상태에서 창을 드래그할 수 없다. 유휴 상태에서
  타이틀바 드래그를 시도하면 먼저 복귀부터 되어야 한다 (커서 진입 → 즉시 복귀 → 그 다음 드래그).
- `prefers-reduced-motion`이면 페이드 트랜지션 없이 즉시 전환한다.

#### 상호작용 규칙

| 상황 | 동작 |
|---|---|
| A 켬 + B 켬 (기본) | 실행 → 패널 숨김 → 가장자리 스트립 표시 → 마우스 대면 복귀 |
| A 켬 + B 끔 | 실행 → 패널 숨김 → `Ctrl+Alt+D` 또는 트레이로만 복귀 |
| A 끔 + C 켬 | 패널이 남지만 4초 뒤 흐려지고 클릭이 통과됨 |
| A 켬 + C 켬 | 실행 시 숨김이 우선. 되돌아왔을 때만 C가 작동 |
| `window.locked === true` | A·B·C 모두 그대로 동작한다 (잠금은 편집 잠금이지 표시 잠금이 아니다) |
| 편집기 창이 열려 있음 | A를 일시 중지한다. 편집 중에 패널이 사라지면 결과를 확인할 수 없다 |

#### 플랫폼 차이

정책 A·C는 양쪽에서 동일하게 동작한다. 정책 B(가장자리 피크)만 다음을 지킨다.

- 트리거 스트립 위치는 항상 `screen.getDisplayNearestPoint().workArea` 기준으로 계산한다.
  macOS의 메뉴 막대와 Dock, Windows의 작업표시줄이 `workArea`에서 이미 제외되므로
  이 값만 쓰면 양쪽 모두 올바른 위치에 붙는다. **화면 전체 크기(`bounds`)를 쓰면 안 된다.**
- macOS에서 `peekEdge: 'left'`는 화면 왼쪽 끝의 Mission Control 핫코너와 겹칠 수 있다.
  기본값 `'right'`를 유지하고, 사용자가 바꾸면 그대로 따른다.
- 트리거 스트립 창은 macOS에서도 `focusable: false`로 만든다.
  추가로 `alwaysOnTopLevel`을 패널과 동일하게 `'floating'`으로 맞춘다.
- `setIgnoreMouseEvents(true, { forward: true })`는 양쪽 모두 지원된다.

### 6.11 키보드 실행 — 마우스 없이 쓰기 (`shared/hintMap.ts`, `shortcuts.ts`)

**해결하려는 문제:** §6.10 때문에 패널이 자주 숨어 있다. 숨은 패널을 마우스로 다시 꺼내
클릭하는 것보다, 키보드로 바로 실행하는 편이 훨씬 빠르다.

세 가지 방식을 제공한다. A는 항상 동작하고, B는 키별 옵트인, C는 전체 옵트인이다.

#### A. 숫자 힌트 배지 (`keyboard.quickHints`, 기본 `'on-focus'`)

`Ctrl+Alt+D` → 패널이 뜨고 포커스를 받는다 → 각 키 좌상단에 힌트 문자 배지가 나타난다 →
문자를 누르면 즉시 실행된다.

**힌트 배정 규칙** (`shared/hintMap.ts`에 순수 함수로 구현하고 단위 테스트한다)

```ts
const DEFAULT_HINT_KEYS =
  '1234567890qwertyuiopasdfghjkl;zxcvbnm,./';   // 40자

// 현재 보고 있는 계층·페이지의 아이템만 대상으로, position 오름차순으로 배정한다.
// 빈 슬롯은 건너뛴다 → 3번 슬롯이 비어 있으면 4번 슬롯이 힌트 '3'을 받는다.
```

- **힌트는 "현재 화면에 보이는 키"에만 배정된다.** 페이지를 넘기거나 폴더에 들어가면
  1번부터 다시 배정된다.
- 빈 슬롯을 건너뛰므로 사용자는 **눈에 보이는 순서대로 1, 2, 3**을 누르면 된다.
  (슬롯 인덱스와 힌트 번호는 다를 수 있다. 이게 의도된 동작이다)
- 한 화면에 40개를 넘는 키가 있으면 41번째부터는 힌트를 받지 못한다.
  화살표 키 + `Enter`로 접근한다 (그리드 상한 8×6=48이라 극단적인 설정에서만 발생).
  두 글자 힌트는 v1.1로 미룬다.
- 힌트 문자 순서는 `keyboard.hintKeys`로 바꿀 수 있다 (예: 한글 자판 사용자를 위한 재배열).
  중복 문자·빈 문자열은 거부하고 기본값으로 되돌린다.

**연쇄 입력 (폴더 파고들기)**

- 폴더 키의 힌트를 누르면 **실행이 아니라 진입**이다. 진입 즉시 안쪽 키에 새 힌트가 배정되므로
  `3` → `2`처럼 연달아 누를 수 있다.
- 폴더 안에서 `Backspace`는 상위로 복귀한다. `↩ 뒤로` 키는 힌트 문자를 받지 않는다
  (숫자 순서가 어긋나는 것을 막기 위해).
- 연쇄 입력 중에는 타임아웃을 두지 않는다. `Esc`로 언제든 패널을 닫는다.

**실행 후 동작**

- `keyboard.hideAfterHotkeyLaunch`(기본 `true`)면 실행 후 패널을 숨긴다 (§6.10-A와 동일 경로).
- `Shift` + 힌트 문자 = `keepOpen: true`. 패널이 남아 연달아 실행할 수 있다.
- 폴더 진입은 실행이 아니므로 숨기지 않는다.

**배지 표시 조건 (`quickHints`)**

| 값 | 동작 |
|---|---|
| `'on-focus'` (기본) | 패널이 포커스를 가진 동안에만 배지 표시. 마우스로 쓸 땐 화면이 깨끗하다 |
| `'always'` | 항상 표시 |
| `'never'` | 배지를 숨기되 **키 입력은 그대로 동작한다** (외워서 쓰는 사용자용) |

**배지 디자인:** 키 좌상단, 16×16, `border-radius: 4px`, 배경 `--accent` 85% 알파,
흰색 11px 볼드 문자. 아이콘을 가리지 않도록 `z-index`만 올리고 크기를 키우지 않는다.

**포커스 확보 — 양쪽 플랫폼 모두 함정이 있다.**
Windows는 포그라운드 락 때문에, macOS는 `LSUIElement` 액세서리 앱이라는 이유로
백그라운드에서 창에 포커스를 주는 것이 막힐 수 있다. `showPanel()`은 다음 순서로 수행한다.

```ts
async function focusPanel(win: BrowserWindow): Promise<boolean> {
  if (process.platform === 'darwin') {
    app.focus({ steal: true });    // LSUIElement 앱이 키보드 포커스를 가져오려면 필수
  }
  win.setAlwaysOnTop(true, PLATFORM.alwaysOnTopLevel);
  win.show();
  win.moveTop();
  win.focus();
  return win.isFocused();
}
```

**포커스 확보 실패를 반드시 감지하고 재시도한다.** 이 부분을 대충 만들면
"패널은 떴는데 숫자가 안 먹혀서 결국 마우스로 클릭"하는 최악의 경험이 된다.

1. `focusPanel()`을 호출하고 `win.isFocused()`를 확인한다.
2. 실패하면 **100ms 뒤 한 번 더** 시도한다.
3. 그래도 실패하면 렌더러에 `panel:focus-lost`를 보내
   **힌트 배지를 회색으로 바꾸고** 상단에 "이 창을 클릭하면 키보드로 실행할 수 있습니다"를
   한 줄 표시한다. 조용히 안 먹히는 것보다 이유를 밝히는 편이 낫다.
4. `webContents.on('focus')`가 오면 배지를 원래 색으로 되돌린다.

`webContents.on('blur')`에서도 배지를 숨겨 사용자가 "지금 키 입력이 되는 상태인지"를
언제나 눈으로 알 수 있게 한다.

> **참고:** 대부분의 경우 전역 단축키로 호출된 직후에는 OS가 해당 프로세스에
> 포그라운드 권한을 주므로 1회 시도로 성공한다. 재시도와 시각적 폴백은 안전망이다.
> 근본적으로 이 경로에 의존하지 않으려면 §6.11-C(전역 숫자)와 §6.12(퀵 런처)를 쓴다.

**힌트 문자와 IME:** macOS·Windows 모두 한글 입력 상태에서는 `keydown`의 `key`가
조합 중 문자로 올 수 있다. 힌트 판정은 `event.key`가 아니라 **`event.code`**
(`Digit1`, `KeyQ` …)를 기준으로 하고, `event.isComposing === true`인 입력은 무시한다.
이렇게 하면 한글 입력기가 켜져 있어도 숫자 힌트가 정상 동작한다.

#### B. 키별 전역 단축키 (`item.globalHotkey`, 기본 미지정)

패널을 띄우지 않고 어디서든 특정 키를 실행한다. 자주 쓰는 두세 개에만 지정하는 용도다.

- 편집기 속성 패널에 `전역 단축키` 입력 위젯을 둔다 (§9.4). 클릭하면 키 조합을 캡처한다.
- **검증 규칙** (`validate.ts` + `hotkey:validate`):
  1. **수식키(`Control`/`Alt`/`Shift`/`Super`)가 최소 1개 있어야 한다.**
     단일 키를 전역 등록하면 모든 앱에서 그 키 입력이 가로채여 시스템이 망가진다. 무조건 거부.
  2. `Shift` 단독 조합(`Shift+A` 등)도 거부한다. 대문자 입력이 막힌다.
  3. 앱 내 다른 항목과 중복이면 거부하고 어느 키와 겹치는지 알려준다.
  4. `config.hotkey`(패널 토글) 및 전역 숫자 단축키 범위와 겹치면 거부한다.
  5. `globalShortcut.register()`로 **시험 등록** 후 즉시 `unregister`하여 다른 앱과의 충돌을
     확인한다. 실패하면 "다른 프로그램이 이미 사용 중인 단축키입니다"를 반환한다.
  6. 전체 개수 상한 **20개**. 초과 시 거부.
- 등록된 단축키가 눌리면 `launcher.execute()`를 직접 호출한다. **패널을 띄우지 않는다.**
  성공/실패는 트레이 풍선 알림 대신 조용히 처리하고, 실패 시에만 패널을 띄워 토스트를 보여준다.
- 폴더 키에는 전역 단축키를 지정할 수 없다 (실행할 대상이 없으므로). UI에서 필드를 숨긴다.
- 항목이 삭제되거나 단축키가 바뀌면 반드시 `unregister`한다. 앱 시작 시 전체를 다시 등록한다.
- 등록 실패한 항목은 설정을 지우지 않고 **경고 배지**를 붙여 사용자가 고칠 수 있게 한다
  (다른 앱이 나중에 종료되면 다시 유효해질 수 있으므로).

#### C. 전역 숫자 단축키 (`keyboard.globalNumberHotkeys`, **기본 `true`**)

`Alt+Shift+1` ~ `Alt+Shift+0`(macOS는 `Control+Alt+1`~`0`)을
**최상위(root) 첫 페이지의 1~10번 키**에 매핑한다.
패널을 부르지도, 클릭하지도 않고 어디서든 바로 실행된다. **이것이 주 사용 경로다.**

- 수식키 조합은 `keyboard.globalNumberModifier`로 바꿀 수 있다.
  기본값 선정 근거는 §4.5의 표를 참조한다.
- **매핑 대상은 항상 "root 첫 페이지의 1~10번"으로 고정한다.**
  "현재 보고 있는 페이지"를 따라가게 만들면, 패널을 안 보고 있는 상태에서
  `Alt+Shift+1`이 무엇을 실행할지 예측할 수 없게 된다. 예측 가능성이 최우선이다.
  → 이 번호는 §6.12 퀵 런처의 빈 검색어 상태 번호와도 **완전히 일치한다.**
- 자주 쓰는 키를 root 첫 페이지 앞쪽에 두라는 안내를 설정 화면과 README에 넣는다.
- 10개 중 일부만 등록에 성공할 수 있다. 실패한 것은 조용히 건너뛰고, 설정 화면에
  **어떤 번호가 등록되지 못했는지 목록으로 표시**한다.
- 해당 슬롯이 비어 있거나 폴더 키면 등록은 하되 눌렸을 때 아무 일도 하지 않는다
  (폴더는 실행 대상이 아니다). 소리나 알림을 내지 않는다.
- `B`(키별 전역 단축키)와 겹치면 `B`가 우선한다. 겹친 번호는 등록하지 않는다.
- **첫 실행 시 안내:** 최초 실행 후 패널에 한 번만 나타나는 안내 배너로
  "`Alt+Shift+1`~`0`으로 어디서든 바로 실행할 수 있습니다"를 알린다.
  등록에 실패한 번호가 있으면 설정으로 가는 링크를 함께 준다.

#### 편집기 창에서의 동작

**편집기 창에서는 힌트 배지와 숫자 실행을 사용하지 않는다.** 제목·주소 입력 필드가 있어
숫자 입력과 충돌하기 때문이다. 편집기는 클릭·화살표·`Enter`만 쓴다 (§9.8).

### 6.12 퀵 런처 오버레이 (`windows/launcherWindow.ts`, `shared/search.ts`)

**해결하려는 문제:** §6.11-C의 전역 숫자 단축키는 10개까지만 커버한다.
그보다 많은 키, 특히 폴더 안쪽 키를 마우스 없이 실행하려면
패널을 띄우고 → 포커스를 확보하고 → 폴더를 파고들어야 한다. 단계가 너무 많다.

Spotlight·Alfred 방식의 **검색형 런처**로 이 전부를 한 번에 대체한다.
전역 단축키를 **딱 하나만** 등록하므로 충돌 위험도 거의 없다.

```
        ┌─────────────────────────────────────┐
        │ 🔍 개발_                            │
        ├─────────────────────────────────────┤
        │ 1  💻 VSCode          개발도구      │
        │ 2  🗂 개발 폴더                     │
        │ 3  🌐 개발 문서       북마크 › 참고 │
        └─────────────────────────────────────┘
```

#### 창 사양

```ts
new BrowserWindow({
  width: 640,
  height: 64,              // 결과에 따라 launcher:resize 로 늘어난다. 최대 64 + 8*56 = 512
  frame: false,
  transparent: true,
  resizable: false,
  movable: false,
  skipTaskbar: true,
  focusable: true,         // 이 창은 포커스를 받는 것이 존재 목적이다
  alwaysOnTop: true,
  show: false,
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
});
```

- 위치: **커서가 있는 디스플레이**의 `workArea` 기준 가로 중앙,
  세로는 `workArea.y + workArea.height * 0.25`. Spotlight와 비슷한 위치감.
- `alwaysOnTop` 레벨은 패널과 동일 (`'screen-saver'` / macOS `'floating'`).
- **`blur` 이벤트가 오면 즉시 닫는다.** 다른 곳을 클릭하면 사라지는 것이 런처의 기본 동작이다.
- 열 때마다 검색어를 비우고 입력에 포커스를 준다. 이전 검색어를 남기지 않는다.
- 창은 앱 시작 시 미리 생성해 두고 `show()`/`hide()`만 한다. 매번 만들면 첫 표시가 느리다.

#### 동작 흐름

1. `CommandOrControl+Alt+Space` → 런처가 뜨고 검색 입력에 포커스.
   macOS는 `app.focus({ steal: true })`를 먼저 호출한다 (§6.11-A와 동일).
2. **검색어가 비어 있는 상태:** root 첫 페이지의 1~10번 키를 그대로 보여준다.
   번호도 §6.11-C의 전역 숫자 단축키와 **완전히 동일**하다. 두 체계가 어긋나면 안 된다.
3. **숫자 키:** 검색어가 비어 있을 때만 즉시 실행으로 동작한다.
   타이핑을 시작하면 숫자는 검색어의 일부가 되고, 실행은 화살표 + `Enter`로 한다.
   → 이 규칙이 없으면 "1password"를 검색할 수 없다.
4. **타이핑:** 300ms가 아니라 **즉시**(입력마다) `launcher:query`를 호출한다.
   검색 대상이 최대 500개라 디바운스가 필요 없고, 지연이 있으면 런처답지 않다.
5. **↑/↓** 선택 이동, **`Enter`** 실행, **`Esc`** 닫기, **`Tab`** 다음 결과.
6. 실행 성공 시 런처가 즉시 닫힌다. 실패하면 런처 안에 오류 메시지를 한 줄 표시하고 남는다.
7. 결과는 최대 **8개**만 보여준다. 스크롤을 만들지 않는다.
   그보다 많으면 검색어를 더 치라는 뜻이다.

#### 검색 규칙 (`shared/search.ts` — 순수 함수, 단위 테스트 필수)

- **검색 대상은 `ActionItem`만.** `FolderItem`은 결과에 넣지 않는다.
  런처는 실행 전용이므로 폴더에 "들어갈" 이유가 없다.
  폴더는 결과 줄의 `breadcrumb`(`개발도구 › 문서`)로만 표시한다.
- 트리 전체를 평탄화해 검색한다. 깊이에 상관없이 한 번에 잡힌다.
- 매칭 대상: `label` → 폴더 경로 → `target`(URL 호스트 / 파일명) 순으로 가중치가 낮아진다.

**랭킹 순서 (높은 순)**

1. `label` 접두사 일치 — "vs" → "VSCode"
2. `label`의 단어 시작 일치 — "코" → "개발 코드"
3. **한글 초성 일치** — `ㄱㅂ` → "개발", `ㅁㅅ` → "문서"
4. 영문 이니셜 일치 — `vsc` → "Visual Studio Code"
5. `label` 부분 일치
6. 폴더 경로 부분 일치
7. `target` 부분 일치 (URL 호스트, 파일명)

동점이면 **root에 가까운 순 → `position` 오름차순**으로 정렬한다.

- **한글 초성 검색은 반드시 구현한다.** 한국어 라벨이 대부분일 것이므로
  이게 없으면 검색이 사실상 쓸모없다.
  구현: 완성형 한글(`가`~`힣`)의 유니코드에서 초성 인덱스를 계산한다.
  `초성 = Math.floor((code - 0xAC00) / 588)` → `ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ`
- 검색은 대소문자를 구분하지 않는다.
- 일치 구간을 `matchRanges`로 반환해 렌더러가 굵게 강조한다.
- 검색어에 공백이 있으면 **AND 조건**으로 분리해 모두 만족하는 항목만 남긴다
  ("개발 문서" → 둘 다 포함).

#### 아이콘

`icon:resolve`를 결과 표시 시점에 개별 호출한다(지연 로딩).
캐시가 있으면 즉시 뜨고, 없으면 글자 아이콘으로 시작해 나중에 교체된다.
**아이콘 로딩이 검색 결과 표시를 막아서는 안 된다.**

#### 퀵 런처를 끈 경우

`keyboard.quickLauncher === false`면 창을 만들지 않고 단축키도 등록하지 않는다.

### 6.13 URL 키의 브라우저 지정 (`services/browserService/`)

**해결하려는 문제:** 기본 구현(`shell.openExternal`)은 **OS 기본 브라우저**로만 연다.
그런데 현실에는 브라우저를 가리는 사이트가 있다.

- 공공기관 시스템(나이스, 정부24 등)은 인증서 보안 프로그램이 설치된 특정 브라우저에서만 동작한다
- 업무용/개인용 브라우저 프로필을 분리해 쓰는 경우, 로그인 세션이 다른 프로필로 가면 무용지물이다
- 자주 쓰는 웹앱은 주소창·탭이 없는 **전용 창**으로 띄우는 편이 훨씬 쾌적하다

`ActionItem.browser`가 이 셋을 해결한다. **`browser`가 없으면 기존대로 `shell.openExternal`을 쓴다.**

#### 6.13.1 브라우저 감지

`browsers:list`는 다음을 조사해 `DetectedBrowser[]`를 반환한다. 결과는 24시간 캐시한다.

**Windows** — 아래 경로를 순서대로 확인한다. `%LOCALAPPDATA%` 설치본이 흔하므로 빠뜨리지 않는다.

| 브라우저 | 경로 |
|---|---|
| Chrome | `%ProgramFiles%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\...`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` |
| Edge | `%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe`, `%ProgramFiles%\...` |
| Whale | `%ProgramFiles(x86)%\Naver\Naver Whale\Application\whale.exe`, `%LOCALAPPDATA%\Naver\Naver Whale\Application\whale.exe` |
| Firefox | `%ProgramFiles%\Mozilla Firefox\firefox.exe`, `%ProgramFiles(x86)%\...` |

**macOS** — `/Applications`와 `~/Applications`에서 다음 번들을 찾는다.
`Google Chrome.app`, `Microsoft Edge.app`, `Naver Whale.app`, `Firefox.app`,
`Safari.app`(`/Applications` 또는 `/System/Applications`).

- **§6.1의 `appScanner` 결과를 재사용해도 된다.** 이미 설치된 앱을 스캔하고 있으므로,
  알려진 브라우저 실행 파일명으로 걸러내는 편이 중복 스캔보다 낫다.
- 하나도 못 찾으면 빈 배열을 반환한다. UI는 `기본 브라우저` 옵션만 보여준다.
- 아이콘은 `app.getFileIcon`으로 뽑아 드롭다운에 표시한다.

#### 6.13.2 프로필 목록 읽기 (Chromium 계열만)

Chromium 계열은 사용자 데이터 폴더의 **`Local State`** 파일(JSON)에
`profile.info_cache`가 있고, 여기에 `디렉터리명 → 표시 이름` 매핑이 들어 있다.

```
{ "profile": { "info_cache": {
    "Default":   { "name": "업무용" },
    "Profile 1": { "name": "개인" }
} } }
```

| 브라우저 | Windows | macOS |
|---|---|---|
| Chrome | `%LOCALAPPDATA%\Google\Chrome\User Data` | `~/Library/Application Support/Google/Chrome` |
| Edge | `%LOCALAPPDATA%\Microsoft\Edge\User Data` | `~/Library/Application Support/Microsoft Edge` |
| Whale | `%LOCALAPPDATA%\Naver\Naver Whale\User Data` | `~/Library/Application Support/Naver/Whale` |

- 파일이 없거나 JSON 파싱에 실패하면 **프로필 목록을 비우고 조용히 넘어간다.**
  프로필 지정 없이도 브라우저 지정은 동작해야 한다.
- **Firefox는 `profiles.ini`라 형식이 다르다. v1.0에서는 프로필을 지원하지 않는다**
  (`supportsProfiles: false`). 브라우저 지정만 가능하다.
- **Safari는 프로필도 앱 모드도 지원하지 않는다.** 둘 다 `false`.

#### 6.13.3 실행 방법

`launcher`의 `url` 분기에서 `item.browser`가 있으면 아래를 수행한다.

**플래그 생성 (앱이 직접 만든다. 사용자 입력을 그대로 넣지 않는다)**

```
chromium 계열:
  appMode      → ['--app=' + url]              // URL이 플래그 안에 들어간다
  appMode 아님 → [url]                          // URL을 위치 인자로 전달
  profileDir   → ['--profile-directory=' + profileDir]   앞에 붙인다

firefox:
  ['-P', ...] 미지원. 그냥 [url]
safari:
  플래그 없음. [url]
```

> **`appMode`일 때 URL을 두 번 전달하지 않도록 주의한다.** `--app=<url>`과 위치 인자를
> 함께 주면 창이 두 개 열린다.

**Windows**

```ts
spawn(browser.path, flags, { detached: true, stdio: 'ignore' }).unref();
```

**macOS** — `.app` 번들은 실행 파일이 아니므로 **내부 실행 파일을 직접 spawn한다.**

```ts
// Info.plist 의 CFBundleExecutable 을 읽는다 (§6.1.2의 plist 읽기 재사용)
const exe = path.join(browser.path, 'Contents', 'MacOS', cfBundleExecutable);
spawn(exe, flags, { detached: true, stdio: 'ignore' }).unref();
```

- `open -a`로는 플래그가 안정적으로 전달되지 않고, `open -n`은 새 인스턴스를 강제해
  프로필 잠금 충돌을 일으킬 수 있다. **내부 실행 파일 직접 실행이 정답이다.**
- 실행 파일이 없으면(번들 구조가 예상과 다르면) 기본 브라우저로 폴백한다.

**폴백 규칙**

지정한 브라우저가 사라졌거나(제거됨) 실행에 실패하면:
1. `shell.openExternal(url)`로 기본 브라우저에서 연다. **링크는 반드시 열려야 한다.**
2. 토스트로 "지정한 브라우저를 찾을 수 없어 기본 브라우저로 열었습니다"를 알린다.
3. 편집기에서 해당 키에 경고 배지를 붙인다.

#### 6.13.4 보안

- **사용자가 임의의 브라우저 플래그를 입력할 수 없게 한다.** v1.0에서 앱이 생성하는 플래그는
  `--app=`과 `--profile-directory=` 두 종류뿐이다.
  `--disable-web-security`, `--user-data-dir` 같은 플래그를 사용자가 넣을 수 있으면
  브라우저 샌드박스를 무력화하거나 자격 증명을 다른 폴더로 유출시킬 수 있다.
- `browser.path`는 §8.2의 `app` 타입 경로 검증을 그대로 통과해야 한다.
- `profileDir`은 `/^[A-Za-z0-9 _-]{1,64}$/`만 허용한다.
  경로 구분자(`/`, `\`, `..`)가 들어오면 거부한다.
- `url`은 §8.1의 프로토콜 화이트리스트를 **먼저** 통과해야 한다.
  브라우저 지정이 검증을 우회하는 경로가 되어서는 안 된다.
- `shell: true`를 쓰지 않는다. 플래그는 배열로 전달한다.

### 6.14 엣지·크롬 웹 업무 연결 · Windows 전용 (`services/webConnector/`)

이 기능은 Windows에서만 제공한다. macOS에서는 액션 라이브러리와 설정 탭을 표시하지 않고
업무용 브라우저 구현을 초기화하지 않는다. Windows에서 만든 웹 업무 키를 macOS에서 실행하면
개인 기본 브라우저로 우회하지 않고 Windows 전용 기능이라는 원인을 반환한다.

파워 오토메이트, 브라우저 확장 기능과 외부 중계 서버를 설치하지 않는다. 스트림 패널이 직접
시작하고 소유하는 엣지 또는 크롬을 개발 도구 통신으로 제어한다. 개인 브라우저와 로그인 자료가
섞이지 않도록 `userData/web-connector/profiles/<교육청>/<브라우저>` 아래의 전용 프로필만 쓴다.
교육청이나 브라우저가 다르면 세션과 프로필을 공유하지 않는다.

전국 17개 시도 교육청을 고를 수 있다. 교육청을 바꾸면 등록된 웹 업무 키의 나이스와
에듀파인 주소를 새 교육청 주소로 바꾸되 키 식별자, 브라우저 선택과 멀티 액션 참조는 보존한다.
이전 교육청의 소유 세션은 닫는다.

기본 업무는 `neis-leave`, `neis-trip`, `edufine-draft`, `edufine-purchase` 네 개다.
사용자는 `custom` 업무에서 이름, 나이스 또는 에듀파인 구분, 브라우저, 화면에 보이는 정확한
메뉴 이름 한 단계부터 여덟 단계와 마지막 도착 확인 문구만 저장할 수 있다. 사용자 지정 클릭은
링크, 메뉴, 탭 또는 메뉴를 여는 요소처럼 이동 역할이 확인된 후보로 제한한다. 임의 주소, 선택자,
자바스크립트, 개발 도구 명령과 사용자 입력 명령을 전달하는 통로는 만들지 않는다.

**전용 브라우저 연결**

1. 엣지와 크롬의 알려진 Windows 설치 위치만 찾는다. 선택한 브라우저와 실행 파일 이름이
   다르면 거부한다.
2. 운영체제 파이프 연결을 먼저 사용한다. 파이프가 준비되지 않을 때만 운영체제가 고른 무작위
   로컬 포트로 한 번 다시 시도한다. 고정 포트는 쓰지 않는다.
3. 연결된 브라우저의 제품 식별자가 엣지 또는 크롬과 정확히 일치하는지 확인한다.
4. 교육청과 브라우저별 요청은 직렬로 실행한다. 살아 있는 소유 세션은 재사용하고 닫힌 세션만
   한 번 교체한다.
5. 종료할 때 진행 중 요청과 상태 저장을 기다린 뒤 스트림 패널이 만든 세션만 닫는다.

**업무 이동**

1. `ActionItem.webWorkflow`가 있으면 일반 URL 실행보다 먼저 전용 요청으로 분기한다.
2. 현재 교육청, 업무 종류와 저장된 주소의 짝을 다시 검증한다. 다른 교육청 주소나 비보안
   주소면 개인 브라우저를 열지 않고 거부한다.
3. 허용된 포털, 나이스 또는 에듀파인 탭만 선택한다. 로그인 포털에서는 자동 이동을 멈추고
   사용자가 직접 로그인하도록 알린다.
4. 고정 단계와 사용자 지정 단계마다 화면에서 정확히 한 개인 표시 상태의 활성 후보만 고른다. 후보가 없거나
   둘 이상이면 누르지 않는다.
5. 각 클릭 전후에 허용 주소를 다시 확인한다. 사용자 지정 단계는 다음 메뉴가 보이는지 확인하고,
   마지막 단계는 사용자가 입력한 도착 문구가 보여야 끝낸다.
6. 목표 작성 화면이 열리면 멈추고 결과를 스트림 패널 알림으로 보낸다.

로그인, 인증서, 암호와 외부 보안 프로그램 확인은 사용자가 직접 한다. 저장, 제출, 상신,
승인, 결재, 확정, 삭제, 취소, 확인, 지급, 송금, 이체, 발송, 등록, 신청, 요청, 완료, 반려,
서명, 동의, 전송, 처리와 인증 입력 단추는 사용자 지정 금지 목록으로
고정하며 자동으로 누르지 않는다. 사용자 지정 단계는 이 문구를 포함하면 저장부터 거부한다. 에듀파인 기안은
Windows에 등록된 `WXSClient`가 있어야 하며 새로 생긴 표준 서식 창만 앞으로 가져온다.

상태 파일 `userData/web-connector/managed-state.json`에는 교육청과 브라우저별 마지막 성공
시각만 저장한다. 인증 토큰, 암호, 쿠키, 포트와 개발 도구 주소는 저장하지 않는다. 진단 기록은
`userData/web-connector/diagnostics` 아래에 고정 단계, 결과, 걸린 시간과 호스트 이름만 남기며
전체 주소, 화면 내용과 사용자 입력은 남기지 않는다.

기존 IPC 이름과 입력 모양은 호환을 위해 유지한다. `target:'pair'`는 업무용 포털을 열고,
`target:'folder'`는 정제된 진단 폴더만 열며, `target:'extensions'`는 예전 확장 기능이 더 이상
필요하지 않다는 안내만 반환한다.

### 6.15 멀티 액션 (`services/multiAction/`)

하나의 키에서 기존 실행 키와 기다리기 단계를 위에서 아래로 차례대로 실행한다. 실행 단계는
대상 키의 `id`만 참조하며 복사본을 저장하지 않는다. 따라서 원본 키의 주소나 브라우저를
바꾸면 멀티 액션에도 바로 반영된다.

- 단계는 1개부터 20개까지 실행할 수 있다. 편집 중에는 0개도 저장할 수 있지만 실행은 막는다.
- 기다리기는 단계당 0~60초, 전체 합계 60초 이하로 제한한다.
- 참조 대상은 `kind==='action'`이면서 `type!=='multi'`인 키만 허용한다.
- 자기 자신, 폴더 키, 없는 키, 다른 멀티 액션을 참조하면 저장을 거부한다.
- 단계 하나가 실패하면 뒤 단계를 실행하지 않고 원인과 실패한 순서를 알린다.
- 한 번에 멀티 액션 하나만 실행한다. 실행 중 다시 누르면 중복 실행을 거부한다.
- 실행 요청이 받아들여지면 `button:launch`는 즉시 성공을 반환해 패널 자동 숨김이 동작한다.
- 패널을 다시 열면 현재 순서와 취소 단추가 보인다. 취소하면 기다리기와 뒤 단계를 멈춘다.
- 웹 업무 단계는 전용 업무 요청 접수까지만 성공으로 본다. 실제 화면 이동 결과를 기다리거나
  저장·제출·상신·승인·결재를 자동 실행하지 않는다.
- 임의 셸 명령, 키 입력 흉내, 임의 자바스크립트와 조건 분기는 지원하지 않는다.

### 6.16 결재 대기 업무 알림 · Windows 전용 (`services/approvalMonitor/`)

나이스에서는 결재함, 에듀파인에서는 업무관리와 결재함 메뉴까지만 읽기 전용으로 이동한 뒤
결재함 화면에 표시된 대기 건수만 확인한다. 대기 문서 항목 자체는 누르지 않는다. 기능은 기본으로
꺼져 있으며, 설정에서 시스템별 사용 여부와 업무용 엣지 또는 크롬을 고른 뒤 켠다. macOS에서는
설정 화면, 통신 처리기와 서비스를 만들지 않는다.

- 확인 주기는 5분, 10분, 30분 중 하나이며 기본 10분이다.
- 근무 시간 제한은 기본 08:00부터 18:00까지 켜져 있고 자정을 넘기는 범위도 허용한다.
- 앱 재시작, 교육청 변경, 브라우저 변경 뒤 첫 확인은 기준값만 만들며 알림을 보내지 않는다.
- 같은 연결에서 대기 수가 늘었을 때만 윈도우 알림을 보낸다. 설정에서 매 확인 알림으로 바꿀 수 있다.
- 결재함 키에는 해당 시스템의 대기 수 배지를 표시한다. 키를 누르면 결재함 화면을 앞으로 가져온다.
- 승인, 반려, 서명, 결재 처리, 저장과 제출 요소는 누르지 않는다. 업무관리와 결재함처럼
  이동 역할이 확인된 정확한 메뉴만 한 개 보일 때 누르며 대기 문서 항목은 누르지 않는다.
- 클릭 전후와 수량 읽기 전후에 교육청별 허용 주소를 다시 검사한다. 로그인 포털이나 다른 주소면
  화면 내용을 읽지 않고 멈춘다.
- `userData/approval-monitor/state.json`에는 시스템별 교육청, 업무용 브라우저, 대기 수,
  마지막 확인 시각과 마지막 알림 수만 저장한다. 문서 제목, 작성자, 본문, 인증 정보, 쿠키와
  화면 원문은 저장하지 않는다.
- 예약 확인은 업무용 브라우저의 기존 교육청·브라우저 큐를 함께 써서 작성 화면 이동과 겹치지 않는다.
- 실제 기관 계정에서 화면 메뉴와 수량 표시가 확인되기 전에는 윈도우 실기 완료로 표시하지 않는다.

---

## 7. 액션 실행 엔진 (`launcher.ts`)

`button:launch({path, id})` 처리 흐름:

1. `path`를 따라 계층을 내려가 `id`로 항목을 찾는다. 없으면 `{ok:false, code:'NOT_FOUND'}`.
2. **`kind === 'folder'`이면 실행하지 않는다.** 폴더 진입은 렌더러가 자체 처리한다
   (IPC 왕복 없이 즉시 전환).
3. `validate.ts`로 `type`+`target` 조합을 재검증한다 (§8). 실패 시 `{ok:false, code:'BLOCKED'}`.
4. 타입별 실행:

| type | Windows | macOS |
|---|---|---|
| `url` | `browser`가 없으면 `await shell.openExternal(target)`. 있으면 §6.13.3의 `spawn(browser.path, flags)` | `browser`가 없으면 동일. 있으면 `.app` 내부 실행 파일을 직접 `spawn` (§6.13.3) |
| `folder` | `await shell.openPath(target)` — 반환 문자열이 비어있지 않으면 실패 | 동일 |
| `file` | `await shell.openPath(target)` — 동일 | 동일 |
| `app` | `spawn(target, args, { detached: true, stdio: 'ignore', cwd: workingDir ?? path.dirname(target), windowsHide: false })` 후 `child.unref()` | **`.app` 번들은 실행 파일이 아니므로 spawn 할 수 없다.** `args`가 비었으면 `await shell.openPath(target)`, `args`가 있으면 `spawn('open', ['-a', target, '--args', ...args], { detached: true, stdio: 'ignore' })` 후 `unref()` |
| `uwp` | `spawn('explorer.exe', ['shell:AppsFolder\\' + target], { detached: true, stdio: 'ignore' })` 후 `unref()` | **해당 없음.** `{ok:false, code:'BLOCKED', message:'이 항목은 Windows에서만 실행할 수 있습니다'}` 반환 |
| `multi` | §6.15의 실행 관리자가 참조 키와 기다리기를 순서대로 실행 | 동일 |

`launcher/`도 §6.0 원칙에 따라 `index.ts` / `windows.ts` / `macos.ts`로 나눈다.
`url` · `folder` · `file`은 공통 구현을 공유하고, `app` · `uwp`만 플랫폼별로 구현한다.

5. **`shell: true`를 절대 쓰지 않는다.** 인자는 배열로 전달한다 (명령어 인젝션 방지).
   macOS의 `open -a` 호출도 마찬가지로 배열 인자만 쓴다.
6. `folder`/`file`/`app`은 실행 전 `fs.existsSync(target)`으로 존재를 확인한다.
   없으면 `{ok:false, code:'NOT_FOUND', message:'대상을 찾을 수 없습니다: <경로>'}`.
7. 실패 시 렌더러에 `toast`로 한국어 오류 메시지를 보낸다.
8. 성공(`{ok:true}`) 시 §6.10-A의 자동 숨김 정책을 적용한다.
   `behavior.hideAfterLaunch`가 켜져 있고 `keepOpen !== true`이며 편집기 창이 닫혀 있으면,
   `hideAfterLaunchDelayMs` 뒤에 패널을 숨긴다. 실패했거나 폴더 진입이면 숨기지 않는다.

**시각 피드백:** 클릭 즉시 키에 눌림 애니메이션(scale 0.94, 90ms). 실패 시 키가 빨갛게 흔들린다.

---

## 8. 보안 요구사항 (`security/validate.ts`)

렌더러는 신뢰할 수 없는 입력원으로 취급한다. **모든 IPC 핸들러는 첫 줄에서 입력을 검증한다.**

### 8.1 URL 검증

- `new URL(target)` 파싱 실패 시 거부.
- 허용 프로토콜 화이트리스트: `http:`, `https:`, `mailto:`.
- **명시적 차단:** `file:`, `javascript:`, `data:`, `vbscript:`, `ms-msdt:`, `search-ms:`.
- 그 외 커스텀 스킴(`slack:`, `spotify:` 등)은 v1.0에서 거부하고
  "현재 http/https/mailto 링크만 지원합니다"를 안내한다.

### 8.2 경로 검증

- 절대 경로만 허용. 상대 경로·`..` 포함 경로 거부. `path.normalize` 후 재검사.
- `folder` 타입은 `statSync().isDirectory()`가 참, `file`은 거짓이어야 한다.
  **macOS 예외:** `.app`은 디렉터리이지만 `folder`가 아니라 `app`으로 분류한다.
  경로가 `.app`으로 끝나면 `folder` 타입 지정을 거부하고 `app`을 쓰라고 안내한다.
- `app` 타입의 `target` 규칙:
  - **Windows:** 확장자가 `.exe`, `.bat`, `.cmd` 중 하나.
  - **macOS:** `.app`으로 끝나는 디렉터리, 또는 실행 권한(`fs.constants.X_OK`)이 있는 파일
    (`.sh`, `.command`, 확장자 없는 바이너리 포함).
  - **스크립트 경고:** `.bat`/`.cmd`/`.sh`/`.command`는 허용하되 편집기 속성 패널에
    "스크립트 파일입니다. 신뢰하는 파일만 등록하세요" 경고를 띄운다.
- `uwp` 타입은 **Windows에서만 생성 가능**하다. macOS에서 이 타입으로 저장을 시도하면 거부한다.
- 플랫폼별 확장자 규칙은 `validate.ts`에서 `platform` 인자를 받는 순수 함수로 구현해
  양쪽 규칙을 한 머신에서 모두 테스트할 수 있게 한다.

### 8.3 구조·문자열 제한

`label` 1~24자 · `args` 길이 ≤ 16, 각 원소 ≤ 512자 · `target` ≤ 2048자 ·
`color` `/^#[0-9a-fA-F]{6}$/` · **폴더 중첩 깊이 ≤ 5** · 전체 항목 수 ≤ 500 ·
한 계층의 항목 수 ≤ 120. 초과 시 throw.
`deck:upsert`/`deck:move`는 **순환 참조 생성을 거부한다** (폴더를 자기 자신의 하위로 이동 금지).

### 8.4 Electron 하드닝

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (모든 창)
- `index.html`·`editor.html`에 CSP 메타 태그:
  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none';
  base-uri 'none'; form-action 'none'
  ```
  (파비콘은 메인이 받아 data URL로 넘기므로 외부 호스트가 필요 없다.)
- `app.on('web-contents-created')`에서 모든 webContents에:
  - `setWindowOpenHandler(() => ({ action: 'deny' }))`
  - `will-navigate` 차단, `will-attach-webview` 거부
- 패키지된 앱에서는 DevTools를 열지 않는다 (`!app.isPackaged`일 때만 허용).
- **OS 드롭 처리 시 `event.preventDefault()`를 반드시 호출**해 Electron이 드롭된 파일로
  내비게이션하는 것을 막는다.

---

## 9. UI/UX 명세

### 9.1 테마

CSS 변수로 정의한다. `theme: 'system'`이면 `nativeTheme.shouldUseDarkColors`를 따르고
`nativeTheme.on('updated')`로 갱신한다.

```
다크:   --bg: rgba(22,22,26,0.92)   --tile: #2a2a31  --tile-hover: #35353e
        --text: #f0f0f3  --text-dim: #9a9aa5  --accent: #5b8cff  --border: rgba(255,255,255,0.08)
라이트: --bg: rgba(248,248,250,0.94) --tile: #ffffff  --tile-hover: #f0f0f4
        --text: #1a1a1f  --text-dim: #6a6a76  --accent: #3b6fe0  --border: rgba(0,0,0,0.08)
```

패널 루트는 `border-radius: 12px`, `backdrop-filter: blur(20px)`, 1px 테두리.
투명 창이므로 `body { background: transparent }`이고 실제 배경은 `.panel` 요소가 그린다.

### 9.2 키 타일 (패널·편집기 공용 컴포넌트)

- 정사각형, `border-radius: 10px`. 배경은 `item.color`를 12% 알파로 깔고 `--tile` 위에 합성.
- 아이콘 크기 = `buttonSize * 0.46`, 아이콘 아래 라벨.
- 라벨: 11px, 최대 2줄, `text-overflow: ellipsis`, 넘치면 `title` 속성으로 전체 표시.
- 호버: 배경 밝아짐 + `translateY(-1px)`, 120ms ease-out. 액티브: `scale(0.94)`.
- **폴더 키**는 우하단에 작은 겹침 표시(하위 아이콘 2~3개의 미니 미리보기 또는 `▸` 배지)를 그려
  액션 키와 시각적으로 구별한다.
- **`↩ 뒤로` 키**는 폴더 내부 페이지 0의 슬롯 0에 항상 렌더링된다. 배경이 `--tile-hover`로
  살짝 다르고, 드롭 타깃이 아니며, 우클릭 메뉴가 없다.
- 빈 칸: 점선 테두리 + 가운데 `+`. 호버 시에만 선명해진다.

### 9.3 패널 창 (`index.html`)

```
┌────────────────────────────────────┐
│ ⠿  Stream Panel        🔓 ⚙ ✕     │  ← 34px 타이틀바 (드래그 영역)
├────────────────────────────────────┤
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐          │
│  │🌐│ │📁│ │🖥│ │🗂│ │ +│          │
│  └──┘ └──┘ └──┘ └──┘ └──┘          │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐          │
│  └──┘ └──┘ └──┘ └──┘ └──┘          │
├────────────────────────────────────┤
│  홈 › 개발도구            ● ○      │  ← 26px 푸터 (경로 + 페이지 도트)
└────────────────────────────────────┘
```

- **키 클릭 = 실행.** 폴더 키 클릭 = 폴더 진입 (경로 브레드크럼 갱신).
- **`Shift` + 클릭 = 실행하되 패널을 닫지 않음** (`keepOpen: true`, §6.10-A).
  여러 개를 연달아 실행할 때 쓴다. 키 툴팁에 "Shift+클릭: 패널 유지"를 표시한다.
- **빈 칸 클릭 = 편집기 창이 열리고 해당 슬롯이 선택된 상태로 진입** (`editor:open`).
  사용자가 패널에서 바로 추가를 시작할 수 있게 하는 다리 역할.
- 페이지 전환: 하단 도트 클릭 · 마우스 휠 · `Ctrl+←/→`.
- 폴더 밖으로 나가기: `뒤로` 키 · `Backspace` · 푸터 브레드크럼 클릭.
- 타이틀바 우측 아이콘 3개:
  - `🔓/🔒` 잠금 토글 — 잠그면 창 이동·재배치·빈 칸 `+`가 모두 비활성화된다
  - `⚙` 편집기 창 열기
  - `✕` 숨기기 (종료 아님). 툴팁 "숨기기 (Ctrl+Alt+D로 다시 열기)"
- 잠금 해제 상태에서는 패널 내에서도 키를 드래그해 **위치 교환**이 가능하다.
  (새 항목 추가·속성 편집은 편집기에서만)

### 9.4 편집기 창 (`editor.html`) — 스트림덱 앱에 해당

별도 `BrowserWindow`: 1000×680, 일반 프레임, 리사이즈 가능, 최소 840×560.
패널의 자식 창이 아니며 독립적으로 존재한다.

```
┌──────────────────────────────────────────────────────────────┐
│ Stream Panel 편집기                                _ □ ✕     │
├───────────────────────────────────┬──────────────────────────┤
│ 홈 › 개발도구            ● ○      │ 액션                     │
│                                   │ ┌──────────────────────┐ │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐   │ │ 🔍 검색            │ │
│  │ ↩  ││ 🌐 ││ 📁 ││    ││    │   │ └──────────────────────┘ │
│  └────┘└────┘└────┘└────┘└────┘   │ 🔗 웹사이트              │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐   │ 📁 폴더 열기             │
│  │    ││    ││    ││    ││    │   │ 📄 파일 열기             │
│  └────┘└────┘└────┘└────┘└────┘   │ 🖥️ 앱 실행               │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐   │ 🗂️ 폴더 만들기           │
│  │    ││    ││    ││    ││    │   │ ──── 설치된 앱 ────      │
│  └────┘└────┘└────┘└────┘└────┘   │ ▪ Visual Studio Code     │
│                                   │ ▪ Chrome                 │
│                       🗑 여기로    │ ▪ 계산기                 │
│                       끌어 삭제    │ ▪ ...                    │
├───────────────────────────────────┴──────────────────────────┤
│ 선택한 키                                                     │
│ 제목 [개발 폴더_______] (12/24)      아이콘 [🖼][변경][지우기] │
│ 종류 웹사이트                        색상 ■■■■■■■■■■ [#5b8cff] │
│ 주소 [https://github.com_____________________] [찾아보기]     │
└──────────────────────────────────────────────────────────────┘
```

**왼쪽 그리드**
- 패널과 **완전히 동일한 그리드 크기·슬롯 규칙**으로 렌더링한다 (§4.3). 실제 배치를 그대로 미리 본다.
- 폴더 키를 **더블클릭**하면 그 안으로 들어간다. 상단 브레드크럼으로 상위 복귀.
- 키를 **한 번 클릭**하면 선택되어 하단 속성 패널에 내용이 뜬다.
- 그리드 하단에 휴지통 드롭 영역이 있고, 드래그 중에만 표시된다.

**오른쪽 라이브러리**
- 상단 검색 입력. 액션 템플릿 5개 + 설치된 앱을 함께 필터링한다.
- 설치된 앱은 가상 스크롤 + 아이콘 지연 로딩. 스캔 중에는 스켈레톤 표시.
- 하단에 `목록 새로고침` 링크 (`apps:list({refresh:true})`).

**하단 속성 패널**
- 선택된 키가 없으면 "키를 선택하거나 오른쪽에서 액션을 끌어다 놓으세요" 안내를 표시한다.
- 필드는 종류에 따라 달라진다:
  - `url`: 주소 입력. `https://`가 없으면 저장 시 자동으로 붙인다.
    입력 후 300ms 디바운스로 파비콘을 미리 가져와 아이콘 미리보기에 반영하고,
    제목이 비어 있으면 호스트명을 제안한다.
    아래에 **브라우저 지정 3종**(§6.13)을 둔다:
    - `열 브라우저` 드롭다운 — `기본 브라우저`(기본값) + `browsers:list` 결과.
      각 항목에 브라우저 아이콘을 함께 표시한다
    - `프로필` 드롭다운 — 선택한 브라우저가 Chromium 계열일 때만 활성화.
      `Local State`에서 읽은 표시 이름(`업무용`, `개인`)을 보여준다.
      프로필이 하나뿐이면 드롭다운을 숨긴다
    - `전용 창으로 열기` 체크박스 — Chromium 계열일 때만 활성화.
      옆에 "주소창과 탭이 없는 창으로 열립니다" 안내
    - Firefox 선택 시 프로필·전용 창을 비활성화하고 "이 브라우저는 프로필과 전용 창을
      지원하지 않습니다"를 표시한다. Safari도 동일
    - 지정한 브라우저가 사라졌으면 드롭다운에 `찾을 수 없음` 경고 배지를 붙인다
  - `folder`/`file`: 경로(읽기 전용) + `찾아보기` 버튼. 제목이 비면 `path.basename`을 제안.
  - `app`: 경로 + `찾아보기`(`.exe`/`.lnk`) + `실행 인자`(공백 구분 문자열 → 배열로 파싱) +
    `작업 폴더`(선택).
  - `uwp`: AppID를 읽기 전용으로 표시. 편집 불가.
  - `folder`(FolderItem): 제목·아이콘·색상만. 대상 필드 없음.
- **`전역 단축키` 필드** (§6.11-B): 클릭하면 키 조합을 캡처하는 위젯. 비워두면 미지정.
  입력 즉시 `hotkey:validate`로 검사하고, 실패하면 필드 아래에 한국어 사유를 표시한다
  (수식키 없음 / 다른 키와 중복 / 다른 프로그램이 사용 중 / 20개 초과).
  `FolderItem`에는 이 필드를 표시하지 않는다.
  옆에 `지우기` 버튼과 현재 등록 상태 배지(`등록됨` / `충돌`)를 둔다.
- 모든 편집은 **즉시 저장**된다(별도 저장 버튼 없음). 400ms 디바운스 후 `deck:upsert`.
- 유효성 실패 시 해당 필드 아래에 한국어 오류 메시지를 표시하고 저장을 보류한다.

**아이콘 컨트롤**
- `변경` 클릭 → 팝오버: `자동` / `이모지` / `이미지 선택` / `글자` 4개 탭.
- 이모지 탭은 카테고리별 이모지 그리드(약 200개면 충분) + 직접 입력.
- 이미지 탭은 `picker:image` 호출. 144×144 권장 안내 문구를 함께 표시한다.
- 색상은 미리 정의된 팔레트 10개 + 커스텀 hex 입력.

**편집기 하단 우측**에 `설정` 버튼 → 설정 다이얼로그(모달, §9.9).

### 9.5 드래그 앤 드롭 (핵심 상호작용)

`@dnd-kit/core`로 구현한다. 다음 6가지 경로를 모두 지원한다.

| # | 드래그 소스 | 드롭 대상 | 동작 |
|---|---|---|---|
| 1 | 라이브러리 액션 템플릿 | 그리드 빈 슬롯 | 새 `ActionItem` 생성. `target`이 비어 있으므로 속성 패널에 포커스가 가고, `folder`/`file`/`app`은 **즉시 찾아보기 다이얼로그를 연다**. `url`은 주소 입력에 포커스. |
| 2 | 라이브러리 `폴더 만들기` | 그리드 빈 슬롯 | 빈 `FolderItem` 생성 (`label:'새 폴더'`). 제목 입력에 포커스 + 전체 선택. |
| 3 | 라이브러리 설치된 앱 | 그리드 빈 슬롯 | `target`·`args`·`workingDir`·`label`·`icon:{kind:'auto'}`가 즉시 채워진 완성 상태로 생성. |
| 4 | 그리드 키 | 그리드 다른 슬롯 | 빈 슬롯이면 이동, 채워진 슬롯이면 **위치 교환(swap)**. |
| 5 | 그리드 키 | 그리드의 폴더 키 위 | **500ms 호버 후** 폴더가 하이라이트되고, 놓으면 그 폴더의 첫 빈 슬롯으로 이동. 깊이 5 초과 시 거부 + 토스트. |
| 6 | 그리드 키 | 휴지통 영역 | 삭제. 폴더면 "하위 N개 항목도 함께 삭제됩니다" 확인 다이얼로그. |

- 드래그 중 원래 자리는 반투명(0.35), 드롭 가능 슬롯은 `--accent` 테두리로 하이라이트.
- 드래그 프리뷰는 실제 타일을 반투명하게 복제해 커서를 따라간다.
- 잘못된 드롭(라이브러리로 되돌리기 등)은 원위치로 스프링백 애니메이션.
- **편집기 왼쪽 그리드에서 폴더 키 위로 드래그해 500ms 머무르면 폴더 안으로 진입**해서
  그 안에 바로 놓을 수도 있다 (스프링 로디드 폴더). 진입했으면 브레드크럼이 갱신된다.

### 9.6 OS에서 끌어다 놓기 (`drop:classify`)

편집기 그리드는 탐색기/브라우저에서 직접 드롭받는다. 매우 유용하므로 반드시 구현한다.

1. `dragover`/`drop`에서 **`event.preventDefault()`를 반드시 호출**한다 (§8.4).
2. `event.dataTransfer`에서:
   - `files` → 각 파일의 경로를 `drop:classify`로 보낸다.
     - Windows: 디렉터리면 `type:'folder'`, 파일이면 `type:'file'`,
       `.exe`/`.lnk`면 `type:'app'` (`.lnk`는 `readShortcutLink`로 해석)
     - macOS: **`.app`으로 끝나면 `type:'app'`**(디렉터리여도 폴더가 아니다),
       그 외 디렉터리는 `type:'folder'`, 파일은 `type:'file'`.
       심볼릭 링크는 `fs.realpath`로 해석한 뒤 분류한다
     - **이미지 파일을 기존 키 위에 떨어뜨리면** 새 키를 만들지 않고 그 키의 **아이콘을 교체**한다.
   - `text/uri-list` 또는 `text/plain`이 유효한 http(s) URL이면 → `type:'url'`
3. `label`은 파일명(확장자 제외) 또는 URL 호스트명으로 자동 설정한다.
4. 여러 개를 동시에 드롭하면 드롭 슬롯부터 빈 슬롯을 순서대로 채운다. 슬롯이 모자라면
   다음 페이지를 만든다.
5. Electron에서 파일 경로를 얻을 때 최신 API(`webUtils.getPathForFile`)를 사용한다.
   `File.path` 속성에 의존하지 않는다.

### 9.7 컨텍스트 메뉴 (키 우클릭)

렌더러에서 직접 그린다(Electron Menu 아님). 패널과 편집기 모두에서 동작한다.

| 항목 | 패널 | 편집기 |
|---|---|---|
| 편집 | 편집기를 열고 해당 키 선택 | 속성 패널로 포커스 |
| 복사 (`Ctrl+C`) | ○ | ○ |
| 잘라내기 (`Ctrl+X`) | ○ | ○ |
| 붙여넣기 (`Ctrl+V`) | 빈 슬롯 우클릭 시 | 빈 슬롯 우클릭 시 |
| 복제 | ○ | ○ |
| 아이콘 변경 | 편집기 열기 | 아이콘 팝오버 |
| 위치 열기 | app/file/folder만 | 동일 |
| 삭제 (`Delete`) | 빨간색 | 빨간색 |

- 클립보드는 **앱 내부 메모리**에 보관한다(OS 클립보드 아님). 붙여넣기 시 새 `id`를 발급한다.
- 폴더를 복사하면 하위 전체가 깊은 복사된다.
- `Esc` 또는 바깥 클릭으로 닫히고, 화면 밖으로 나가지 않게 위치를 보정한다.
- 잠금(`window.locked`) 상태의 패널에서는 컨텍스트 메뉴가 뜨지 않는다.

### 9.8 키보드

**패널 창**

| 키 | 동작 |
|---|---|
| 힌트 문자 (`1`~`0`, `q`~`/`) | 해당 키 실행. 폴더면 진입 (§6.11-A) |
| `Shift` + 힌트 문자 | 실행하되 패널 유지 (`keepOpen`) |
| 화살표 | 그리드 내 이동 (roving tabindex) |
| `Enter` / `Space` | 포커스된 키 실행 / 폴더 진입 |
| `Backspace` | 상위 폴더로 복귀 |
| `Ctrl+←/→` | 페이지 전환 |
| `Esc` | 패널 숨기기 |
| `Delete` | 삭제 (잠금 해제 상태에서만) |
| `Ctrl+C/X/V` | 클립보드 (§9.7) |

**편집기 창**

- 화살표 이동, `Enter` 선택, `F2` 이름 변경, `Delete` 삭제, `Ctrl+C/X/V` 클립보드.
- **힌트 문자 실행은 동작하지 않는다** (입력 필드와 충돌하므로, §6.11).

**공통**

- 다이얼로그·팝오버는 포커스 트랩 + `Esc` 닫기.
- 모든 아이콘 버튼에 한국어 `aria-label`. 힌트 배지는 `aria-hidden`으로 두고,
  키 자체의 `aria-keyshortcuts` 속성에 힌트 문자를 넣는다.
- `prefers-reduced-motion: reduce`면 모든 트랜지션을 0ms로.

### 9.8.1 퀵 런처 UI (`launcher.html`, §6.12)

```
┌───────────────────────────────────────────┐
│  🔍  개발|                                │  ← 64px, 18px 폰트
├───────────────────────────────────────────┤
│  1   💻  VS**Code**            개발도구   │  ← 56px each
│  2   🗂  **개발** 폴더                    │
│  3   🌐  **개발** 문서       북마크 › 참고│
└───────────────────────────────────────────┘
```

- 루트 컨테이너: `border-radius: 14px`, `backdrop-filter: blur(24px)`,
  `box-shadow: 0 16px 48px rgba(0,0,0,0.35)`, 1px 테두리. 패널보다 그림자를 강하게 준다.
- 검색 입력: 배경 없음, 테두리 없음, `caret-color: var(--accent)`, placeholder
  "실행할 항목 이름을 입력하세요".
- 결과 줄: 왼쪽부터 `번호 배지(20px)` · `아이콘(28px)` · `라벨` · (오른쪽 정렬)`breadcrumb`.
- 선택된 줄은 `--tile-hover` 배경 + 왼쪽에 3px `--accent` 막대.
- `matchRanges` 구간을 `<strong>`으로 감싸고 `color: var(--accent)`로 강조한다.
- `breadcrumb`은 `--text-dim`, 11px. 비어 있으면(root 직속) 아무것도 표시하지 않는다.
- 결과가 없으면 한 줄로 "일치하는 항목이 없습니다"를 `--text-dim`으로 표시한다.
- 결과 개수가 바뀔 때마다 `launcher:resize`로 창 높이를 조정한다.
  높이 전환에 애니메이션을 넣지 않는다 — 창 리사이즈 애니메이션은 깜빡임을 만든다.
- `prefers-reduced-motion`과 무관하게 런처는 **페이드 인 없이 즉시** 표시한다.
  런처는 체감 속도가 전부다.

### 9.9 설정 (편집기 내 모달)

Windows 탭 6개: `일반` / `동작` / `모양` / `단축키` / `웹 업무 연결` / `정보`

macOS 탭 5개: `일반` / `동작` / `모양` / `단축키` / `정보`. `웹 업무 연결`은 표시하지 않는다.

- **일반**: 로그인 시 자동 시작 · 시작 시 숨김 · 자동 업데이트 확인 · 설정 초기화(2단계 확인)
- **동작** (§6.10 — 화면 가림 방지):
  - `실행 후 패널 숨기기` 토글 (기본 켬) + 지연 시간 슬라이더(0~600ms)
    → 아래에 안내: "Shift를 누른 채 클릭하면 패널이 유지됩니다"
  - `화면 가장자리에서 다시 꺼내기` 토글 (기본 켬)
    → 하위 설정: 가장자리(자동/좌/우/상/하) · 띠 두께(4~12px) · 반응 지연(0~600ms)
    → `실행 후 패널 숨기기`가 꺼져 있어도 단축키·트레이 숨김에 그대로 적용된다
  - `가만히 두면 흐려지기` 토글 (기본 끔)
    → 하위 설정: 대기 시간(1~15초) · 흐린 상태 투명도(0.1~0.9)
    → 안내: "흐려진 상태에서는 클릭이 뒤쪽 창으로 통과됩니다"
  - 각 토글 옆에 한 줄 설명을 붙여 무엇이 달라지는지 바로 알 수 있게 한다
- **모양**: 테마(시스템/라이트/다크) · 그리드 열 슬라이더(2~8) · 행 슬라이더(1~6) ·
  버튼 크기(64~140) · 투명도(0.3~1.0) · 항상 최상위 토글
  → **모두 라이브 프리뷰**: 변경 즉시 패널과 편집기 그리드에 반영된다.
  → 그리드를 줄여서 기존 항목이 범위를 벗어나면 "N개 항목이 다음 페이지로 이동합니다" 안내를 띄운다.
    **항목을 삭제하지 않는다.**
- **단축키** (§6.11):
  - `패널 표시/숨김` 캡처 위젯 (기본 `Ctrl+Alt+D`). 충돌 시 즉시 오류 표시 + 롤백.
  - `숫자 힌트 표시` 선택: 포커스 시에만(기본) / 항상 / 숨김
    → 안내: "숨김을 선택해도 키 입력은 그대로 동작합니다"
  - `힌트 문자 순서` 입력 (기본 `1234567890qwertyuiop...`). 중복 문자 입력 시 오류.
  - `힌트로 실행 후 패널 숨기기` 토글 (기본 켬)
    → 안내: "Shift를 함께 누르면 패널이 유지됩니다"
  - **`퀵 런처`** 토글 (기본 켬) + 단축키 캡처 위젯 (기본 `Ctrl+Alt+Space` / `⌘⌥Space`)
    → 안내: "어디서든 눌러 이름으로 검색해 실행합니다. 한글 초성도 됩니다"
  - **`전역 숫자 단축키`** 토글 (**기본 켬**) + 수식키 조합 선택
    (`Alt+Shift` / `Ctrl+Alt` / `Ctrl+Shift` / `Win+Alt`)
    → 안내: "**맨 앞 페이지의 1~10번 키**를 어디서든 바로 실행합니다.
      자주 쓰는 항목을 앞쪽에 배치하세요"
    → 그 아래에 현재 1~10번에 무엇이 연결돼 있는지 **미리보기 목록**을 보여준다.
      무엇이 실행될지 모르는 상태를 만들지 않는다
    → 등록에 실패한 번호가 있으면 빨간 글씨로 목록 표시
  - **`등록된 전역 단축키` 목록**: 키별로 지정된 `globalHotkey`를 한 표에 모아 보여준다.
    각 행에 키 이름 · 단축키 · 상태(`등록됨`/`충돌`) · `해제` 버튼.
    어디에 무엇이 걸려 있는지 한눈에 보이지 않으면 관리가 불가능해진다.
- **정보**: 버전 · 저장소 링크 · 라이선스 · `업데이트 확인` 버튼 + 진행 상태
- **웹 업무 연결** (§6.14, Windows에서만 표시):
  - 소속 교육청 선택과 교육청 변경 시 기존 웹 업무 키 주소 함께 갱신
  - 업무용 엣지 추천 카드와 업무용 크롬 카드
  - 브라우저별 `준비됨` / `실행 중` / `연결 필요` / `오류` 상태
  - `업무용 브라우저 열기` · `연결 시험`, 오류일 때만 `문제 해결 폴더 열기`
  - `내 웹 업무 만들기`: 업무 이름 · 나이스/에듀파인 · 엣지/크롬 · 최대 8개 메뉴 이름 · 도착 확인 문구
  - `키로 추가`를 누르면 루트의 첫 빈 위치에 만들고 속성 패널에서 경로를 읽기 전용으로 표시
  - `업무 알림`: 시스템별 켜기 · 브라우저 · 확인 주기 · 근무 시간 · 지금 확인 · 결재함 키 추가
  - 결재 대기 수, 마지막 확인 상태와 로그인 필요 원인을 표시하고 대기 수 배지를 패널 키에 연결
  - 개인 프로필 분리, 인증 정보 미저장, 저장·제출·상신·승인·결재 전에 멈춘다는 안내

### 9.10 문구 언어

**모든 사용자 대면 문구는 한국어.** 코드 식별자·주석은 영어.
오류 메시지는 원인과 해결책을 함께 준다.
예: `"대상 폴더를 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다: D:\\작업"`

---

## 10. 자동 업데이트 (`updater.ts`)

### 10.1 플랫폼별 정책 (먼저 읽을 것)

| | Windows | macOS |
|---|---|---|
| 자동 업데이트 | **동작한다** | **동작하지 않는다** |
| 이유 | 무서명 NSIS도 `electron-updater`가 처리 가능 | Squirrel.Mac이 코드 서명을 검증한다. 서명 없는 앱은 업데이트 적용이 실패한다 |
| 대체 동작 | 자동 다운로드 후 "재시작하면 적용" 안내 | **버전만 확인하고 알림.** 새 버전이 있으면 GitHub 릴리즈 페이지를 여는 버튼을 제공한다 |

**macOS 구현 (`updater/macos.ts`)**

- `electron-updater`를 **초기화하지 않는다.** 초기화만 해도 서명 검증 오류가 로그를 채운다.
- 대신 GitHub Releases API로 최신 태그만 조회한다:
  `https://api.github.com/repos/deepsky616/stream-panel/releases/latest` → `tag_name`
- `net.fetch` 사용, 타임아웃 6초, 실패 시 조용히 무시.
- 현재 버전보다 높으면 `update:status`로 `{state:'available', version}`을 보낸다.
- 사용자가 `릴리즈 페이지 열기`를 누르면 `shell.openExternal`로 릴리즈 URL을 연다.
- 설정 `정보` 탭에 "macOS에서는 자동 업데이트를 지원하지 않습니다. 새 버전은 직접 내려받아
  설치해 주세요"를 명시한다. 조용히 동작하지 않는 것보다 이유를 밝히는 편이 낫다.
- `defaults.ts`에서 macOS는 `autoUpdate: false`로 시작하지만, 이 값은
  "**버전 확인 알림**을 받을지"를 의미한다. 설정 UI 라벨도 그렇게 바꾼다.

### 10.2 Windows 자동 업데이트

```ts
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
```

- `app.isPackaged`이고 `process.platform === 'win32'`이고 `config.autoUpdate === true`일 때만 동작한다.
- 시작 후 10초 뒤 1회, 이후 6시간마다 `checkForUpdates()`.
- 이벤트를 `update:status`로 렌더러에 중계한다.
- `update-downloaded` 시:
  - 트레이 툴팁과 설정 `정보` 탭에 "재시작하면 v{x} 적용" 배지
  - 패널 타이틀바 `⚙` 아이콘에 파란 점
  - **자동 재시작하지 않는다.** 사용자가 `지금 재시작`을 누르면 `quitAndInstall()`.
- 업데이트 오류는 모달로 띄우지 않는다. 로그 + 설정 창에만 표시한다.
- 개발 모드에서 `electron-updater`가 던지는 "no published versions" 오류를 삼킨다.

---

## 11. 저장소 구조

```
stream-panel/
├─ .github/workflows/{ci.yml, release.yml}
├─ build/{icon.ico, icon.icns, icon.png}
├─ resources/{tray.ico, trayTemplate.png, trayTemplate@2x.png}
├─ src/
│  ├─ main/
│  │  ├─ index.ts                    # 라이프사이클, 단일 인스턴스, --hidden 처리
│  │  ├─ windows/{panelWindow.ts, editorWindow.ts, peekWindow.ts, launcherWindow.ts}
│  │  ├─ tray.ts
│  │  ├─ shortcuts.ts               # 전역 단축키 레지스트리 (§6.8, §6.11-B/C)
│  │  ├─ store.ts                    # electron-store + 마이그레이션 + 정규화
│  │  ├─ ipc/{index.ts, configHandlers.ts, deckHandlers.ts, launchHandlers.ts,
│  │  │       pickerHandlers.ts, iconHandlers.ts, dropHandlers.ts, windowHandlers.ts}
│  │  ├─ platform/index.ts          # 플랫폼별 상수·판별 (§6.0). 창 레벨, 트레이 에셋 등
│  │  ├─ services/
│  │  │  ├─ appScanner/{index.ts, types.ts, windows.ts, macos.ts}
│  │  │  ├─ browserService/{index.ts, detect.ts, profiles.ts, flags.ts}  # §6.13
│  │  │  ├─ launcher/{index.ts, common.ts, windows.ts, macos.ts}
│  │  │  ├─ updater/{index.ts, windows.ts, macos.ts}
│  │  │  └─ {visibility.ts, iconService.ts, faviconService.ts, autoLaunch.ts}
│  │  └─ security/validate.ts
│  ├─ preload/index.ts
│  ├─ renderer/
│  │  ├─ index.html                  # 패널
│  │  ├─ editor.html                 # 편집기
│  │  ├─ peek.html                   # 가장자리 트리거 스트립 (§6.10-B)
│  │  ├─ launcher.html               # 퀵 런처 오버레이 (§6.12)
│  │  └─ src/
│  │     ├─ {main.tsx, editor.tsx, peek.tsx, launcher.tsx}
│  │     ├─ launcher/{LauncherApp.tsx, SearchInput.tsx, ResultRow.tsx}
│  │     ├─ panel/{PanelApp.tsx, TitleBar.tsx, PanelGrid.tsx, Footer.tsx}
│  │     ├─ editor/{EditorApp.tsx, KeyGrid.tsx, ActionLibrary.tsx, PropertiesPanel.tsx,
│  │     │          TrashZone.tsx, SettingsModal.tsx}
│  │     ├─ common/{KeyTile.tsx, BackTile.tsx, EmptyTile.tsx, ContextMenu.tsx,
│  │     │          IconPicker.tsx, ColorPicker.tsx, Breadcrumb.tsx, PageDots.tsx, Toast.tsx}
│  │     ├─ hooks/{useConfig.ts, useLocation.ts, useClipboard.ts, useKeyboardGrid.ts}
│  │     ├─ store/deckStore.ts
│  │     └─ styles/{base.css, theme.css}
│  └─ shared/
│     ├─ types.ts          # §4
│     ├─ ipcChannels.ts    # §5
│     ├─ layout.ts         # §4.3 슬롯 계산 순수 함수
│     ├─ tree.ts           # 계층 탐색·이동·복제 순수 함수
│     ├─ hintMap.ts        # §6.11-A 힌트 문자 배정 순수 함수
│     ├─ accelerator.ts    # CommandOrControl ↔ 화면 표기 변환 (§6.8)
│     ├─ search.ts         # §6.12 퀵 런처 검색·랭킹·한글 초성 순수 함수
│     └─ defaults.ts
├─ tests/{layout.test.ts, tree.test.ts, hintMap.test.ts, accelerator.test.ts,
│         search.test.ts, validate.test.ts, store-migration.test.ts,
│         appScanner.test.ts, browserFlags.test.ts, launcher.test.ts,
│         dropClassify.test.ts}
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ package.json
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
├─ .eslintrc.cjs / .prettierrc / .gitignore
├─ LICENSE                 # MIT
└─ README.md               # 한국어
```

---

## 12. 빌드 · CI · 릴리즈

### 12.1 `package.json` 스크립트

```json
{
  "name": "stream-panel",
  "productName": "Stream Panel",
  "version": "1.0.0",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "npm run typecheck && electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "lint": "eslint . --ext .ts,.tsx",
    "test": "vitest run",
    "build:win": "npm run build && electron-builder --win --publish never",
    "build:mac": "npm run build && electron-builder --mac --publish never",
    "release:win": "npm run build && electron-builder --win --publish always",
    "release:mac": "npm run build && electron-builder --mac --publish always"
  }
}
```

### 12.2 `electron-builder.yml`

```yaml
appId: com.deepsky616.streampanel
productName: Stream Panel
copyright: Copyright © 2026 deepsky616
directories:
  output: dist
  buildResources: build
files:
  - out/**
  - resources/**
  - package.json
asar: true
win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico
  artifactName: StreamPanel-${version}-Setup.${ext}
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  icon: build/icon.icns
  category: public.app-category.productivity
  artifactName: StreamPanel-${version}-${arch}.${ext}
  darkModeSupport: true
  # 서명하지 않는다 (§10.1). 공증도 하지 않는다.
  identity: null
  extendInfo:
    LSUIElement: true          # Dock 아이콘 숨김 — 트레이 상주 앱 (§6.5)
dmg:
  title: Stream Panel ${version}
  contents:
    - x: 140
      y: 180
      type: file
    - x: 400
      y: 180
      type: link
      path: /Applications
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  allowElevation: false
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Stream Panel
  deleteAppDataOnUninstall: false
  installerLanguages: [ko-KR, en-US]
  language: "1042"
publish:
  provider: github
  owner: deepsky616
  repo: stream-panel
  releaseType: release
```

> `releaseType: release`로 두면 릴리즈가 초안이 아닌 정식으로 게시되어 `electron-updater`가
> 바로 인식한다. **초안(draft) 상태에서는 자동 업데이트가 동작하지 않는다.**

### 12.3 `.github/workflows/ci.yml`

트리거: `push`(main), `pull_request`.
**매트릭스로 `windows-latest`와 `macos-latest` 양쪽에서 돌린다.**
Node 22, `npm ci` → `lint` → `typecheck` → `test` → 각 OS의 `build:*`.

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: windows-latest
        build: npm run build:win
      - os: macos-latest
        build: npm run build:mac
```

`fail-fast: false`로 두어 한쪽이 깨져도 다른 쪽 결과를 볼 수 있게 한다.

### 12.4 `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify tag matches package.json version
        shell: bash
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          PKG=$(node -p "require('./package.json').version")
          if [ "$TAG" != "$PKG" ]; then
            echo "::error::Tag v$TAG != package.json $PKG"
            exit 1
          fi

  build:
    needs: verify
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            script: release:win
          - os: macos-latest
            script: release:mac
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - name: Build and publish
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'   # macOS 자동 서명 탐색 비활성화 (§10.1)
        run: npm run ${{ matrix.script }}
```

- **버전 검증을 별도 `verify` 잡으로 분리**한다. 두 OS 잡이 각각 검증하면 중복이고,
  실패 원인이 어느 잡인지 헷갈린다.
- `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`가 없으면 electron-builder가 macOS 러너에서
  서명 인증서를 찾다가 실패하며 빌드가 깨진다. **반드시 넣는다.**
- 두 잡이 같은 릴리즈에 순서 없이 업로드한다. electron-builder가 이미 존재하는 릴리즈에
  에셋을 추가하므로 충돌하지 않는다.
- **태그와 `package.json` 버전이 다르면 즉시 실패시킨다.** 두 값이 어긋나면
  Windows 자동 업데이트가 조용히 망가진다.

### 12.5 릴리즈 산출물

```
StreamPanel-1.0.0-Setup.exe          # Windows NSIS 인스톨러
StreamPanel-1.0.0-Setup.exe.blockmap
latest.yml                            # Windows 자동 업데이트 메타데이터 — 반드시 포함
StreamPanel-1.0.0-arm64.dmg           # macOS Apple Silicon
StreamPanel-1.0.0-x64.dmg             # macOS Intel
```

`latest-mac.yml`이 생성되더라도 macOS 자동 업데이트는 쓰지 않으므로 무시한다 (§10.1).

---

## 13. README 필수 내용 (한국어)

1. 패널 + 편집기 스크린샷 각 1장
2. **설치 방법 — Windows**
   - Releases에서 `StreamPanel-x.y.z-Setup.exe` 다운로드 → 실행
   - **SmartScreen 경고 안내:** "Windows에서 PC를 보호했습니다" 화면이 나오면
     `추가 정보` → `실행`. 코드 서명 인증서를 구매하지 않은 오픈소스 앱이라 나타나는
     정상적인 경고임을 설명한다. **(이 문구를 빠뜨리면 사용자가 설치를 포기한다)**
2-1. **설치 방법 — macOS**
   - 칩에 맞는 파일을 받는다: Apple Silicon(M1~) → `-arm64.dmg`, Intel → `-x64.dmg`
     (`Apple 메뉴 → 이 Mac에 관하여`에서 확인하는 법을 함께 적는다)
   - DMG를 열고 앱을 `Applications` 폴더로 끌어다 놓는다
   - **Gatekeeper 허용 절차 (반드시 스크린샷과 함께):**
     1. 앱을 처음 실행하면 "개발자를 확인할 수 없기 때문에 열 수 없습니다"가 뜬다. `완료`를 누른다
     2. `시스템 설정` → `개인정보 보호 및 보안`으로 간다
     3. 아래로 스크롤하면 "\"Stream Panel\"이(가) 차단되었습니다"가 보인다. `그대로 열기`를 누른다
     4. 확인 창에서 다시 `그대로 열기` → 이후로는 정상 실행된다
   - 코드 서명 인증서(연 $99)를 구매하지 않은 오픈소스 앱이라 나타나는 정상 절차임을 설명한다
   - **macOS는 자동 업데이트를 지원하지 않는다**는 점과, 새 버전 알림이 뜨면
     릴리즈 페이지에서 직접 받아야 한다는 점을 명시한다 (§10.1)
   - Dock에 아이콘이 나타나지 않고 **메뉴 막대에만 상주**한다는 점을 안내한다
3. 사용법 — 스트림덱 흐름 그대로:
   오른쪽 액션 목록에서 키로 끌어다 놓기 → 이름·아이콘 지정 → 폴더로 묶기 → 패널에서 클릭
4. **"마우스 없이 쓰기"** 절 (§6.11, §6.12) — **README에서 가장 앞에 오는 사용법**
   - **`Alt+Shift+1`~`0`으로 어디서든 바로 실행** (기본 켜져 있음). 자주 쓰는 항목을
     맨 앞 페이지 앞쪽에 두라는 안내
   - **`Ctrl+Alt+Space` 퀵 런처** — 이름 검색, **한글 초성(`ㄱㅂ` → 개발)** 지원.
     GIF로 보여준다
   - 패널을 띄웠을 때의 번호 배지, 폴더 연쇄 입력(`3` → `2`), `Shift`+숫자로 연달아 실행
   - 자주 쓰는 키에 전역 단축키를 지정하는 법, 수식키가 왜 필수인지
   - 단축키 전체 표 (Windows / macOS 병기)
   - 트레이 메뉴 설명
5. **"패널이 화면을 가리지 않게 하는 방법"** 절 (§6.10)
   - 기본 동작: 키를 누르면 패널이 자동으로 사라지고, 화면 오른쪽 끝에 마우스를 대면 다시 나온다
   - `Shift`+클릭으로 여러 개를 연달아 실행하는 법
   - 설정 `동작` 탭에서 세 정책을 각각 끄고 켜는 법 (GIF 또는 스크린샷 권장)
6. 설정 파일 위치 (`%APPDATA%\stream-panel\config.json`) 및 백업 방법
7. 개발 방법: `npm install` → `npm run dev`
   - `npm run build:win` / `npm run build:mac`으로 각 OS 산출물을 만든다
   - **크로스 빌드는 불가능하다.** Windows 인스톨러는 Windows에서, macOS DMG는
     macOS에서만 만들어진다. CI 매트릭스가 이를 대신한다는 점을 명시
8. 라이선스 (MIT)

---

## 14. 테스트 전략

**단위 테스트 (Vitest, Electron 없이 실행 가능한 순수 모듈만):**

- `layout.test.ts` — §4.3 슬롯 계산. 폴더 내부의 뒤로 키 예약 오프셋, 페이지 수 계산,
  빈 칸 유지, 마지막 빈 페이지 제거, 손상된 position 정규화
- `tree.test.ts` — 경로 탐색, 이동·교환, 폴더 안으로 이동, **순환 참조 거부**,
  깊이 5 초과 거부, 깊은 복사 시 새 id 발급
- `hintMap.test.ts` — §6.11-A 힌트 배정. **빈 슬롯을 건너뛰고 보이는 순서대로 배정**,
  페이지·폴더 전환 시 1번부터 재배정, `↩ 뒤로` 키는 힌트를 받지 않음,
  40개 초과분은 힌트 없음, 사용자 지정 `hintKeys`의 중복 문자 거부
- `validate.test.ts` — URL 프로토콜 화이트리스트, `javascript:`/`file:` 차단,
  경로 traversal 차단, 라벨/args 길이 제한, 색상 정규식, 항목 수 상한,
  **전역 단축키 규칙**(수식키 없음 거부, `Shift` 단독 조합 거부, 중복 거부, 20개 상한)
- `store-migration.test.ts` — 기본값 생성, 미래 버전 감지 시 백업+초기화, 손상된 JSON 복구
- `appScanner.test.ts` — **양쪽 플랫폼 구현을 한 머신에서 모두 테스트한다** (§6.0의 주입 구조).
  - Windows: `.lnk` 필터링 규칙(제거 프로그램/문서 링크 배제), `Get-StartApps` JSON 파싱,
    `!` 없는 AppID 제외, 이름 기준 중복 제거
  - macOS: `.app` 번들 판별, `.app` 내부로 재귀하지 않음, 깊이 2단계 제한,
    `Info.plist`의 `CFBundleDisplayName` → `CFBundleName` → 파일명 폴백,
    바이너리 plist 파싱 실패 시 파일명 폴백
- `accelerator.test.ts` — `CommandOrControl+Alt+D`가 Windows에서 `Ctrl+Alt+D`,
  macOS에서 `⌘⌥D`로 표시되는지. 저장 형식은 항상 `CommandOrControl`임을 검증
- `search.test.ts` — §6.12 퀵 런처 검색. **이 앱에서 가장 촘촘히 테스트해야 할 파일이다.**
  - `FolderItem`이 결과에 포함되지 않음
  - 트리 전체 평탄화 — 깊이 3의 항목도 한 번에 검색됨
  - 랭킹 순서 7단계가 명세대로인지 (접두사 > 단어시작 > 초성 > 이니셜 > 부분 > 경로 > target)
  - **한글 초성**: `ㄱㅂ` → "개발", `ㅁㅅ` → "문서", `ㅋㄷ` → "코드"
  - 초성 계산이 겹받침·쌍자음에서도 정확한지 (`ㄲ`, `ㅆ`, `ㅃ` 등)
  - 한글이 아닌 문자가 섞여도 크래시하지 않음
  - 영문 이니셜: `vsc` → "Visual Studio Code"
  - 공백 AND 조건: "개발 문서" → 둘 다 포함하는 항목만
  - 대소문자 무시
  - 동점 시 root 근접 순 → `position` 오름차순
  - `matchRanges`가 실제 일치 구간을 정확히 가리키는지
  - 빈 검색어면 root 첫 페이지 1~10번을 그 순서대로 반환 (§6.11-C와 번호 일치)
  - 결과 8개 상한
- `launcher.test.ts` — 타입별로 올바른 함수가 호출되는지 (`shell`/`child_process` 모킹),
  **`shell: true`가 절대 쓰이지 않음을 검증**, 존재하지 않는 경로에서 `NOT_FOUND` 반환,
  `FolderItem`은 실행되지 않음,
  **macOS `app` 분기**: `args`가 비면 `openPath`, 있으면 `open -a … --args`,
  **macOS에서 `uwp` 타입은 `BLOCKED` 반환**
- `browserFlags.test.ts` — §6.13.3 플래그 생성 (`browserService/flags.ts`).
  - `appMode: true` → `['--app=<url>']` 이고 **URL이 위치 인자로 중복되지 않음**
  - `appMode: false` → `[<url>]`
  - `profileDir` 지정 시 `--profile-directory=` 가 앞에 붙음
  - firefox / safari 는 플래그 없이 `[<url>]`만
  - `profileDir`에 `../`, `/`, `\` 가 들어오면 거부
  - `Local State` JSON 파싱: `profile.info_cache` → `BrowserProfile[]`,
    파일이 없거나 손상됐을 때 빈 배열 반환 (throw 금지)
- `dropClassify.test.ts` — 디렉터리/파일/exe/lnk/URL/이미지 분류, 라벨 자동 생성
- `webWorkflows.test.ts` — 교육청별 업무 주소, 업무 종류별 허용 주소, 브라우저 제한,
  잘못된 업무 종류 거부와 교육청 변경 때 키 참조 보존
- `webConnectorBrowserProcess.test.ts` — 교육청·브라우저별 전용 프로필, 알려진 실행 파일만 허용,
  고정 안전 인자, 파이프 우선과 무작위 포트 한 번 예비 연결, 소유 프로세스만 종료
- `webConnectorCdp.test.ts` — 널 종료 파이프 메시지, 고정 개발 도구 명령 허용 목록,
  브라우저 식별, 정확한 전용 프로필의 활성 포트만 사용, 한 번만 예비 연결
- `webConnectorState.test.ts` / `webConnectorDiagnostics.test.ts` — 민감 정보 없는 성공 시각 상태,
  진단 폴더 경계, 전체 주소와 사용자 자료를 기록하지 않음
- `webConnectorSessionManager.test.ts` — 같은 교육청·브라우저 직렬 실행과 세션 재사용,
  다른 교육청·브라우저 분리, 소유 세션만 종료
- `webConnectorService.test.ts` / `webConnectorHandlers.test.ts` — 기존 IPC 입력·출력 호환,
  상태 계산, 즉시 접수와 나중 알림, 개인 브라우저 우회 금지, 진단 폴더만 열기
- `webWorkflowDefinitions.test.ts` / `webWorkflowEngine.test.ts` — 고정 네 업무와 사용자 지정 단계 변환,
  다음 메뉴·도착 문구 확인, 숨김·비활성·중복 요소 제외, 위험 단추를 절대 선택하지 않음
- `webConnectorPlatform.test.ts` — 허용 탭과 주소 재검증, 로그인 포털 중단,
  `WXSClient` 확인과 새 창만 활성화, macOS 안전 기본값
- `approvalMonitor.test.ts` — 기본 꺼짐, 설정 이전, 근무 시간, 증가 알림, 연결 변경 기준값,
  연결 식별값·수량·시각 외 문서 자료를 저장하지 않음, macOS에서 확인 작업을 시작하지 않음
- `approvalMonitorWindows.test.ts` / `approvalMonitorHandlers.test.ts` — 결재함 주소 재검증,
  안전한 정수 수량만 허용, 로그인 포털에서 읽기 중단, 고정 통신 입력 검증
- `approvalMonitorUi.test.ts` — Windows 웹 업무 설정 배치, 나이스·에듀파인 결재함 키,
  시스템별 대기 수 배지와 사용자 처리 안전 안내
- `multiAction.test.ts` — 순차 실행, 기다리기 순서, 실패 즉시 중단, 중복 실행 거부,
  취소 뒤 재실행, 최대 단계·전체 기다리기 제한, 없는 키와 중첩 멀티 액션 참조 거부

**수동 QA 체크리스트 (Windows 실기, §15).** E2E 자동화는 v1.0 범위 밖.

### 14.1 플랫폼 안전성 (중요)

개발 머신은 macOS이고 배포 대상은 Windows·macOS 둘 다다.
**어느 플랫폼에서도 `npm run dev`가 크래시 없이 실행되어야 한다.**

**플랫폼 전용 API 목록 — 반드시 §6.0 구조로 격리한다**

| API | 지원 | 잘못 부르면 |
|---|---|---|
| `shell.readShortcutLink` | Windows 전용 | macOS에서 **throw**. 가드 없이 부르면 앱이 죽는다 |
| `Get-StartApps` (PowerShell) | Windows 전용 | macOS에 명령이 없음. try/catch로 빈 배열 |
| `plutil` | macOS 전용 | Windows에 명령이 없음. try/catch로 파일명 폴백 |
| `app.dock.hide()` | macOS 전용 | Windows에서 `app.dock`이 `undefined`. **옵셔널 체이닝 필수** |
| `spawn('open', …)` | macOS 전용 | Windows에는 `open` 명령이 없다 |
| `spawn('explorer.exe', …)` | Windows 전용 | macOS에 없다 |
| `app.getFileIcon` | 양쪽 지원 | 그대로 쓴다 |
| `globalShortcut` | 양쪽 지원 | accelerator만 `CommandOrControl`로 통일 |
| `setIgnoreMouseEvents({forward})` | 양쪽 지원 | 그대로 쓴다 |

**공통 규칙**

- `%APPDATA%`, `/Applications` 같은 경로를 코드에 흩뿌리지 않는다.
  `app.getPath()` 또는 `platform/index.ts`의 상수만 쓴다.
- 경로 조합은 항상 `path.join`. `\\`나 `/` 리터럴 금지
  (`shell:AppsFolder\\` 같은 Windows 고유 문자열은 `windows.ts` 안에서만 허용).
- 모든 스캐너·런처·업데이터는 `platform` 인자를 주입 가능하게 만들어,
  **한 머신에서 양쪽 구현의 순수 로직을 모두 테스트**할 수 있게 한다.
- 지원하지 않는 플랫폼에서는 throw 대신 안전한 기본값(빈 배열, `BLOCKED` 결과)을 반환한다.

---

## 15. 실기 QA 체크리스트

**§15.1 ~ §15.5는 Windows·macOS 양쪽에서 각각 수행한다.**
§15.6은 Windows 전용, §15.7은 macOS 전용이다.

### 15.1 설치 · 패널

- [ ] 설치 파일 실행 → 설치 완료 → 자동 실행
- [ ] 패널이 화면 우상단에 뜨고 항상 최상위로 유지된다 (다른 창을 최대화해도 가려지지 않음)
- [ ] 타이틀바 드래그로 이동, 재시작 후 위치 유지
- [ ] 작업표시줄(Win) / Dock(mac)에 아이콘이 없고, 트레이 / 메뉴 막대에 아이콘이 있다
- [ ] `Ctrl+Alt+D`(Win) / `⌘⌥D`(mac)로 숨김/표시 토글
- [ ] 잠금 토글 시 이동·재배치·`+`가 모두 비활성화된다

### 15.2 화면 가림 방지 (§6.10)
- [ ] 링크 키를 누르면 브라우저가 열리고 **패널이 사라져 화면을 가리지 않는다**
- [ ] 폴더·파일·앱 키도 동일하게 실행 후 패널이 사라진다
- [ ] 폴더 키(계층 진입)를 눌렀을 때는 패널이 사라지지 않는다
- [ ] 실행이 실패했을 때(경로 없음)는 패널이 남고 오류 토스트가 보인다
- [ ] `Shift`+클릭하면 실행되지만 패널이 유지된다
- [ ] 패널이 숨겨진 뒤 화면 오른쪽 가장자리에 얇은 띠가 보인다
- [ ] 그 띠에 마우스를 올리고 잠깐 기다리면 패널이 다시 나온다
- [ ] 마우스로 가장자리를 빠르게 스쳐 지나가면 패널이 튀어나오지 않는다
- [ ] 패널이 보이는 동안에는 가장자리 띠가 보이지 않는다
- [ ] 가장자리 띠가 다른 앱의 포커스를 빼앗지 않는다 (타이핑 중 커서가 유지된다)
- [ ] 패널을 화면 왼쪽으로 옮긴 뒤 숨기면 띠가 왼쪽 가장자리에 생긴다
- [ ] 편집기 창이 열려 있는 동안에는 키를 눌러도 패널이 사라지지 않는다
- [ ] `가만히 두면 흐려지기`를 켜면 4초 뒤 흐려지고, **그 상태에서 패널 위를 클릭하면
      뒤에 있는 창이 클릭된다**
- [ ] 흐려진 패널 위로 마우스를 옮기면 즉시 선명해지고 다시 클릭할 수 있다
- [ ] 설정에서 `실행 후 패널 숨기기`를 끄면 이전처럼 패널이 계속 떠 있는다

### 15.3 키보드 실행 (§6.11, §6.12)

**전역 실행 — 이게 주 사용 경로다. 마우스를 한 번도 쓰지 않고 통과해야 한다**
- [ ] 앱을 켜둔 채 **바탕화면에서** `Alt+Shift+1`(mac `⌃⌥1`)을 누르면 1번 키가 실행된다
- [ ] **다른 앱 창(브라우저·메모장)에서** 눌러도 똑같이 실행된다
- [ ] **탐색기/Finder 창에서** 눌러도 똑같이 실행된다
- [ ] 패널이 숨겨져 있어도 실행된다. 패널이 뜨지 않는다
- [ ] 설정의 미리보기 목록에 1~10번이 무엇인지 표시되고 실제 실행 결과와 일치한다
- [ ] 빈 슬롯이나 폴더 키에 해당하는 번호를 눌러도 아무 일도 일어나지 않는다 (오류·소리 없음)
- [ ] 등록에 실패한 번호가 설정 화면에 빨간 글씨로 표시된다

**퀵 런처 (§6.12)**
- [ ] 어느 앱에서든 `Ctrl+Alt+Space`(mac `⌘⌥Space`)를 누르면 화면 중앙에 런처가 뜬다
- [ ] **런처가 즉시 키보드 포커스를 받아 바로 타이핑할 수 있다** (클릭 불필요)
- [ ] 검색어가 빈 상태에서 1~10번이 보이고, 그 번호가 전역 숫자 단축키와 **동일하다**
- [ ] 검색어가 빈 상태에서 숫자를 누르면 즉시 실행된다
- [ ] 타이핑을 시작하면 숫자가 검색어로 들어간다 ("1password"를 검색할 수 있다)
- [ ] **한글 초성 검색이 된다** — `ㄱㅂ`으로 "개발"이 찾아진다
- [ ] 폴더 안쪽 깊은 곳의 키도 한 번의 검색으로 찾아진다
- [ ] 결과에 폴더는 나오지 않고, 대신 상위 경로가 오른쪽에 회색으로 표시된다
- [ ] 일치 구간이 굵게 강조된다
- [ ] ↑/↓로 선택하고 `Enter`로 실행하면 런처가 즉시 닫힌다
- [ ] `Esc`로 닫힌다
- [ ] 다른 곳을 클릭하면(포커스 상실) 자동으로 닫힌다
- [ ] 다시 열면 이전 검색어가 남아 있지 않다
- [ ] 결과가 없으면 "일치하는 항목이 없습니다"가 표시된다
- [ ] 타이핑에 체감 지연이 없다

**패널에서의 힌트 (§6.11-A)**
- [ ] 패널 토글 단축키로 패널을 부르면 패널이 **포커스를 받고** 각 키에 번호 배지가 나타난다
- [ ] 포커스 확보에 실패하면 배지가 회색으로 바뀌고 안내 문구가 표시된다
      (조용히 안 먹히는 상태가 없어야 한다)
- [ ] 다른 앱에서 작업하다가 불러도 포커스를 정상적으로 가져온다 (포그라운드 락 미발생)
- [ ] `1`을 누르면 1번 키가 실행되고 패널이 사라진다
- [ ] 중간 슬롯이 비어 있어도 **눈에 보이는 순서대로** 1, 2, 3 번호가 매겨진다
- [ ] 폴더 키의 번호를 누르면 실행이 아니라 폴더로 진입하고, 안쪽 키가 1번부터 다시 매겨진다
- [ ] `3` → `2` 처럼 연달아 눌러 폴더 안의 키를 실행할 수 있다
- [ ] 폴더 안에서 `Backspace`로 상위로 돌아간다
- [ ] `Shift`+숫자로 실행하면 패널이 유지되어 연달아 실행할 수 있다
- [ ] `Esc`로 패널이 닫힌다
- [ ] 키가 10개를 넘으면 `q`, `w`, `e`... 로 힌트가 이어진다
- [ ] 페이지를 넘기면 번호가 1부터 다시 매겨진다
- [ ] 패널이 포커스를 잃으면 배지가 사라진다 (지금 키 입력이 안 되는 상태임을 알 수 있다)
- [ ] 힌트 표시를 `숨김`으로 바꿔도 숫자 키 입력은 그대로 동작한다
- [ ] 편집기 창에서 제목을 입력할 때 숫자를 쳐도 키가 실행되지 않는다
- [ ] **한글 입력기가 켜진 상태에서도 숫자 힌트가 정상 동작한다** (`event.code` 기반)
- [ ] 단축키 표기가 OS에 맞게 보인다 (Windows `Ctrl+Alt+D` / macOS `⌘⌥D`)
- [ ] 키에 전역 단축키를 지정하면 다른 앱에서 눌러도 실행된다 (패널이 뜨지 않음)
- [ ] 수식키 없는 단일 키(`G`)를 지정하려 하면 거부되고 이유가 표시된다
- [ ] 다른 프로그램이 쓰는 단축키를 지정하면 "이미 사용 중" 오류가 뜬다
- [ ] 설정 `단축키` 탭에 등록된 전역 단축키 목록이 표로 보이고 개별 해제가 된다
- [ ] 전역 단축키가 지정된 키를 삭제하면 단축키도 함께 해제된다
- [ ] 앱을 완전히 종료하면 모든 전역 단축키가 해제되어 다른 앱에서 그 조합을 쓸 수 있다
      (패널 토글 · 퀵 런처 · 숫자 10개 · 키별 단축키 전부)

### 15.4 편집기 · 드래그 앤 드롭 (스트림덱 흐름)
- [ ] `⚙` 또는 트레이에서 편집기가 열린다
- [ ] 오른쪽 `🔗 웹사이트`를 왼쪽 키로 끌어다 놓으면 키가 생기고 주소 입력에 포커스가 간다
- [ ] `설치된 앱` 목록에서 앱을 끌어다 놓으면 이름·아이콘이 자동으로 채워져 바로 완성된다
- [ ] 설치된 앱 목록에 한글 이름이 깨지지 않고, 불필요한 항목이 섞여 있지 않다
      (Win: 제거 프로그램·설명서 링크 / mac: `.app` 내부의 중첩 번들)
- [ ] `🗂️ 폴더 만들기`를 놓으면 폴더 키가 생긴다
- [ ] 키를 폴더 키 위로 500ms 끌면 폴더가 열리고 그 안에 놓을 수 있다
- [ ] 폴더에 들어가면 0번 슬롯이 `↩ 뒤로`이고, 눌러서 상위로 돌아온다
- [ ] 키를 다른 키 위로 끌면 위치가 교환된다
- [ ] 키를 휴지통으로 끌면 삭제된다 (폴더는 확인 다이얼로그)
- [ ] 파일 탐색기(Win) / Finder(mac)에서 폴더를 그리드로 끌어다 놓으면 폴더 키가 생성된다
- [ ] **macOS: Finder에서 `.app`을 끌어다 놓으면 폴더가 아니라 앱 키가 생성된다**
- [ ] 브라우저 주소창에서 URL을 끌어다 놓으면 웹사이트 키가 생성된다
- [ ] 이미지 파일을 기존 키 위에 떨어뜨리면 아이콘이 교체된다 (새 키가 생기지 않음)
- [ ] 우클릭 → 복사 / 잘라내기 / 붙여넣기 / 복제 / 삭제가 모두 동작한다

### 15.5 실행
- [ ] URL 키 → 기본 브라우저에서 열리고 파비콘이 표시된다

**브라우저 지정 (§6.13)**
- [ ] `열 브라우저` 드롭다운에 설치된 브라우저가 아이콘과 함께 나온다
- [ ] Chrome을 지정하면 기본 브라우저가 아니어도 **Chrome에서 열린다**
- [ ] `프로필`에서 업무용을 고르면 그 프로필 창에서 열린다 (로그인 세션이 유지된다)
- [ ] `전용 창으로 열기`를 켜면 **주소창과 탭이 없는 창**이 뜬다
- [ ] 전용 창 모드에서 창이 **하나만** 열린다 (URL 중복 전달 없음)
- [ ] Firefox·Safari를 고르면 프로필·전용 창 옵션이 비활성화되고 안내가 뜬다
- [ ] 지정한 브라우저를 제거한 뒤 키를 눌러도 **기본 브라우저로 열리고** 토스트가 뜬다
      (링크가 안 열리는 일은 없어야 한다)
- [ ] 브라우저를 지정하지 않은 기존 키는 그대로 기본 브라우저로 열린다
- [ ] 폴더 키(액션) → 탐색기(Win) / Finder(mac)에서 열린다
- [ ] 앱 키 → 해당 앱이 뜨고 아이콘이 추출된다
      (Win: exe 아이콘 / mac: `.app` 번들 아이콘)
- [ ] 삭제된 폴더를 가리키는 키를 눌러도 한국어 오류 토스트만 뜨고 앱이 죽지 않는다
- [ ] 패널 빈 칸 `+`를 누르면 편집기가 열리며 그 슬롯이 선택된다

**설정 · 안정성**
- [ ] 그리드 5×3 → 4×2로 줄여도 **항목이 삭제되지 않고** 다음 페이지로 넘어간다
- [ ] 투명도·테마·버튼 크기가 실시간 반영된다
- [ ] 로그인 시 자동 시작 켜고 재부팅 → 트레이 / 메뉴 막대에 상주한 채 시작된다
- [ ] 모니터 해상도/개수를 바꿔도 패널이 화면 밖으로 사라지지 않는다
- [ ] 트레이 → 종료로 완전히 종료된다 (프로세스가 남지 않는다)
- [ ] 네트워크를 끊어도 앱이 정상 동작한다 (파비콘만 글자 아이콘으로 폴백)
- [ ] OS 다크/라이트 모드를 전환하면 테마가 따라간다 (`theme: 'system'`)

### 15.6 Windows 전용
- [ ] 설치 시 설치 경로를 변경할 수 있고 UAC 프롬프트가 뜨지 않는다
- [ ] SmartScreen 경고에서 `추가 정보` → `실행`으로 설치가 진행된다
- [ ] Microsoft Store 앱(예: 계산기)이 목록에 있고 실행된다
- [ ] 제거 후 재설치 시 설정이 유지된다 (`deleteAppDataOnUninstall: false`)
- [ ] v1.0.1 태그 푸시 → 릴리즈 생성 → 기존 v1.0.0 설치본이 **자동 업데이트를 감지하고 적용한다**
- [ ] 작업 관리자에 프로세스가 남지 않는다

**나이스와 에듀파인 업무용 브라우저 (§6.14)**
- [ ] 설정에 17개 소속 교육청과 업무용 엣지·크롬 카드가 보이며 엣지에 추천 표시가 있다
- [ ] 교육청을 바꾸면 기존 웹 업무 키 주소만 바뀌고 키 식별자와 멀티 액션 참조는 유지된다
- [ ] 업무용 브라우저 열기는 개인 브라우저와 분리된 창을 열고 교육청별 로그인 상태를 유지한다
- [ ] 연결 시험 뒤 해당 카드가 `준비됨`으로 바뀐다
- [ ] 나이스 복무와 출장 키가 정확한 작성 화면까지 이동한 뒤 멈춘다
- [ ] 에듀파인 기안과 품의 키가 정확한 작성 화면까지 이동한 뒤 멈춘다
- [ ] 나이스와 에듀파인 사용자 지정 키를 1~8단계로 만들고 루트 첫 빈 위치에 추가할 수 있다
- [ ] 사용자 지정 키가 단계마다 다음 메뉴와 마지막 도착 문구를 확인하고, 찾지 못하면 멈춘다
- [ ] 위험 동작 문구, 임의 주소, 선택자와 스크립트를 사용자 지정 단계에 저장할 수 없다
- [ ] 에듀파인 기안은 새로 열린 `WXSClient` 창만 앞으로 가져온다
- [ ] 로그인과 인증서 입력, 외부 보안 프로그램 확인은 사용자가 직접 한다
- [ ] 메뉴가 없거나 같은 이름 후보가 둘 이상이면 누르지 않고 직접 계속할 방법을 안내한다
- [ ] 저장·제출·상신·승인·결재와 확인 단추를 자동으로 누르지 않는다
- [ ] 실패해도 개인 브라우저로 우회하지 않고 원인과 해결 방법을 알린다
- [ ] 교육청을 바꾸면 이전 교육청의 업무용 브라우저 세션만 닫힌다
- [ ] 스트림 패널 종료 때 업무용 브라우저는 닫히고 사용자가 연 개인 브라우저는 남는다
- [ ] 문제 해결 폴더에는 전체 주소, 화면 내용, 암호와 인증서 자료가 기록되지 않는다
- [ ] 업무 알림은 처음에는 꺼져 있고 나이스와 에듀파인을 각각 켤 수 있다
- [ ] 지금 확인 뒤 시스템별 결재 대기 수와 마지막 확인 상태가 보인다
- [ ] 결재함 키를 추가하면 루트 첫 빈 위치에 생기고 해당 시스템 대기 수 배지가 표시된다
- [ ] 앱 재시작, 교육청 변경과 브라우저 변경 직후 첫 확인에서는 증가 알림이 울리지 않는다
- [ ] 같은 연결에서 대기 수가 늘면 윈도우 알림이 한 번 나타난다
- [ ] 로그인 만료 때 인증 정보를 대신 입력하지 않고 로그인 필요 원인과 해결 방법을 표시한다
- [ ] 결재함까지만 열고 대기 문서 항목, 승인, 반려, 서명과 결재 처리 단추는 누르지 않는다
- [ ] 상태 파일에는 교육청, 업무용 브라우저, 수량과 시각만 있고 문서 제목, 작성자, 본문, 쿠키와 인증 자료가 없다
- [ ] 실제 기관 계정과 인증서 환경에서 위 항목을 확인하기 전에는 실기 완료로 표시하지 않는다

### 15.7 macOS 전용
- [ ] 칩에 맞는 DMG(`arm64` / `x64`)가 릴리즈에 둘 다 올라와 있다
- [ ] DMG를 열면 앱 아이콘과 `Applications` 폴더 별칭이 나란히 보인다
- [ ] **README의 Gatekeeper 절차대로 시스템 설정 → 개인정보 보호 및 보안 →
      `그대로 열기`를 누르면 정상 실행된다**
- [ ] 한 번 허용한 뒤로는 경고 없이 실행된다
- [ ] **Dock에 아이콘이 나타나지 않고 메뉴 막대에만 상주한다** (`LSUIElement`)
- [ ] 메뉴 막대 아이콘이 **다크/라이트 모드에서 모두 보인다** (템플릿 이미지)
- [ ] 패널이 **메뉴 막대와 Dock을 덮지 않는다** (`workArea` 기준 배치)
- [ ] 패널이 시스템 UI(Mission Control, 알림 센터) 위로 올라오지 않는다 (`'floating'` 레벨)
- [ ] 다른 Space로 전환해도 패널이 따라온다 (`setVisibleOnAllWorkspaces`)
- [ ] 전체 화면 앱 위에서도 패널을 부를 수 있다
- [ ] 다른 앱에서 작업하다 단축키로 패널을 불러도 **키보드 포커스를 가져온다**
      (`app.focus({steal:true})`가 동작한다)
- [ ] `/Applications`와 `~/Applications`의 앱이 모두 목록에 나온다
- [ ] `Utilities` 하위 앱(예: 터미널, 디스크 유틸리티)이 목록에 나온다
- [ ] 한글 이름 앱(예: `계산기`)이 깨지지 않고 표시된다
- [ ] 인자가 있는 앱 키가 `open -a … --args`로 정상 실행된다
- [ ] 새 버전이 있으면 알림이 뜨고 `릴리즈 페이지 열기`가 브라우저를 연다
      (**자동 업데이트는 시도조차 하지 않는다**)
- [ ] 설정 `정보` 탭에 "macOS에서는 자동 업데이트를 지원하지 않습니다" 안내가 보인다
- [ ] Windows에서 만든 `config.json`을 가져오면 경로 키에 경고 배지가 뜨고 앱이 죽지 않는다

---

## 16. 구현 순서 (마일스톤)

각 마일스톤은 독립 커밋으로 끝낸다. 수용 기준을 모두 만족해야 다음으로 넘어간다.

### M0 — 스캐폴드 (양쪽 플랫폼)
저장소 초기화, electron-vite + React + TS (엔트리 2개: 패널·편집기), ESLint/Prettier,
Vitest, `ci.yml`(**windows-latest + macos-latest 매트릭스**), MIT LICENSE, `.gitignore`,
`main/platform/index.ts` 골격.
**수용 기준:** `npm run dev`로 빈 프레임리스 창이 뜬다. `npm run build`, `npm test` 통과.
**CI가 양쪽 OS에서 모두 초록불이어야 한다.**

### M1 — 데이터 모델 + 슬롯 레이아웃 + 힌트 배정 (순수 로직 먼저)
`shared/types.ts`, `shared/layout.ts`, `shared/tree.ts`, `shared/hintMap.ts`,
`shared/accelerator.ts`, `shared/search.ts`(§6.12 검색·랭킹·한글 초성),
`shared/defaults.ts`(플랫폼별 기본값 §4.5),
`store.ts`(마이그레이션 + position 정규화 + `config.platform` 처리 §4.6).
**수용 기준:** `layout.test.ts`, `tree.test.ts`, `hintMap.test.ts`,
`accelerator.test.ts`, `search.test.ts`, `store-migration.test.ts` 전부 통과.
UI 없이 순수 함수만으로 폴더 중첩·페이지네이션·이동·교환·순환 거부·힌트 배정·
단축키 표기 변환·**한글 초성 검색과 7단계 랭킹**이 검증된다.

### M2 — 패널 창 + 플랫폼 상수
`main/platform/index.ts` 완성(창 레벨·트레이 에셋·숨김 시작 판별 §6.0),
`panelWindow.ts`(Windows `skipTaskbar` / macOS `dock.hide()` + `'floating'` 레벨),
preload, `config:get`/`config:set`, 창 크기 자동 계산,
위치 저장/복원 및 화면 밖 보정(**`workArea` 기준**), `KeyTile`/`BackTile`/`EmptyTile`,
폴더 진입·복귀, 페이지 도트, 브레드크럼.
**수용 기준:** config.json을 직접 편집하면 패널이 그대로 반영한다. 폴더에 들어가고 나올 수 있다.
창을 옮기고 재시작하면 위치가 복원된다. **macOS에서 Dock 아이콘이 없고 메뉴 막대·Dock을
덮지 않으며, 시스템 UI 위로 올라오지 않는다.**

### M3 — 실행 엔진 + 보안 검증 + 자동 숨김 + 숫자 힌트 실행
`validate.ts`(플랫폼별 확장자 규칙 §8.2),
`launcher/{index,common,windows,macos}.ts`(§6.0 구조), `button:launch`, 토스트,
`services/visibility.ts`의 **정책 A(실행 후 자동 숨김, §6.10-A)** 및 `Shift`+클릭 예외,
**숫자 힌트 배지 + 키 입력 실행(§6.11-A)** — 배지 렌더링, 연쇄 입력(폴더 파고들기),
`Shift`+힌트, 포커스 확보(`show`→`moveTop`→`focus`), 포커스 상실 시 배지 숨김.
**수용 기준:** URL·폴더·파일 키가 실제로 열리고 **패널이 화면을 가리지 않게 사라진다.**
`Ctrl+Alt+D` → `1` 만으로 마우스 없이 실행된다. `3` → `2` 연쇄 입력이 동작한다.
실패 시·폴더 진입 시에는 숨지 않는다. `validate.test.ts`, `launcher.test.ts` 통과.
`javascript:` 등 위험한 프로토콜이 차단된다. 폴더 키는 실행되지 않는다.

### M4 — 편집기 창 (클릭 기반 먼저)
`editorWindow.ts`, `KeyGrid`, `ActionLibrary`(템플릿 5개만), `PropertiesPanel`,
`picker:folder`/`file`/`executable`, `deck:upsert`/`remove`/`duplicate`,
`config:changed` 브로드캐스트로 패널·편집기 동기화.
**수용 기준:** 편집기에서 라이브러리 항목을 **클릭**해 빈 슬롯에 추가하고, 속성을 편집하면
패널에 즉시 반영된다. 두 창의 상태가 항상 일치한다.

### M5 — 드래그 앤 드롭 전체
`@dnd-kit` 도입, §9.5의 6가지 경로 전부, 스프링 로디드 폴더, 휴지통,
§9.6 OS 드롭(`drop:classify`, `webUtils.getPathForFile`).
**수용 기준:** §15의 "편집기 · 드래그 앤 드롭" 항목 중 설치된 앱 관련을 제외한 전부가 통과한다.
`dropClassify.test.ts` 통과.

### M6 — 설치된 앱 + 브라우저 + 아이콘 (양쪽 플랫폼)
`appScanner/{index,types,windows,macos}.ts`(§6.0 구조),
**`browserService/{index,detect,profiles,flags}.ts`(§6.13)** + `browsers:list` +
편집기 속성 패널의 브라우저·프로필·전용 창 컨트롤,
`iconService.ts`, `faviconService.ts`, 아이콘 144×144 정규화,
라이브러리의 설치된 앱 섹션(검색 + 가상 스크롤 + 지연 로딩), `IconPicker`.
**수용 기준:** 앱 목록에서 앱을 끌어다 놓으면 바로 완성된 키가 만들어진다.
Windows는 exe 아이콘, macOS는 `.app` 번들 아이콘이 표시된다.
**양쪽 모두 한글 앱 이름이 깨지지 않는다.** 오프라인에서도 크래시하지 않는다.
URL 키에 Chrome + 업무용 프로필 + 전용 창을 지정하면 **기본 브라우저가 아니어도**
그 조합으로 열리고, 창이 하나만 뜬다.
`appScanner.test.ts`와 `browserFlags.test.ts`가 통과한다.

### M6.5 — 전역 실행 경로 (퀵 런처 + 전역 숫자 단축키)

**이 마일스톤이 이 앱의 주 사용 경로를 완성한다. UI 마감(M7)보다 먼저 끝낸다.**

`shortcuts.ts`의 전역 단축키 레지스트리, **전역 숫자 단축키(§6.11-C, 기본 켬)**,
`windows/launcherWindow.ts` + `launcher.html` + `launcher/*` 컴포넌트(§6.12, §9.8.1),
`launcher:query`/`run`/`close`/`resize` IPC,
§6.11-A의 포커스 확보 검증·재시도·시각적 폴백.

**수용 기준:**
- 바탕화면·다른 앱 창·탐색기 어디서든 `Alt+Shift+1`로 1번 키가 실행된다.
  **패널이 뜨지 않고, 마우스를 전혀 쓰지 않는다.**
- `Ctrl+Alt+Space`로 런처가 뜨고 **즉시 타이핑할 수 있다** (클릭 불필요).
- `ㄱㅂ`으로 "개발"이 검색되고, 폴더 3단계 안쪽 키도 한 번에 찾아진다.
- 검색어가 비면 숫자 즉시 실행, 타이핑 중이면 숫자가 검색어로 들어간다.
- §15.3의 "전역 실행"과 "퀵 런처" 항목 전체 통과.

### M6.6 — 엣지·크롬 웹 업무 연결 · Windows 전용

`services/webConnector/`의 전용 브라우저 프로세스, 개발 도구 통신과 상태 기반 업무 엔진,
`web-connector:status`/`test`/`open-setup` 연결 채널, 액션 라이브러리의 나이스 복무·출장과
에듀파인 기안·품의 틀, 속성 패널의 업무용 브라우저 선택, 설정의 교육청과
`웹 업무 연결` 탭, 나이스·에듀파인 사용자 지정 업무 만들기를 구현한다.

**수용 기준:** Windows 연결 시험에서 엣지와 크롬, 17개 교육청 프로필을 따로 식별한다.
기본 네 업무 키와 검증된 사용자 지정 업무 키는 개인 브라우저를 열지 않고 전용 프로필에서
목표 화면까지 이동한 뒤 멈춘다. 사용자 지정 업무는 최대 여덟 개의 정확한 메뉴 이름과 마지막
도착 문구만 받는다. 로그인 정보는 읽거나 저장하지 않고 위험 단추를 누르지 않는다.
연결이나 자동 이동이 실패해도 개인 브라우저로 우회하지 않으며 원인과 해결 방법이 한국어로
표시된다. macOS에서는 연결 화면과 전용 브라우저 구현이 없고 기존 웹 업무 키도 차단한다.
관련 단위 테스트와 전체 기존 테스트가 통과한다. 실제 교육청 계정 실기는 별도로 확인한다.

### M6.7 — 멀티 액션

`MultiActionSpec`과 `MultiActionStep`, `services/multiAction/` 실행 관리자,
`multi-action:cancel`과 `multi-action:progress`, 액션 라이브러리의 멀티 액션 틀,
속성 패널의 단계 추가·순서 변경·삭제, 패널의 진행 상태와 취소 단추를 구현한다.

**수용 기준:** 기존 URL·폴더·파일·앱·웹 업무 키를 최대 20단계로 묶어 순서대로 실행한다.
기다리기 뒤 다음 단계가 실행되고, 실패하면 즉시 멈추며, 실행 중 다시 누르면 중복되지 않는다.
패널에서 취소할 수 있고 취소 뒤 다시 실행할 수 있다. 중첩 멀티 액션과 없는 키 참조는
저장 단계에서 거부된다. 임의 셸 명령과 스크립트 실행 경로가 없고 양쪽 운영체제에서
`multiAction.test.ts`와 전체 기존 테스트가 통과한다.

### M6.8 — 결재 대기 업무 알림 · Windows 전용

`services/approvalMonitor/{index,windows,macos}.ts`, `web-approval:status`와
`web-approval:check`, `web-approval:changed`, 설정의 `업무 알림`, 결재함 키와 대기 수 배지를
구현한다. 나이스와 에듀파인별 브라우저, 5분·10분·30분 확인 주기, 근무 시간과 증가 알림 정책을
지원한다.

**수용 기준:** 기본 꺼짐이며 macOS에서는 초기화되지 않는다. Windows에서는 허용된 교육청의
결재함 화면에 표시된 0부터 9999까지의 정수 수량 하나만 읽고, 연결별 첫 확인을 기준값으로 삼은 뒤
증가할 때만 알린다. 결재함 키를 누르면 결재함까지만 열고 대기 문서 항목, 승인, 반려, 서명과 결재
처리는 누르지 않는다. 상태 파일에는 연결 식별용 교육청과 업무용 브라우저, 수량과 시각만 저장한다.
관련 검증과 전체 기존 검증이 통과하며 실제 기관 계정 실기는 별도 확인표로 남긴다.

### M7 — 트레이 · 키별 단축키 · 가장자리 피크 · 설정 · 자동 시작 · 마감
`tray.ts`, `shortcuts.ts`, `autoLaunch.ts`,
`services/visibility.ts`의 **정책 B(가장자리 피크 트리거 스트립, §6.10-B)** 와
**정책 C(유휴 반투명 + 클릭 통과, §6.10-C)**,
**키별 전역 단축키(§6.11-B)** — `hotkey:validate`,
편집기 속성 패널의 `전역 단축키` 위젯, 설정의 등록 목록 표,
전역 숫자 단축키 1~10번 미리보기 목록,
`SettingsModal`의 `동작` 탭 포함 5개 탭(§9.9),
컨텍스트 메뉴 + 클립보드(§9.7), 키보드 내비게이션(§9.8), 테마 전환,
`prefers-reduced-motion`, 전체 문구 한국어 검수.
**수용 기준:** §15의 "화면 가림 방지"와 "키보드 실행" 체크리스트 전체가 통과한다.
가장자리 띠가 다른 앱의 포커스를 빼앗지 않고, 스쳐 지나갈 때 오작동하지 않는다.
§9 UI 명세를 모두 만족한다. 키보드만으로 키를 실행할 수 있다. 단축키 충돌 시 롤백된다.

### M8 — 업데이트 + 릴리즈 파이프라인 (양쪽 플랫폼)
`updater/{index,windows,macos}.ts`(§10.1 — macOS는 버전 확인만),
`electron-builder.yml`(win nsis + mac dmg arm64/x64), `release.yml`(verify + 매트릭스),
아이콘 에셋(`build/icon.ico`, `build/icon.icns`, `resources/tray.ico`,
`resources/trayTemplate.png`, `resources/trayTemplate@2x.png`), README 작성.
**수용 기준:** `git tag v1.0.0 && git push --tags` 하면 두 OS 잡이 모두 통과하고
릴리즈에 `StreamPanel-1.0.0-Setup.exe` · `latest.yml` ·
`StreamPanel-1.0.0-arm64.dmg` · `StreamPanel-1.0.0-x64.dmg`가 전부 첨부된다.
**macOS 빌드가 서명 인증서를 찾다가 실패하지 않는다** (`CSC_IDENTITY_AUTO_DISCOVERY: false`).

### M9 — 실기 QA (Windows + macOS)
§15.1~15.5를 양쪽 OS에서 각각 수행하고, §15.6(Windows) · §15.7(macOS)를 추가로 수행한다.
발견된 버그 수정 후 `v1.0.1` 태그로 Windows 자동 업데이트 경로와
macOS 버전 알림 경로를 각각 검증한다.
**macOS는 개발 머신에서 직접 확인할 수 있고, Windows는 실기가 필요하다.**

---

## 17. 최초 실행 명령 (M0에서 그대로 사용)

```bash
cd /Users/youngmini/stream-panel
git init -b main
# ... 스캐폴드 생성 후 ...
gh repo create deepsky616/stream-panel --public --source=. --remote=origin \
  --description "Windows 바탕화면에 항상 고정되는 Stream Deck 스타일 런처 패널"
git add -A && git commit -m "chore: scaffold electron-vite + react + typescript"
git push -u origin main
```

릴리즈:

```bash
npm version 1.0.0 --no-git-tag-version
git add -A && git commit -m "chore: release v1.0.0"
git tag v1.0.0
git push origin main --tags        # release.yml 트리거
```

---

## 18. 알려진 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 코드 서명 없음 → SmartScreen 경고 | 사용자가 설치를 포기 | README에 스크린샷과 함께 우회법 명시. 향후 Azure Trusted Signing 검토 |
| 백신 오탐 (서명 없는 NSIS) | 설치 차단 | VirusTotal 결과를 릴리즈 노트에 첨부. 서명으로만 근본 해결 |
| `Get-StartApps` 실행 정책 차단 | Store 앱 목록 누락 | `-ExecutionPolicy Bypass` + 실패 시 조용히 무시 |
| 한글 앱 이름 인코딩 깨짐 | 목록이 읽기 불가 | PowerShell 출력 인코딩 UTF-8 강제 + 자식 프로세스 출력 UTF-8 디코드 |
| 투명 + 항상최상위 창 렌더링 깜빡임 | 시각적 결함 | 수동 리사이즈 제거, 크기는 설정에서만 변경. `hasShadow: false` |
| **항상 최상위 패널이 작업 화면을 가림** | 실사용 불가 수준의 불편 | §6.10 정책 A+B 기본 활성화. 실행 즉시 숨고 가장자리 띠로 복귀 |
| 가장자리 띠가 마우스를 스칠 때마다 튀어나옴 | 짜증 유발 | `peekDelayMs` 220ms 지연 + `mouseleave` 시 타이머 취소 |
| 가장자리 띠가 다른 앱의 포커스를 빼앗음 | 타이핑 중 입력 끊김 | 트리거 창을 `focusable: false`로 생성 |
| 유휴 클릭 통과 상태에서 창을 잡을 수 없음 | 패널을 옮길 수 없음 | 커서 진입 시 즉시 `setIgnoreMouseEvents(false)` 복귀 후 드래그 허용 |
| 편집 중 패널이 사라져 결과 확인 불가 | 편집 흐름 단절 | 편집기 창이 열려 있으면 정책 A를 일시 중지 |
| **수식키 없는 전역 단축키 등록** | 모든 앱에서 그 키 입력이 막혀 시스템이 망가짐 | `validate.ts`에서 무조건 거부 + 단위 테스트 (§6.11-B) |
| 전역 단축키가 다른 앱과 충돌 | 조용히 동작 안 함 | 시험 등록 후 즉시 해제로 사전 검사, 실패 시 사유 표시, 설정에 `충돌` 배지 |
| 종료 후 전역 단축키가 남음 | 다른 앱이 그 조합을 못 씀 | `will-quit`에서 `unregisterAll()` + 레지스트리 단일화 (§6.8) |
| 백그라운드에서 패널에 포커스를 못 줌 | 힌트 입력이 먹지 않아 **결국 마우스로 클릭하게 됨** | `focusPanel()` 결과 검증 + 100ms 후 재시도 + 실패 시 배지 회색화·안내 문구 (§6.11-A). 근본적으로는 §6.11-C·§6.12가 이 경로를 우회한다 |
| 전역 숫자 단축키가 "현재 페이지"를 따라감 | 무엇이 실행될지 예측 불가 | **root 첫 페이지로 고정** + 설정에 1~10번 미리보기 목록 (§6.11-C) |
| 퀵 런처에서 숫자가 검색어로 안 들어감 | "1password" 검색 불가 | 검색어가 **빈 상태일 때만** 숫자를 실행으로 해석 (§6.12) |
| 한글 초성 검색 미구현 | 한국어 라벨 검색이 사실상 불가능 | `search.ts`에 초성 인덱스 계산 + `search.test.ts`로 검증 (§6.12) |
| 퀵 런처가 포커스를 못 받음 | 런처의 존재 이유가 사라짐 | `focusable: true` + macOS `app.focus({steal:true})` + `blur` 시 자동 닫힘 |
| 전역 단축키를 너무 많이 등록 | 다른 앱과 광범위한 충돌 | 기본 등록은 12개(토글 1 + 런처 1 + 숫자 10). 키별 단축키는 옵트인 20개 상한 |
| 사용자가 임의의 브라우저 플래그를 입력 | `--disable-web-security`·`--user-data-dir`로 샌드박스 무력화·자격 증명 유출 | 앱이 생성하는 플래그는 `--app=`·`--profile-directory=` 둘뿐. 자유 입력 없음 (§6.13.4) |
| 전용 창 모드에서 URL 중복 전달 | 창이 두 개 열림 | `--app=<url>`을 쓸 때는 위치 인자를 넣지 않는다 + `browserFlags.test.ts` |
| macOS에서 `open -a`로 플래그 전달 | 플래그가 무시되거나 프로필 잠금 충돌 | `.app/Contents/MacOS/<CFBundleExecutable>`을 직접 spawn (§6.13.3) |
| 지정한 브라우저가 제거됨 | 링크가 아예 안 열림 | `shell.openExternal` 폴백 + 토스트 + 편집기 경고 배지. **링크는 반드시 열려야 한다** |
| 힌트 번호와 슬롯 인덱스 불일치로 혼동 | 엉뚱한 키 실행 | 빈 슬롯을 건너뛰어 **눈에 보이는 순서**로 배정 + `hintMap.test.ts` |
| 편집기 입력 중 숫자키가 실행으로 새어나감 | 의도치 않은 실행 | 편집기 창에서는 힌트 입력을 아예 비활성화 (§6.11) |
| 폴더 중첩으로 인한 순환 참조 | 무한 루프·데이터 손상 | `tree.ts`에서 이동 전 조상 검사 + 단위 테스트 (§14) |
| 그리드 축소 시 항목 유실 | 데이터 손실 | 삭제하지 않고 다음 페이지로 넘김 + 사용자 안내 (§9.9) |
| 드롭 시 Electron이 파일로 내비게이션 | 앱 화면이 깨짐 | 모든 드롭 핸들러에서 `preventDefault()` (§8.4) |
| 태그와 package.json 버전 불일치 | 자동 업데이트 무음 실패 | CI에 버전 검증 단계 (§12.4) |
| 초안(draft) 릴리즈로 게시 | 업데이트 미감지 | `releaseType: release` 고정 |
| 플랫폼 전용 API를 반대편에서 호출해 크래시 | 앱이 즉시 죽음 | §6.0의 파일 단위 분리 + §14.1의 API 표. `readShortcutLink`·`app.dock`이 대표적 |
| **macOS Gatekeeper가 무서명 앱을 차단** | 사용자가 실행 자체를 못 함 | README에 시스템 설정 허용 절차를 스크린샷과 함께 명시 (§13). 이걸 빠뜨리면 macOS 사용자는 앱을 열지 못한다 |
| **macOS 자동 업데이트 불가** | 사용자가 구버전에 머무름 | Squirrel.Mac이 서명을 요구하므로 시도하지 않는다. 대신 버전 확인 후 릴리즈 페이지 안내 (§10.1) |
| CI의 macOS 잡이 서명 인증서를 찾다 실패 | 릴리즈 빌드 실패 | `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` + `mac.identity: null` (§12.4) |
| macOS에서 `'screen-saver'` 창 레벨 사용 | 메뉴 막대·Mission Control까지 덮어 사용자를 가둠 | macOS는 `'floating'` 고정. `platform/index.ts`에서만 결정 (§6.5) |
| `LSUIElement` 앱이 키보드 포커스를 못 받음 | 숫자 힌트가 먹지 않음 | `showPanel()`에서 `app.focus({steal:true})` 선행 호출 (§6.11-A) |
| macOS에서 컬러 트레이 아이콘 사용 | 다크 모드에서 아이콘이 안 보임 | `trayTemplate.png` + `setTemplateImage(true)` (§6.7) |
| `.app`을 폴더로 오분류 | 앱이 Finder 창으로 열림 | `.app` 접미사를 `folder`보다 먼저 검사 (§8.2, §9.6) |
| Windows 설정 파일을 macOS에서 사용 | 경로 키가 전부 깨짐 | `config.platform` 기록 + 경고 배지, 삭제하지 않음 (§4.6) |
| 앱 스캔이 UI를 멈춤 | 라이브러리 프리즈 | 비동기 스캔 + 24h 캐시 + 아이콘 지연 로딩 |
| 고아 아이콘 파일 누적 | 디스크 낭비 | 앱 시작 시 미참조 아이콘 정리 (§6.6) |

---

## 19. 코덱스에게 전달할 지시문 (그대로 복사)

```
/Users/youngmini/stream-panel/PLAN.md 를 처음부터 끝까지 읽고 그대로 구현해줘.
1500줄이 넘으니 요약하지 말고 전부 읽어야 한다.

# 무엇을 만드는가
Windows·macOS 바탕화면용 Elgato Stream Deck 클론. 물리 장치 없이 소프트웨어로 재현한다.
링크·폴더·파일·설치된 앱을 키로 등록해두고 눌러서 실행하는 런처다.
§1의 대응표가 스트림덱의 어떤 동작을 흉내 내야 하는지 정의한다.
두 OS 모두 1급 지원 대상이다. Linux는 만들지 않는다.

# 작업 방식
- §16의 마일스톤 M0 → M6.5 → M7 → M8을 순서대로 진행한다. 건너뛰지 않는다.
- 각 마일스톤이 끝날 때마다 수용 기준을 실제로 확인하고 별도 커밋을 만든다.
- M1(순수 로직 + 테스트)을 UI보다 먼저 완성한다.
  shared/layout.ts, tree.ts, hintMap.ts, search.ts 네 파일이 이 앱의 심장이고,
  여기가 틀리면 나머지가 전부 무너진다. 테스트를 먼저 통과시킨 뒤 UI로 넘어간다.
- M6.5(전역 실행 경로)는 UI 마감보다 먼저 끝낸다. 이게 이 앱의 주 사용 경로다.
- §4의 타입 정의, §4.3의 슬롯 배치 규칙, §5의 IPC 채널은 이름과 형태를 그대로 쓴다.
  더 좋은 설계가 떠올라도 바꾸지 말고 먼저 물어봐라.

# 절대 타협하면 안 되는 것

보안 (§8)
- child_process 에 shell:true 금지. 인자는 항상 배열로 전달.
- 모든 창에 contextIsolation:true, nodeIntegration:false, sandbox:true.
- 모든 IPC 핸들러는 첫 줄에서 입력을 검증한다. 렌더러는 신뢰하지 않는다.
- URL은 http/https/mailto 화이트리스트. javascript:, file:, data: 는 차단.
  브라우저를 지정한 경우에도 이 검증을 먼저 통과해야 한다. 우회 경로를 만들지 마라.
- 브라우저 플래그를 사용자가 자유 입력하게 만들지 마라. 앱이 생성하는 플래그는
  --app= 과 --profile-directory= 둘뿐이다(§6.13.4).
- 드롭 핸들러에서 preventDefault() 누락 금지. 빠뜨리면 앱 화면이 파일로 대체된다.
- 폴더를 자기 자신의 하위로 옮기는 순환 참조를 거부한다.

전역 단축키 (§6.11-B)
- 수식키(Ctrl/Alt/Shift/Win/Cmd) 없는 단일 키의 전역 등록을 절대 허용하지 마라.
  'G' 하나를 전역으로 잡으면 사용자의 모든 앱에서 G 타이핑이 막힌다.
- will-quit 에서 unregisterAll(). 종료 후 단축키가 남으면 안 된다.
- accelerator는 항상 CommandOrControl 로 저장한다. Control 하드코딩 금지.

플랫폼 분기 (§6.0)
- 플랫폼 의존 코드는 services/<이름>/{index,windows,macos}.ts 로 파일을 나눈다.
  if (process.platform === 'win32') 를 코드 전체에 흩뿌리지 마라.
- 어떤 플랫폼에서도 throw 대신 안전한 기본값을 반환한다.
- platform 인자를 주입 가능하게 만들어, 한 머신에서 양쪽 구현을 모두 테스트한다.

# 이 앱의 성패를 가르는 4가지

1. 드래그 앤 드롭 (§9.5, §9.6)
   오른쪽 액션 목록에서 왼쪽 키로 끌어다 놓는 것이 스트림덱의 핵심 사용법이다.
   6가지 경로를 전부 구현한다. 탐색기/Finder에서 폴더를, 브라우저에서 URL을
   직접 끌어다 놓는 것(§9.6)까지 포함한다.
   macOS에서 .app 은 디렉터리지만 폴더가 아니라 앱으로 분류해야 한다.

2. 패널이 화면을 가리지 않게 하기 (§6.10)
   항상 최상위 패널이 링크를 연 뒤에도 화면에 남아 작업을 가리는 것이
   이 앱의 가장 큰 실사용 문제다.
   정책 A(실행 후 자동 숨김)와 B(가장자리 피크)가 기본으로 켜져 있어야 한다.

3. 마우스를 한 번도 쓰지 않고 실행하기 (§6.11-C, §6.12) — 주 사용 경로
   패널을 띄우고 클릭한 뒤 숫자를 누르는 것은 너무 번거롭다. 두 경로가 그걸 대체한다.
   (a) 전역 숫자 단축키: Alt+Shift+1~0 (mac Ctrl+Option+1~0). 기본으로 켜져 있다.
       바탕화면·다른 앱 창·탐색기 어디서든 눌리면 패널을 띄우지 않고 바로 실행한다.
       매핑은 root 첫 페이지 1~10번으로 고정한다. "현재 페이지"를 따라가게 만들지 마라.
       무엇이 실행될지 예측할 수 없게 된다.
   (b) 퀵 런처: Ctrl+Alt+Space (mac Cmd+Option+Space). Spotlight 방식.
       창이 뜨는 즉시 타이핑할 수 있어야 한다. 클릭이 필요하면 실패한 것이다.
       한글 초성 검색(ㄱㅂ → 개발)은 반드시 구현한다. 없으면 검색이 쓸모없다.
       검색어가 빈 상태에서만 숫자가 즉시 실행이다. 타이핑 중에는 검색어로 들어간다.

   패널 안의 힌트 번호는 슬롯 인덱스가 아니라 눈에 보이는 순서로 배정한다.
   빈 슬롯은 건너뛴다. 이걸 틀리면 엉뚱한 키가 실행된다.
   힌트 판정은 event.key 가 아니라 event.code 로 한다.
   한글 입력기가 켜져 있으면 event.key 가 조합 중 문자로 와서 먹지 않는다.

4. 두 OS에서 똑같이 동작하기 (§6.0, §14.1)
   Windows와 macOS 모두 1급 지원 대상이다.
   macOS에서 창 레벨은 'floating' 이다. 'screen-saver' 를 쓰면 메뉴 막대와
   Mission Control 까지 덮어서 사용자가 앱에서 빠져나올 수 없게 된다.
   LSUIElement 앱은 키보드 포커스를 못 받을 수 있으므로 패널을 띄우기 전에
   app.focus({steal:true}) 를 먼저 호출해야 숫자 힌트가 동작한다.

# 개발 환경 제약
- 개발 머신은 macOS다. macOS 동작은 직접 확인할 수 있지만 Windows는 확인할 수 없다.
- §14.1의 플랫폼 API 표를 반드시 지켜라. shell.readShortcutLink 와 PowerShell
  Get-StartApps 는 Windows 전용이고, app.dock 과 plutil 은 macOS 전용이다.
  가드 없이 호출하면 반대편에서 즉시 크래시한다.
- npm run dev 가 macOS에서 크래시 없이 실행되는 것이 모든 마일스톤의 전제 조건이다.
- Windows 인스톨러는 로컬에서 만들 수 없다. GitHub Actions 매트릭스가
  windows-latest / macos-latest 양쪽에서 빌드한다.
- macOS는 코드 서명을 하지 않는다. 그래서 자동 업데이트를 구현하지 마라(§10.1).
  electron-updater 를 macOS에서 초기화조차 하지 않는다.

# 코드 스타일
- 모든 사용자 대면 문구는 한국어. 코드 식별자와 주석은 영어.
- 오류 메시지는 원인과 해결책을 함께 준다.
  나쁜 예: "실행 실패"
  좋은 예: "대상 폴더를 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다: D:\작업"
- CSS 프레임워크를 쓰지 않는다. 순수 CSS + CSS 변수로 테마를 만든다.
- 파비콘 조회를 제외하고 런타임에 외부 네트워크를 쓰지 않는다.

# 완료 조건
1. §14의 단위 테스트 11개 파일을 실제로 작성하고 전부 통과시킨다.
   (layout / tree / hintMap / accelerator / search / validate / store-migration /
    appScanner / browserFlags / launcher / dropClassify)
   appScanner 와 launcher 는 Windows·macOS 구현을 한 머신에서 모두 검증해야 한다.
   search.test.ts 는 한글 초성과 7단계 랭킹을 촘촘히 검증해야 한다.
2. gh repo create 로 deepsky616/stream-panel 을 public 으로 만들고 푸시한다.
3. package.json 을 1.0.0 으로 맞추고 v1.0.0 태그를 푸시한다.
4. GitHub Actions 의 두 잡(windows-latest / macos-latest)이 모두 통과하고,
   릴리즈에 아래 5개가 전부 첨부된 것을 확인한다.
     StreamPanel-1.0.0-Setup.exe
     StreamPanel-1.0.0-Setup.exe.blockmap
     latest.yml               ← 없으면 Windows 자동 업데이트가 죽는다
     StreamPanel-1.0.0-arm64.dmg
     StreamPanel-1.0.0-x64.dmg
5. macOS DMG를 실제로 설치해 §15.7 체크리스트를 직접 수행한다 (개발 머신이 macOS이므로 가능).
6. §15의 Windows 항목(§15.1~15.6)은 직접 확인할 수 없으므로 README에 체크리스트로
   옮겨 적어 사용자가 검증할 수 있게 한다.
7. README에 macOS Gatekeeper 허용 절차를 반드시 넣는다.
   이게 없으면 macOS 사용자는 앱을 아예 열지 못한다.

# 막혔을 때
불명확한 점이 있으면 임의로 정하지 말고 물어봐라.
특히 §4 타입이나 §5 IPC 채널을 바꿔야 할 것 같으면 반드시 먼저 확인받아라.
```
