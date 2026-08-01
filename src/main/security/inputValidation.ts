import { isAbsolute, win32 } from 'node:path';
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
    'root',
    'grid',
    'window',
    'theme',
    'hotkey',
    'launchAtLogin',
    'autoUpdate',
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError('허용되지 않은 설정 항목입니다.');
  }
  if ('version' in value && value.version !== 1) throw new TypeError('지원하지 않는 설정 버전입니다.');
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
