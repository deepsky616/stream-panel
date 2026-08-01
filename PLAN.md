# Stream Panel — 구현 명세서 (v1.0)

> Windows 바탕화면에 항상 떠 있는 **Elgato Stream Deck 스타일 런처**.
> 물리 장치 없이, 소프트웨어 패널 + 편집기 앱으로 스트림덱의 사용 흐름을 재현한다.
> 이 문서는 **코드 작성 에이전트(Codex)가 이 문서만 읽고 처음부터 끝까지 구현**할 수 있도록 작성되었다.
> 추측이 필요한 부분은 이미 "결정"으로 답이 적혀 있다. 명세에 없는 것만 자유롭게 판단한다.

---

## 0. 한 줄 목표

사용자가 **링크(URL) / 폴더 / 파일 / 설치된 앱**을 편집기에서 키로 드래그해 배치하고 이름을 붙이면,
바탕화면에 항상 고정된 패널의 해당 키를 눌러 즉시 실행할 수 있는 Windows 데스크톱 앱.
GitHub 공개 저장소에 올리고 태그를 푸시하면 GitHub Actions가 Windows 설치 파일(.exe)을 빌드해
릴리즈에 자동 첨부한다. 사용자는 설치 파일 하나만 받아 설치하면 바로 동작한다.

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
- 다이얼·터치스크린·멀티액션·소셜 연동은 구현하지 않는다 (§2.2).

---

## 2. 확정된 제품 결정 사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 창 구성 | **패널 창 + 편집기 창** 2개 | 스트림덱의 "장치 + 앱" 구조 재현. 패널은 작고 실행 전용 |
| 패널 형태 | 프레임리스 항상-최상위 플로팅 창 (드래그로 이동) | 스트림덱 데스크톱 앱과 동일한 사용감 |
| 작업표시줄 | 표시하지 않음 (`skipTaskbar: true`), 트레이로 제어 | 상시 실행 유틸리티 |
| 전역 단축키 | `Ctrl+Alt+D` 표시/숨김 토글 (설정에서 변경 가능) | 가려졌을 때 즉시 호출 |
| 패널 크기 | **수동 리사이즈 없음.** 그리드 설정에서 자동 계산 | Windows에서 투명 창 리사이즈는 깜빡임 버그가 잦음 |
| 계층 구조 | 폴더 키로 무한 중첩 (실용상 깊이 5 제한) | 스트림덱 폴더 |
| 저장소 | `github.com/deepsky616/stream-panel` (**공개**) | 릴리즈 다운로드·자동 업데이트에 인증 불필요 |
| 설치 방식 | NSIS, **사용자 단위 설치**(`perMachine: false`) | UAC 관리자 권한 프롬프트 회피 |
| 코드 서명 | v1.0에서는 **하지 않음** | 비용 문제. SmartScreen 경고 안내를 README에 명시 (§13) |
| 자동 업데이트 | `electron-updater` + GitHub 프로바이더 | 공개 저장소라 토큰 불필요 |

### 2.1 v1.0 범위 (반드시 구현)

- 패널 창: 키 클릭 실행, 폴더 진입/복귀, 페이지 전환, 드래그 이동, 잠금
- 편집기 창: 키 그리드 + 액션 라이브러리 + 속성 편집 패널
- 드래그 앤 드롭: 라이브러리→키, 키↔키 이동/교환, 키→폴더 안, 키→삭제, **OS 파일/폴더/URL 드롭**
- 액션 4종: `url` / `folder` / `file` / `app`(+`uwp`) + **폴더 키**
- 설치된 앱 목록 (시작 메뉴 스캔 + Microsoft Store 앱)
- 아이콘: 자동 추출(exe 아이콘·파비콘) / 이모지 / 커스텀 이미지(144×144 정규화) / 글자
- 복사·잘라내기·붙여넣기·복제·삭제 (마우스 + 키보드)
- 트레이, 전역 단축키, 로그인 시 자동 시작
- 설정: 그리드 크기, 테마, 투명도, 단축키, 잠금
- 자동 업데이트 + GitHub Actions 릴리즈 파이프라인

### 2.2 v1.0 범위 밖 (구현하지 말 것)

프로필(여러 세트 전환), 멀티 액션(키 하나에 여러 동작), 키보드 매크로 전송,
플러그인 시스템, 클라우드 동기화, 소셜 계정 연동, 다이얼/터치스트립,
macOS/Linux 정식 지원(개발용 실행만 가능하면 됨).

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
export type ActionType = 'url' | 'folder' | 'file' | 'app' | 'uwp';
/** 'folder'는 "폴더 열기" 액션. 계층 구조를 만드는 폴더 키는 FolderItem이다 — 혼동 주의. */
/** 'uwp'는 Microsoft Store 앱. target에 AppUserModelID가 들어간다. */

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
}

export interface ActionItem extends DeckItemBase {
  kind: 'action';
  type: ActionType;
  target: string;      // url | 절대 경로 | exe 경로 | AppUserModelID
  args: string[];      // type==='app' 일 때만 의미 있음. 기본 []
  workingDir?: string; // type==='app'
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

export interface AppConfig {
  version: number;                      // 스키마 버전. 현재 1
  root: DeckItem[];                     // 최상위 키 목록
  grid: GridConfig;
  window: WindowConfig;
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
  | { kind: 'action-template'; type: ActionType; label: string; emoji: string }
  | { kind: 'folder-template'; label: string; emoji: string }
  | { kind: 'installed-app'; app: InstalledApp };

export type LaunchResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'BLOCKED' | 'FAILED'; message: string };
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

### 4.5 마이그레이션

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
| `button:launch` | `{ path: string[]; id: string }` | `LaunchResult` | 액션 실행 (§7) |
| `picker:folder` | — | `string \| null` | 폴더 선택 다이얼로그 |
| `picker:file` | — | `string \| null` | 파일 선택 다이얼로그 |
| `picker:executable` | — | `{target,args,workingDir,name} \| null` | `.exe`/`.lnk` 선택. `.lnk`면 자동 해석 |
| `picker:image` | — | `string \| null` | 아이콘 이미지 선택 → 144×144 PNG로 정규화 후 상대경로 반환 |
| `icon:importPath` | `string` | `string \| null` | OS 드롭으로 받은 이미지 경로를 아이콘으로 등록 |
| `apps:list` | `{ refresh?: boolean }` | `InstalledApp[]` | 설치된 앱 목록 (§6.1) |
| `icon:resolve` | `{ type: ActionType; target: string }` | `string \| null` | 아이콘 data URL (캐시 사용) |
| `drop:classify` | `{ paths: string[]; text?: string }` | `Partial<ActionItem>[]` | OS 드롭 대상을 액션으로 변환 (§9.6) |
| `window:hide` | — | `void` | 패널 숨기기 |
| `window:relayout` | — | `void` | 그리드 변경 후 패널 크기 재계산 |
| `editor:open` | `{ path?: string[]; slot?: number }` | `void` | 편집기 창 열기/포커스. 슬롯 선택 상태로 진입 |
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
  drop:   { classify },
  window: { hide, relayout },
  editor: { open },
  update: { check },
  app:    { info },
  shell:  { reveal },
  on: (channel: RendererEvent, cb: (payload: unknown) => void) => () => void, // 구독 해제 함수 반환
});
```

렌더러에는 `src/renderer/src/api.d.ts`로 `declare global { interface Window { api: ... } }`를 선언한다.

---

## 6. Windows 전용 기능 상세

이 절이 가장 실수하기 쉬운 부분이다. **명세대로 정확히 구현한다.**

### 6.1 설치된 앱 목록 수집 (`appScanner.ts`)

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

**캐싱 및 성능**

- 결과를 메모리 + `cache/apps.json`에 캐시 (TTL 24시간). `refresh: true`면 재스캔.
- `fs.promises`로 비동기 수행한다.
- **아이콘 추출을 목록 반환 시점에 하지 않는다.** 이름·경로만 먼저 반환하고,
  렌더러가 화면에 보이는 항목만 `icon:resolve`로 개별 요청한다 (지연 로딩).
- 스캔 중에는 라이브러리에 스켈레톤을 표시한다.

**비-Windows 폴백:** `process.platform !== 'win32'`이면 빈 배열을 반환하고,
라이브러리에 "설치된 앱 목록은 Windows에서만 지원됩니다" 안내를 표시한다.

### 6.2 아이콘 추출 (`iconService.ts`)

`icon:resolve({type, target})` 동작:

1. 캐시 키 = `sha256(type + '|' + target)`. `cache/icons/<key>.png`가 있고 메타의 `mtimeMs`가
   현재 대상 파일과 같으면 즉시 반환.
2. `type`이 `app` / `file` / `folder`:
   - `await app.getFileIcon(target, { size: 'large' })` → `NativeImage`
   - `image.isEmpty()`면 `null` 반환 → 렌더러가 글자 아이콘으로 폴백
   - `image.toPNG()`를 캐시에 쓰고 `image.toDataURL()` 반환
3. `type`이 `uwp`: `getFileIcon`이 동작하지 않는다. **`null`을 반환**하고 글자 아이콘으로 폴백한다.
   (UWP 아이콘 추출은 매니페스트 파싱이 필요해 v1.0 범위 밖)
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
app.setLoginItemSettings({
  openAtLogin: enabled,
  path: process.execPath,
  args: ['--hidden'],
});
```

- 개발 모드(`!app.isPackaged`)에서는 호출하지 않는다. 설정 UI는 비활성화하고
  "설치 후 사용 가능" 툴팁을 표시한다.
- `process.argv.includes('--hidden')`이면 패널을 숨긴 채 트레이로만 시작한다.

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

win.setAlwaysOnTop(config.window.alwaysOnTop, 'screen-saver');
win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
win.setOpacity(config.window.opacity);
```

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

### 6.7 트레이 (`tray.ts`)

메뉴: `패널 표시/숨기기` · `편집기 열기` · `설정...` · `업데이트 확인` · 구분선 · `종료`
트레이 좌클릭 = 표시/숨김 토글. 툴팁 `Stream Panel v{version}`.

### 6.8 전역 단축키 (`shortcuts.ts`)

- 시작 시 `config.hotkey` 등록.
- 등록 실패(다른 앱이 선점)하면 `toast`로 알리고 설정 창에서 다시 지정하도록 안내한다.
- 설정에서 변경 시 기존 것을 `unregister` 후 새로 등록한다. 실패하면 이전 값으로 롤백한다.
- `will-quit`에서 `globalShortcut.unregisterAll()`.

### 6.9 단일 인스턴스

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => showPanel());
```

---

## 7. 액션 실행 엔진 (`launcher.ts`)

`button:launch({path, id})` 처리 흐름:

1. `path`를 따라 계층을 내려가 `id`로 항목을 찾는다. 없으면 `{ok:false, code:'NOT_FOUND'}`.
2. **`kind === 'folder'`이면 실행하지 않는다.** 폴더 진입은 렌더러가 자체 처리한다
   (IPC 왕복 없이 즉시 전환).
3. `validate.ts`로 `type`+`target` 조합을 재검증한다 (§8). 실패 시 `{ok:false, code:'BLOCKED'}`.
4. 타입별 실행:

| type | 구현 |
|---|---|
| `url` | `await shell.openExternal(target)` |
| `folder` | `await shell.openPath(target)` — 반환 문자열이 비어있지 않으면 실패 |
| `file` | `await shell.openPath(target)` — 동일 |
| `app` | `spawn(target, args, { detached: true, stdio: 'ignore', cwd: workingDir ?? path.dirname(target), windowsHide: false })` 후 `child.unref()` |
| `uwp` | `spawn('explorer.exe', ['shell:AppsFolder\\' + target], { detached: true, stdio: 'ignore' })` 후 `unref()` |

5. **`shell: true`를 절대 쓰지 않는다.** 인자는 배열로 전달한다 (명령어 인젝션 방지).
6. `folder`/`file`/`app`은 실행 전 `fs.existsSync(target)`으로 존재를 확인한다.
   없으면 `{ok:false, code:'NOT_FOUND', message:'대상을 찾을 수 없습니다: <경로>'}`.
7. 실패 시 렌더러에 `toast`로 한국어 오류 메시지를 보낸다.
8. 성공해도 **패널을 자동으로 숨기지 않는다** (연속 실행이 잦은 도구이므로).

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
- `app` 타입의 `target` 확장자는 `.exe`, `.bat`, `.cmd` 중 하나.
  `.bat`/`.cmd`는 허용하되 편집기 속성 패널에 "스크립트 파일입니다. 신뢰하는 파일만 등록하세요" 경고를 띄운다.

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
  - `folder`/`file`: 경로(읽기 전용) + `찾아보기` 버튼. 제목이 비면 `path.basename`을 제안.
  - `app`: 경로 + `찾아보기`(`.exe`/`.lnk`) + `실행 인자`(공백 구분 문자열 → 배열로 파싱) +
    `작업 폴더`(선택).
  - `uwp`: AppID를 읽기 전용으로 표시. 편집 불가.
  - `folder`(FolderItem): 제목·아이콘·색상만. 대상 필드 없음.
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
     - 디렉터리면 `type:'folder'`, 파일이면 `type:'file'`, `.exe`/`.lnk`면 `type:'app'`
       (`.lnk`는 `readShortcutLink`로 해석)
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

- 그리드는 roving tabindex. 화살표 키로 이동, `Enter`/`Space`로 실행(패널) 또는 선택(편집기).
- 폴더 키에서 `Enter` = 진입, `Backspace` = 상위 복귀.
- `Ctrl+←/→` 페이지 전환. `Delete` 삭제. `Ctrl+C/X/V` 클립보드. `F2` 이름 변경(편집기).
- 다이얼로그·팝오버는 포커스 트랩 + `Esc` 닫기.
- 모든 아이콘 버튼에 한국어 `aria-label`.
- `prefers-reduced-motion: reduce`면 모든 트랜지션을 0ms로.

### 9.9 설정 (편집기 내 모달)

탭 4개: `일반` / `모양` / `단축키` / `정보`

- **일반**: 로그인 시 자동 시작 · 시작 시 숨김 · 자동 업데이트 확인 · 설정 초기화(2단계 확인)
- **모양**: 테마(시스템/라이트/다크) · 그리드 열 슬라이더(2~8) · 행 슬라이더(1~6) ·
  버튼 크기(64~140) · 투명도(0.3~1.0) · 항상 최상위 토글
  → **모두 라이브 프리뷰**: 변경 즉시 패널과 편집기 그리드에 반영된다.
  → 그리드를 줄여서 기존 항목이 범위를 벗어나면 "N개 항목이 다음 페이지로 이동합니다" 안내를 띄운다.
    **항목을 삭제하지 않는다.**
- **단축키**: 클릭하면 키 입력을 캡처하는 위젯. 충돌 시 즉시 오류 표시 + 롤백.
- **정보**: 버전 · 저장소 링크 · 라이선스 · `업데이트 확인` 버튼 + 진행 상태

### 9.10 문구 언어

**모든 사용자 대면 문구는 한국어.** 코드 식별자·주석은 영어.
오류 메시지는 원인과 해결책을 함께 준다.
예: `"대상 폴더를 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다: D:\\작업"`

---

## 10. 자동 업데이트 (`updater.ts`)

```ts
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
```

- `app.isPackaged`이고 `config.autoUpdate === true`일 때만 동작한다.
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
├─ build/{icon.ico, icon.png}
├─ resources/tray.ico
├─ src/
│  ├─ main/
│  │  ├─ index.ts                    # 라이프사이클, 단일 인스턴스, --hidden 처리
│  │  ├─ windows/{panelWindow.ts, editorWindow.ts}
│  │  ├─ tray.ts
│  │  ├─ shortcuts.ts
│  │  ├─ store.ts                    # electron-store + 마이그레이션 + 정규화
│  │  ├─ ipc/{index.ts, configHandlers.ts, deckHandlers.ts, launchHandlers.ts,
│  │  │       pickerHandlers.ts, iconHandlers.ts, dropHandlers.ts, windowHandlers.ts}
│  │  ├─ services/{launcher.ts, appScanner.ts, iconService.ts, faviconService.ts,
│  │  │            autoLaunch.ts, updater.ts}
│  │  └─ security/validate.ts
│  ├─ preload/index.ts
│  ├─ renderer/
│  │  ├─ index.html                  # 패널
│  │  ├─ editor.html                 # 편집기
│  │  └─ src/
│  │     ├─ {main.tsx, editor.tsx}
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
│     └─ defaults.ts
├─ tests/{layout.test.ts, tree.test.ts, validate.test.ts, store-migration.test.ts,
│         appScanner.test.ts, launcher.test.ts, dropClassify.test.ts}
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
    "release:win": "npm run build && electron-builder --win --publish always"
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
`runs-on: windows-latest`, Node 22, `npm ci` → `lint` → `typecheck` → `test` → `build:win`.

### 12.4 `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Verify tag matches package.json version
        shell: bash
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          PKG=$(node -p "require('./package.json').version")
          if [ "$TAG" != "$PKG" ]; then
            echo "::error::Tag v$TAG != package.json $PKG"
            exit 1
          fi
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - name: Build and publish
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run release:win
```

**태그와 `package.json` 버전이 다르면 즉시 실패시키는 단계를 반드시 넣는다.**
두 값이 어긋나면 자동 업데이트가 조용히 망가진다.

### 12.5 릴리즈 산출물

```
StreamPanel-1.0.0-Setup.exe        # NSIS 인스톨러
StreamPanel-1.0.0-Setup.exe.blockmap
latest.yml                          # electron-updater가 읽는 메타데이터 — 반드시 포함
```

---

## 13. README 필수 내용 (한국어)

1. 패널 + 편집기 스크린샷 각 1장
2. **설치 방법**
   - Releases에서 `StreamPanel-x.y.z-Setup.exe` 다운로드 → 실행
   - **SmartScreen 경고 안내:** "Windows에서 PC를 보호했습니다" 화면이 나오면
     `추가 정보` → `실행`. 코드 서명 인증서를 구매하지 않은 오픈소스 앱이라 나타나는
     정상적인 경고임을 설명한다. **(이 문구를 빠뜨리면 사용자가 설치를 포기한다)**
3. 사용법 — 스트림덱 흐름 그대로:
   오른쪽 액션 목록에서 키로 끌어다 놓기 → 이름·아이콘 지정 → 폴더로 묶기 → 패널에서 클릭
4. 단축키 표, 트레이 메뉴 설명
5. 설정 파일 위치 (`%APPDATA%\stream-panel\config.json`) 및 백업 방법
6. 개발 방법: `npm install` → `npm run dev`
   (macOS/Linux에서도 UI 개발은 되지만 앱 목록·아이콘 추출은 Windows 전용임을 명시)
7. 라이선스 (MIT)

---

## 14. 테스트 전략

**단위 테스트 (Vitest, Electron 없이 실행 가능한 순수 모듈만):**

- `layout.test.ts` — §4.3 슬롯 계산. 폴더 내부의 뒤로 키 예약 오프셋, 페이지 수 계산,
  빈 칸 유지, 마지막 빈 페이지 제거, 손상된 position 정규화
- `tree.test.ts` — 경로 탐색, 이동·교환, 폴더 안으로 이동, **순환 참조 거부**,
  깊이 5 초과 거부, 깊은 복사 시 새 id 발급
- `validate.test.ts` — URL 프로토콜 화이트리스트, `javascript:`/`file:` 차단,
  경로 traversal 차단, 라벨/args 길이 제한, 색상 정규식, 항목 수 상한
- `store-migration.test.ts` — 기본값 생성, 미래 버전 감지 시 백업+초기화, 손상된 JSON 복구
- `appScanner.test.ts` — `.lnk` 필터링 규칙(제거 프로그램/문서 링크 배제),
  `Get-StartApps` JSON 파싱, `!` 없는 AppID 제외, 이름 기준 중복 제거
- `launcher.test.ts` — 타입별로 올바른 함수가 호출되는지 (`shell`/`child_process` 모킹),
  **`shell: true`가 절대 쓰이지 않음을 검증**, 존재하지 않는 경로에서 `NOT_FOUND` 반환,
  `FolderItem`은 실행되지 않음
- `dropClassify.test.ts` — 디렉터리/파일/exe/lnk/URL/이미지 분류, 라벨 자동 생성

**수동 QA 체크리스트 (Windows 실기, §15).** E2E 자동화는 v1.0 범위 밖.

### 14.1 macOS 개발 시 크래시 방지 (중요)

작성자는 macOS에서 개발한다. 다음이 `process.platform !== 'win32'`에서 반드시 안전해야 한다:

- `shell.readShortcutLink` — **Windows 전용. 호출 전 플랫폼 가드 필수** (없으면 throw)
- `Get-StartApps` PowerShell — 존재하지 않음. try/catch로 빈 배열 반환
- `app.setLoginItemSettings` — 개발 모드에서는 호출하지 않음
- `app.getFileIcon` — macOS에서도 동작하므로 그대로 둔다
- `%APPDATA%` 등 하드코딩 금지. 반드시 `app.getPath()` / `process.env` 사용
- 경로 조합은 항상 `path.join`. `\\` 리터럴 금지 (`shell:AppsFolder\\` 제외)

`appScanner`는 `process.platform`을 주입 가능한 형태로 만들어 테스트에서 Windows 경로를
시뮬레이션할 수 있게 한다. **`npm run dev`가 macOS에서 크래시 없이 실행되어야 한다.**

---

## 15. Windows 실기 QA 체크리스트

릴리즈 전 Windows 머신에서 전부 통과해야 한다.

**설치 · 패널**
- [ ] 설치 파일 실행 → 설치 경로 변경 가능 → 설치 완료 → 자동 실행
- [ ] 패널이 화면 우상단에 뜨고 항상 최상위로 유지된다 (다른 창을 최대화해도 가려지지 않음)
- [ ] 타이틀바 드래그로 이동, 재시작 후 위치 유지
- [ ] 작업표시줄에 아이콘이 없고 트레이에 아이콘이 있다
- [ ] `Ctrl+Alt+D`로 숨김/표시 토글
- [ ] 잠금 토글 시 이동·재배치·`+`가 모두 비활성화된다

**편집기 · 드래그 앤 드롭 (스트림덱 흐름)**
- [ ] `⚙` 또는 트레이에서 편집기가 열린다
- [ ] 오른쪽 `🔗 웹사이트`를 왼쪽 키로 끌어다 놓으면 키가 생기고 주소 입력에 포커스가 간다
- [ ] `설치된 앱` 목록에서 앱을 끌어다 놓으면 이름·아이콘이 자동으로 채워져 바로 완성된다
- [ ] 설치된 앱 목록에 한글 이름이 깨지지 않고, 제거 프로그램·설명서 링크가 섞여 있지 않다
- [ ] Microsoft Store 앱(예: 계산기)이 목록에 있고 실행된다
- [ ] `🗂️ 폴더 만들기`를 놓으면 폴더 키가 생긴다
- [ ] 키를 폴더 키 위로 500ms 끌면 폴더가 열리고 그 안에 놓을 수 있다
- [ ] 폴더에 들어가면 0번 슬롯이 `↩ 뒤로`이고, 눌러서 상위로 돌아온다
- [ ] 키를 다른 키 위로 끌면 위치가 교환된다
- [ ] 키를 휴지통으로 끌면 삭제된다 (폴더는 확인 다이얼로그)
- [ ] 탐색기에서 폴더를 편집기 그리드로 끌어다 놓으면 폴더 키가 생성된다
- [ ] 브라우저 주소창에서 URL을 끌어다 놓으면 웹사이트 키가 생성된다
- [ ] 이미지 파일을 기존 키 위에 떨어뜨리면 아이콘이 교체된다 (새 키가 생기지 않음)
- [ ] 우클릭 → 복사 / 잘라내기 / 붙여넣기 / 복제 / 삭제가 모두 동작한다

**실행**
- [ ] URL 키 → 기본 브라우저에서 열리고 파비콘이 표시된다
- [ ] 폴더 키(액션) → 탐색기에서 열린다
- [ ] 앱 키 → 해당 앱이 뜨고 exe 아이콘이 추출된다
- [ ] 삭제된 폴더를 가리키는 키를 눌러도 한국어 오류 토스트만 뜨고 앱이 죽지 않는다
- [ ] 패널 빈 칸 `+`를 누르면 편집기가 열리며 그 슬롯이 선택된다

**설정 · 안정성**
- [ ] 그리드 5×3 → 4×2로 줄여도 **항목이 삭제되지 않고** 다음 페이지로 넘어간다
- [ ] 투명도·테마·버튼 크기가 실시간 반영된다
- [ ] 로그인 시 자동 시작 켜고 재부팅 → 트레이에 상주한 채 시작된다
- [ ] 모니터 해상도/개수를 바꿔도 패널이 화면 밖으로 사라지지 않는다
- [ ] 트레이 → 종료로 완전히 종료된다 (작업 관리자에 프로세스가 남지 않는다)
- [ ] 제거 후 재설치 시 설정이 유지된다 (`deleteAppDataOnUninstall: false`)
- [ ] 네트워크를 끊어도 앱이 정상 동작한다 (파비콘만 글자 아이콘으로 폴백)
- [ ] v1.0.1 태그 푸시 → 릴리즈 생성 → 기존 v1.0.0 설치본이 업데이트를 감지하고 적용한다

---

## 16. 구현 순서 (마일스톤)

각 마일스톤은 독립 커밋으로 끝낸다. 수용 기준을 모두 만족해야 다음으로 넘어간다.

### M0 — 스캐폴드
저장소 초기화, electron-vite + React + TS (엔트리 2개: 패널·편집기), ESLint/Prettier,
Vitest, `ci.yml`, MIT LICENSE, `.gitignore`.
**수용 기준:** `npm run dev`로 빈 프레임리스 창이 뜬다. `npm run build`, `npm test` 통과.

### M1 — 데이터 모델 + 슬롯 레이아웃 (순수 로직 먼저)
`shared/types.ts`, `shared/layout.ts`, `shared/tree.ts`, `shared/defaults.ts`,
`store.ts`(마이그레이션 + position 정규화).
**수용 기준:** `layout.test.ts`, `tree.test.ts`, `store-migration.test.ts` 전부 통과.
UI 없이 순수 함수만으로 폴더 중첩·페이지네이션·이동·교환·순환 거부가 검증된다.

### M2 — 패널 창
`panelWindow.ts`, preload, `config:get`/`config:set`, 창 크기 자동 계산,
위치 저장/복원 및 화면 밖 보정, `KeyTile`/`BackTile`/`EmptyTile`, 폴더 진입·복귀,
페이지 도트, 브레드크럼.
**수용 기준:** config.json을 직접 편집하면 패널이 그대로 반영한다. 폴더에 들어가고 나올 수 있다.
창을 옮기고 재시작하면 위치가 복원된다.

### M3 — 실행 엔진 + 보안 검증
`validate.ts`, `launcher.ts`, `button:launch`, 토스트.
**수용 기준:** URL·폴더·파일 키가 실제로 열린다. `validate.test.ts`, `launcher.test.ts` 통과.
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

### M6 — 설치된 앱 + 아이콘
`appScanner.ts`, `iconService.ts`, `faviconService.ts`, 아이콘 144×144 정규화,
라이브러리의 설치된 앱 섹션(검색 + 가상 스크롤 + 지연 로딩), `IconPicker`.
**수용 기준:** 앱 목록에서 앱을 끌어다 놓으면 바로 완성된 키가 만들어진다.
exe 아이콘과 파비콘이 표시된다. 오프라인에서도 크래시하지 않는다. `appScanner.test.ts` 통과.

### M7 — 트레이 · 단축키 · 설정 · 자동 시작 · 마감
`tray.ts`, `shortcuts.ts`, `SettingsModal`, `autoLaunch.ts`,
컨텍스트 메뉴 + 클립보드(§9.7), 키보드 내비게이션(§9.8), 테마 전환,
`prefers-reduced-motion`, 전체 문구 한국어 검수.
**수용 기준:** §9 UI 명세를 모두 만족한다. 키보드만으로 키를 실행할 수 있다.
단축키 충돌 시 롤백된다.

### M8 — 자동 업데이트 + 릴리즈 파이프라인
`updater.ts`, `electron-builder.yml`, `release.yml`,
아이콘 에셋(`build/icon.ico`, `resources/tray.ico`), README 작성.
**수용 기준:** `git tag v1.0.0 && git push --tags` 하면 GitHub Actions가 통과하고
릴리즈에 `StreamPanel-1.0.0-Setup.exe`와 `latest.yml`이 첨부된다.

### M9 — Windows 실기 QA
§15 체크리스트 전체 수행 → 버그 수정 → `v1.0.1` 태그로 업데이트 경로 검증.

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
| 폴더 중첩으로 인한 순환 참조 | 무한 루프·데이터 손상 | `tree.ts`에서 이동 전 조상 검사 + 단위 테스트 (§14) |
| 그리드 축소 시 항목 유실 | 데이터 손실 | 삭제하지 않고 다음 페이지로 넘김 + 사용자 안내 (§9.9) |
| 드롭 시 Electron이 파일로 내비게이션 | 앱 화면이 깨짐 | 모든 드롭 핸들러에서 `preventDefault()` (§8.4) |
| 태그와 package.json 버전 불일치 | 자동 업데이트 무음 실패 | CI에 버전 검증 단계 (§12.4) |
| 초안(draft) 릴리즈로 게시 | 업데이트 미감지 | `releaseType: release` 고정 |
| macOS 개발 중 Windows 전용 API 호출로 크래시 | 개발 불가 | 모든 Windows API에 플랫폼 가드 (§14.1) |
| 앱 스캔이 UI를 멈춤 | 라이브러리 프리즈 | 비동기 스캔 + 24h 캐시 + 아이콘 지연 로딩 |
| 고아 아이콘 파일 누적 | 디스크 낭비 | 앱 시작 시 미참조 아이콘 정리 (§6.6) |

---

## 19. 코덱스에게 전달할 지시문 (그대로 복사)

```
/Users/youngmini/stream-panel/PLAN.md 를 처음부터 끝까지 읽고 그대로 구현해줘.

이 앱은 Elgato Stream Deck의 사용 흐름을 소프트웨어로 재현하는 것이 목표다.
§1의 대응표가 무엇을 흉내 내야 하는지 정의한다.

규칙:
- 타입 정의(§4), 슬롯 배치 규칙(§4.3), IPC 채널(§5)은 이름과 형태를 그대로 사용할 것.
- §16의 마일스톤 M0부터 M8까지 순서대로 진행하고, 각 마일스톤이 끝날 때마다
  수용 기준을 확인한 뒤 별도 커밋을 만들 것.
- M1(순수 로직 + 테스트)을 UI보다 먼저 끝낼 것. layout.ts / tree.ts 가 이 앱의 심장이다.
- 보안 요구사항(§8)은 타협하지 말 것. 특히 child_process에 shell:true 금지,
  contextIsolation/sandbox 활성화, 모든 IPC 입력 검증, 드롭 핸들러의 preventDefault.
- 드래그 앤 드롭(§9.5)과 OS 드롭(§9.6)은 이 앱의 핵심 사용성이다. 6가지 경로를 전부 구현할 것.
- 모든 사용자 대면 문구는 한국어. 코드 식별자와 주석은 영어.
- 개발 환경은 macOS이므로 §14.1의 플랫폼 가드를 반드시 지킬 것.
  npm run dev 가 macOS에서 크래시 없이 실행되어야 한다.
- §14의 단위 테스트를 실제로 작성하고 통과시킬 것.
- 완료 후 gh repo create 로 deepsky616/stream-panel (public) 을 만들고 푸시한 뒤,
  v1.0.0 태그를 밀어 GitHub Actions 릴리즈가 성공하는지 확인할 것.

불명확한 점이 있으면 임의로 정하지 말고 물어봐.
```
