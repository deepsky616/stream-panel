import { isAbsolute, win32 } from 'node:path';
import { validateHintKeys } from '../../shared/hintMap';
import { isEducationOfficeCode } from '../../shared/educationOffices';
import type { AppConfig, DeckItem } from '../../shared/types';

function assertRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} 입력이 올바르지 않습니다.`);
  }
}

export function assertConfigPatch(value: unknown): asserts value is Partial<AppConfig> {
  assertRecord(value, '설정');
  const allowed = new Set([
    'version',
    'platform',
    'educationOfficeCode',
    'root',
    'grid',
    'window',
    'behavior',
    'keyboard',
    'webConnection',
    'approvalMonitor',
    'theme',
    'hotkey',
    'launchAtLogin',
    'autoUpdate',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError('허용되지 않은 설정 항목입니다.');
  }
  if ('version' in value && value.version !== 2) throw new TypeError('지원하지 않는 설정 버전입니다.');
  if ('platform' in value && !['win32', 'darwin'].includes(String(value.platform))) {
    throw new TypeError('운영체제 설정이 올바르지 않습니다.');
  }
  if ('educationOfficeCode' in value && !isEducationOfficeCode(value.educationOfficeCode)) {
    throw new TypeError('소속 교육청 설정이 올바르지 않습니다. 목록에서 다시 선택해 주세요.');
  }
  if ('theme' in value && !['dark', 'light', 'system'].includes(String(value.theme))) {
    throw new TypeError('테마 설정이 올바르지 않습니다.');
  }
  if ('hotkey' in value && (typeof value.hotkey !== 'string' || value.hotkey.length > 80)) {
    throw new TypeError('단축키 설정이 올바르지 않습니다.');
  }
  if ('launchAtLogin' in value && typeof value.launchAtLogin !== 'boolean') {
    throw new TypeError('자동 시작 설정이 올바르지 않습니다.');
  }
  if ('autoUpdate' in value && typeof value.autoUpdate !== 'boolean') {
    throw new TypeError('자동 업데이트 설정이 올바르지 않습니다.');
  }
  if ('grid' in value) {
    assertRecord(value.grid, '그리드');
    const { cols, rows, buttonSize, gap } = value.grid;
    if (
      !Number.isInteger(cols) ||
      Number(cols) < 2 ||
      Number(cols) > 8 ||
      !Number.isInteger(rows) ||
      Number(rows) < 1 ||
      Number(rows) > 6 ||
      !Number.isInteger(buttonSize) ||
      Number(buttonSize) < 64 ||
      Number(buttonSize) > 140 ||
      !Number.isInteger(gap) ||
      Number(gap) < 0 ||
      Number(gap) > 32
    ) {
      throw new TypeError('그리드 설정 범위를 확인해 주세요.');
    }
  }
  if ('window' in value) {
    assertRecord(value.window, '창');
    const window = value.window;
    if (
      !(
        (window.x === null || Number.isInteger(window.x)) &&
        (window.y === null || Number.isInteger(window.y)) &&
        typeof window.alwaysOnTop === 'boolean' &&
        typeof window.opacity === 'number' &&
        window.opacity >= 0.3 &&
        window.opacity <= 1 &&
        typeof window.locked === 'boolean' &&
        typeof window.hideOnLaunch === 'boolean'
      )
    ) {
      throw new TypeError('창 설정 범위를 확인해 주세요.');
    }
  }
  if ('behavior' in value) {
    assertRecord(value.behavior, '패널 동작');
    const behavior = value.behavior;
    if (
      typeof behavior.hideAfterLaunch !== 'boolean' ||
      !Number.isInteger(behavior.hideAfterLaunchDelayMs) ||
      Number(behavior.hideAfterLaunchDelayMs) < 0 ||
      Number(behavior.hideAfterLaunchDelayMs) > 600 ||
      typeof behavior.edgePeek !== 'boolean' ||
      !['auto', 'right', 'left', 'top', 'bottom'].includes(String(behavior.peekEdge)) ||
      !Number.isInteger(behavior.peekThickness) ||
      Number(behavior.peekThickness) < 4 ||
      Number(behavior.peekThickness) > 12 ||
      !Number.isInteger(behavior.peekDelayMs) ||
      Number(behavior.peekDelayMs) < 0 ||
      Number(behavior.peekDelayMs) > 600 ||
      typeof behavior.idleFade !== 'boolean' ||
      !Number.isInteger(behavior.idleFadeAfterMs) ||
      Number(behavior.idleFadeAfterMs) < 1_000 ||
      Number(behavior.idleFadeAfterMs) > 15_000 ||
      typeof behavior.idleOpacity !== 'number' ||
      behavior.idleOpacity < 0.1 ||
      behavior.idleOpacity > 0.9
    ) {
      throw new TypeError('패널 동작 설정 범위를 확인해 주세요.');
    }
  }
  if ('keyboard' in value) {
    assertRecord(value.keyboard, '키보드');
    const keyboard = value.keyboard;
    if (
      !['on-focus', 'always', 'never'].includes(String(keyboard.quickHints)) ||
      typeof keyboard.hintKeys !== 'string' ||
      !validateHintKeys(keyboard.hintKeys) ||
      typeof keyboard.hideAfterHotkeyLaunch !== 'boolean' ||
      typeof keyboard.globalNumberHotkeys !== 'boolean' ||
      typeof keyboard.globalNumberModifier !== 'string' ||
      keyboard.globalNumberModifier.length < 1 ||
      keyboard.globalNumberModifier.length > 80 ||
      typeof keyboard.quickLauncher !== 'boolean' ||
      typeof keyboard.quickLauncherHotkey !== 'string' ||
      keyboard.quickLauncherHotkey.length < 1 ||
      keyboard.quickLauncherHotkey.length > 80
    ) {
      throw new TypeError('키보드 설정이 올바르지 않습니다. 힌트 문자는 중복 없이 입력해 주세요.');
    }
  }
  if ('webConnection' in value) {
    assertRecord(value.webConnection, '업무 시스템 직접 연결');
    const connection = value.webConnection;
    if (
      Object.keys(connection).some((key) => ![
        'autoConnectAfterPortalLogin',
        'autoConnectTarget',
      ].includes(key)) ||
      typeof connection.autoConnectAfterPortalLogin !== 'boolean' ||
      !['neis', 'edufine', 'both'].includes(String(connection.autoConnectTarget))
    ) {
      throw new TypeError('업무 시스템 직접 연결 설정이 올바르지 않습니다. 연결할 시스템을 다시 선택해 주세요.');
    }
  }
  if ('approvalMonitor' in value) {
    assertRecord(value.approvalMonitor, '결재 대기 알림');
    const monitor = value.approvalMonitor;
    if (Object.keys(monitor).some((key) => ![
      'sources',
      'intervalMinutes',
      'notifyOnlyOnIncrease',
      'workHours',
    ].includes(key))) {
      throw new TypeError('결재 대기 알림 설정에 허용되지 않은 항목이 있습니다. 설정 화면에서 다시 저장해 주세요.');
    }
    assertRecord(monitor.sources, '결재 대기 알림 업무');
    if (Object.keys(monitor.sources).some((key) => key !== 'neis' && key !== 'edufine')) {
      throw new TypeError('결재 대기 알림 업무 시스템이 올바르지 않습니다. 나이스나 에듀파인을 선택해 주세요.');
    }
    for (const source of [monitor.sources.neis, monitor.sources.edufine]) {
      assertRecord(source, '결재 대기 알림 업무');
      if (
        Object.keys(source).some((key) => key !== 'enabled' && key !== 'browserId') ||
        typeof source.enabled !== 'boolean' ||
        (source.browserId !== 'edge' && source.browserId !== 'chrome')
      ) {
        throw new TypeError('결재 대기 알림 브라우저 설정이 올바르지 않습니다. 엣지나 크롬을 선택해 주세요.');
      }
    }
    assertRecord(monitor.workHours, '결재 대기 알림 근무 시간');
    if (
      Object.keys(monitor.workHours).some((key) => !['enabled', 'start', 'end'].includes(key)) ||
      typeof monitor.workHours.enabled !== 'boolean' ||
      typeof monitor.workHours.start !== 'string' ||
      typeof monitor.workHours.end !== 'string' ||
      ![5, 10, 30].includes(Number(monitor.intervalMinutes)) ||
      typeof monitor.notifyOnlyOnIncrease !== 'boolean'
    ) {
      throw new TypeError('결재 대기 알림 설정 값이 올바르지 않습니다. 확인 주기와 근무 시간을 다시 선택해 주세요.');
    }
  }
  if ('root' in value && !Array.isArray(value.root)) throw new TypeError('키 목록이 올바르지 않습니다.');
}

export function assertEditorOpenInput(
  value: unknown,
): asserts value is { path?: string[]; slot?: number } {
  assertRecord(value, '편집기');
  if (
    Object.keys(value).some((key) => !['path', 'slot'].includes(key)) ||
    ('path' in value &&
      (!Array.isArray(value.path) || value.path.some((id) => typeof id !== 'string'))) ||
    ('slot' in value && (!Number.isInteger(value.slot) || Number(value.slot) < 0))
  ) {
    throw new TypeError('편집기 위치가 올바르지 않습니다.');
  }
}

export function assertDeckReferenceInput(
  value: unknown,
): asserts value is { path: string[]; id: string } {
  assertRecord(value, '키');
  if (
    !Array.isArray(value.path) ||
    value.path.some((id) => typeof id !== 'string' || id.length > 100) ||
    typeof value.id !== 'string' ||
    value.id.length < 1 ||
    value.id.length > 100
  ) {
    throw new TypeError('키 위치가 올바르지 않습니다.');
  }
}

export function assertLaunchInput(
  value: unknown,
): asserts value is { path: string[]; id: string; keepOpen?: boolean } {
  assertDeckReferenceInput(value);
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !['path', 'id', 'keepOpen'].includes(key)) ||
    ('keepOpen' in input && typeof input.keepOpen !== 'boolean')
  ) {
    throw new TypeError('실행할 키 위치나 패널 유지 값이 올바르지 않습니다.');
  }
}

export function assertMultiActionCancelInput(
  value: unknown,
): asserts value is { itemId: string } {
  assertRecord(value, '멀티 액션 취소');
  if (
    Object.keys(value).some((key) => key !== 'itemId') ||
    typeof value.itemId !== 'string' ||
    value.itemId.length < 1 ||
    value.itemId.length > 100
  ) {
    throw new TypeError('멀티 액션 취소 요청이 올바르지 않습니다. 패널을 다시 열어 주세요.');
  }
}

export function assertDeckUpsertInput(
  value: unknown,
): asserts value is { path: string[]; item: DeckItem } {
  assertRecord(value, '키 저장');
  if (!Array.isArray(value.path) || value.path.some((id) => typeof id !== 'string')) {
    throw new TypeError('키 저장 위치가 올바르지 않습니다.');
  }
  assertRecord(value.item, '키');
}

export function assertDeckMoveInput(value: unknown): asserts value is {
  from: { path: string[]; id: string };
  to: { path: string[]; position: number };
} {
  assertRecord(value, '키 이동');
  assertDeckReferenceInput(value.from);
  assertRecord(value.to, '이동 위치');
  if (
    !Array.isArray(value.to.path) ||
    value.to.path.some((id) => typeof id !== 'string') ||
    !Number.isInteger(value.to.position) ||
    Number(value.to.position) < 0
  ) {
    throw new TypeError('키 이동 위치가 올바르지 않습니다.');
  }
}

export function assertDropClassifyInput(
  value: unknown,
): asserts value is { paths: string[]; text?: string } {
  assertRecord(value, '드롭');
  if (
    !Array.isArray(value.paths) ||
    value.paths.length > 50 ||
    value.paths.some(
      (path) =>
        typeof path !== 'string' ||
        path.length < 1 ||
        path.length > 2048 ||
        (!isAbsolute(path) && !win32.isAbsolute(path)) ||
        path.split(/[\\/]+/).includes('..'),
    ) ||
    ('text' in value && (typeof value.text !== 'string' || value.text.length > 4096))
  ) {
    throw new TypeError('드롭한 항목이 너무 많거나 경로가 올바르지 않습니다.');
  }
}

export function assertImportPathInput(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2048 ||
    (!isAbsolute(value) && !win32.isAbsolute(value)) ||
    value.split(/[\\/]+/).includes('..')
  ) {
    throw new TypeError('이미지 경로가 올바르지 않습니다.');
  }
}

export function assertAppsListInput(value: unknown): asserts value is { refresh?: boolean } {
  assertRecord(value, '앱 목록');
  if ('refresh' in value && typeof value.refresh !== 'boolean') {
    throw new TypeError('앱 목록 새로고침 값이 올바르지 않습니다.');
  }
}

export function assertBrowsersListInput(value: unknown): asserts value is { refresh?: boolean } {
  assertRecord(value, '브라우저 목록');
  if (
    Object.keys(value).some((key) => key !== 'refresh') ||
    ('refresh' in value && typeof value.refresh !== 'boolean')
  ) {
    throw new TypeError('브라우저 목록 새로고침 값이 올바르지 않습니다. 다시 시도해 주세요.');
  }
}

export function assertWebConnectorStatusInput(
  value: unknown,
): asserts value is Record<string, never> {
  assertRecord(value, '웹 업무 연결 상태');
  if (Object.keys(value).length > 0) {
    throw new TypeError('웹 업무 연결 상태 요청에는 다른 값을 보낼 수 없습니다.');
  }
}

export function assertWebConnectorBrowserInput(
  value: unknown,
): asserts value is { browserId: 'chrome' | 'edge' } {
  assertRecord(value, '웹 업무 연결 브라우저');
  if (
    Object.keys(value).some((key) => key !== 'browserId') ||
    !['chrome', 'edge'].includes(String(value.browserId))
  ) {
    throw new TypeError('웹 업무 연결 브라우저가 올바르지 않습니다. 엣지나 크롬을 선택해 주세요.');
  }
}

export function assertWebConnectorSetupInput(
  value: unknown,
): asserts value is {
  browserId: 'chrome' | 'edge';
  target: 'pair' | 'connect' | 'folder' | 'extensions';
} {
  assertRecord(value, '웹 업무 연결 설치');
  if (
    Object.keys(value).some((key) => !['browserId', 'target'].includes(key)) ||
    !['chrome', 'edge'].includes(String(value.browserId)) ||
    !['pair', 'connect', 'folder', 'extensions'].includes(String(value.target))
  ) {
    throw new TypeError('웹 업무 연결 설치 요청이 올바르지 않습니다. 브라우저를 다시 선택해 주세요.');
  }
}

export function assertWebConnectorApprovalInput(
  value: unknown,
): asserts value is { system: 'neis' | 'edufine' } {
  assertRecord(value, '결재함 열기');
  if (
    Object.keys(value).some((key) => key !== 'system') ||
    (value.system !== 'neis' && value.system !== 'edufine')
  ) {
    throw new TypeError('결재함 업무 시스템이 올바르지 않습니다. 나이스나 에듀파인을 선택해 주세요.');
  }
}

export function assertApprovalMonitorStatusInput(
  value: unknown,
): asserts value is Record<string, never> {
  assertRecord(value, '결재 대기 알림 상태');
  if (Object.keys(value).length > 0) {
    throw new TypeError('결재 대기 알림 상태 요청에는 다른 값을 보낼 수 없습니다.');
  }
}

export function assertApprovalMonitorCheckInput(
  value: unknown,
): asserts value is { system?: 'neis' | 'edufine' } {
  assertRecord(value, '결재 대기 확인 요청');
  if (Object.keys(value).some((key) => key !== 'system')) {
    throw new TypeError('결재 대기 확인 요청에는 업무 시스템만 지정할 수 있습니다.');
  }
  if ('system' in value && value.system !== 'neis' && value.system !== 'edufine') {
    throw new TypeError('업무 시스템이 올바르지 않습니다. 나이스나 에듀파인을 선택해 주세요.');
  }
}

export function assertIconResolveInput(
  value: unknown,
): asserts value is { type: 'url' | 'folder' | 'file' | 'app' | 'uwp'; target: string } {
  assertRecord(value, '아이콘');
  if (
    !['url', 'folder', 'file', 'app', 'uwp'].includes(String(value.type)) ||
    typeof value.target !== 'string' ||
    value.target.length < 1 ||
    value.target.length > 2048
  ) {
    throw new TypeError('아이콘 대상이 올바르지 않습니다.');
  }
  if (
    value.target.startsWith('icon-file:') &&
    !/^icon-file:[0-9a-f-]+\.png$/i.test(value.target)
  ) {
    throw new TypeError('사용자 아이콘 경로가 올바르지 않습니다.');
  }
}

export function assertRevealPathInput(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 2048 ||
    (!isAbsolute(value) && !win32.isAbsolute(value)) ||
    value.split(/[\\/]+/).includes('..')
  ) {
    throw new TypeError('열 위치가 올바르지 않습니다.');
  }
}

export function assertIdleInput(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError('패널 유휴 상태 값이 올바르지 않습니다. 설정을 다시 확인해 주세요.');
  }
}

export function assertHotkeyValidateInput(
  value: unknown,
): asserts value is { accelerator: string; itemId?: string } {
  assertRecord(value, '전역 단축키');
  if (
    Object.keys(value).some((key) => !['accelerator', 'itemId'].includes(key)) ||
    typeof value.accelerator !== 'string' ||
    value.accelerator.length < 1 ||
    value.accelerator.length > 80 ||
    ('itemId' in value &&
      (typeof value.itemId !== 'string' || value.itemId.length < 1 || value.itemId.length > 100))
  ) {
    throw new TypeError('전역 단축키 입력이 올바르지 않습니다. 키 조합을 다시 입력해 주세요.');
  }
}

export function assertLauncherQueryInput(
  value: unknown,
): asserts value is { text: string } {
  assertRecord(value, '퀵 런처 검색');
  if (
    Object.keys(value).some((key) => key !== 'text') ||
    typeof value.text !== 'string' ||
    value.text.length > 120
  ) {
    throw new TypeError('퀵 런처 검색어가 올바르지 않습니다. 120자 이내로 입력해 주세요.');
  }
}

export function assertLauncherRunInput(
  value: unknown,
): asserts value is { id: string } {
  assertRecord(value, '퀵 런처 항목');
  if (
    Object.keys(value).some((key) => key !== 'id') ||
    typeof value.id !== 'string' ||
    value.id.length < 1 ||
    value.id.length > 100
  ) {
    throw new TypeError('퀵 런처 실행 항목이 올바르지 않습니다. 목록을 다시 열어 주세요.');
  }
}

export function assertLauncherResizeInput(
  value: unknown,
): asserts value is { height: number } {
  assertRecord(value, '퀵 런처 높이');
  if (
    Object.keys(value).some((key) => key !== 'height') ||
    !Number.isInteger(value.height) ||
    Number(value.height) < 64 ||
    Number(value.height) > 512
  ) {
    throw new TypeError('퀵 런처 높이가 올바르지 않습니다. 창을 다시 열어 주세요.');
  }
}

export function assertNoInput(value: unknown): asserts value is undefined {
  if (value !== undefined) throw new TypeError('이 동작에는 입력값을 보낼 수 없습니다.');
}
