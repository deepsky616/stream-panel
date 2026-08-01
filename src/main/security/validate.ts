import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, normalize, win32 } from 'node:path';
import type { Stats } from 'node:fs';
import type { ActionItem, AppConfig, DeckItem, IconSpec } from '../../shared/types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const BLOCKED_PROTOCOLS = new Set([
  'file:',
  'javascript:',
  'data:',
  'vbscript:',
  'ms-msdt:',
  'search-ms:',
]);

export function validateUrl(target: string): URL {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new ValidationError('주소 형식이 올바르지 않습니다. 전체 주소를 확인해 주세요.');
  }
  if (BLOCKED_PROTOCOLS.has(url.protocol)) {
    throw new ValidationError('보안을 위해 이 주소 형식은 열 수 없습니다.');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new ValidationError('현재 http, https, mailto 링크만 지원합니다.');
  }
  return url;
}

function isAbsoluteOnSupportedPlatform(target: string): boolean {
  return isAbsolute(target) || win32.isAbsolute(target);
}

function hasTraversalSegment(target: string): boolean {
  return target.split(/[\\/]+/).includes('..');
}

function normalizeSupportedPath(target: string): string {
  return win32.isAbsolute(target) ? win32.normalize(target) : normalize(target);
}

export interface PathValidationDependencies {
  exists: (target: string) => boolean;
  stat: (target: string) => Pick<Stats, 'isDirectory'>;
}

const defaultPathDependencies: PathValidationDependencies = {
  exists: existsSync,
  stat: statSync,
};

export function validatePathTarget(
  item: ActionItem,
  dependencies: PathValidationDependencies = defaultPathDependencies,
): string {
  if (!isAbsoluteOnSupportedPlatform(item.target) || hasTraversalSegment(item.target)) {
    throw new ValidationError('상대 경로나 상위 폴더 이동이 포함된 경로는 사용할 수 없습니다.');
  }
  const normalized = normalizeSupportedPath(item.target);
  if (!isAbsoluteOnSupportedPlatform(normalized) || hasTraversalSegment(normalized)) {
    throw new ValidationError('경로를 안전하게 해석할 수 없습니다.');
  }
  if (item.type === 'app' && !['.exe', '.bat', '.cmd'].includes(extname(normalized).toLowerCase())) {
    throw new ValidationError('앱은 exe, bat, cmd 파일만 등록할 수 있습니다.');
  }
  if (dependencies.exists(normalized)) {
    const directory = dependencies.stat(normalized).isDirectory();
    if (item.type === 'folder' && !directory) {
      throw new ValidationError('선택한 대상은 폴더가 아닙니다.');
    }
    if ((item.type === 'file' || item.type === 'app') && directory) {
      throw new ValidationError('선택한 대상은 파일이 아닙니다.');
    }
  }
  return normalized;
}

function validateIcon(icon: IconSpec): void {
  if (!icon || typeof icon !== 'object') throw new ValidationError('아이콘 설정이 올바르지 않습니다.');
  if (icon.kind === 'auto') return;
  if (icon.kind === 'emoji' && Array.from(icon.value).length >= 1 && icon.value.length <= 32) return;
  if (icon.kind === 'file' && icon.path.length >= 1 && icon.path.length <= 255) return;
  if (icon.kind === 'letter' && Array.from(icon.value).length >= 1 && Array.from(icon.value).length <= 2) {
    return;
  }
  throw new ValidationError('아이콘 설정이 올바르지 않습니다.');
}

export function validateDeckItemShallow(item: DeckItem): void {
  if (!item || typeof item !== 'object') throw new ValidationError('키 자료가 올바르지 않습니다.');
  if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 100) {
    throw new ValidationError('키 식별자가 올바르지 않습니다.');
  }
  const labelLength = typeof item.label === 'string' ? Array.from(item.label).length : 0;
  if (labelLength < 1 || labelLength > 24) {
    throw new ValidationError('제목은 1자부터 24자까지 입력해 주세요.');
  }
  if (typeof item.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(item.color)) {
    throw new ValidationError('색상은 여섯 자리 색상값으로 입력해 주세요.');
  }
  if (!Number.isInteger(item.position) || item.position < 0) {
    throw new ValidationError('키 위치가 올바르지 않습니다.');
  }
  validateIcon(item.icon);
  if (item.kind === 'folder') {
    if (!Array.isArray(item.children)) throw new ValidationError('폴더 내용이 올바르지 않습니다.');
    return;
  }
  if (!['url', 'folder', 'file', 'app', 'uwp'].includes(item.type)) {
    throw new ValidationError('지원하지 않는 실행 종류입니다.');
  }
  if (typeof item.target !== 'string' || item.target.length > 2048) {
    throw new ValidationError('대상은 2048자 이내로 입력해 주세요.');
  }
  if (!Array.isArray(item.args) || item.args.length > 16) {
    throw new ValidationError('실행 인자는 16개까지 사용할 수 있습니다.');
  }
  if (item.args.some((argument) => typeof argument !== 'string' || argument.length > 512)) {
    throw new ValidationError('각 실행 인자는 512자 이내로 입력해 주세요.');
  }
  if (item.workingDir !== undefined && typeof item.workingDir !== 'string') {
    throw new ValidationError('작업 폴더가 올바르지 않습니다.');
  }
}

export function validateActionTarget(item: ActionItem): void {
  validateDeckItemShallow(item);
  if (item.type === 'url') {
    validateUrl(item.target);
  } else if (item.type === 'uwp') {
    if (!item.target.includes('!')) throw new ValidationError('스토어 앱 식별자가 올바르지 않습니다.');
  } else {
    validatePathTarget(item);
  }
}

export function validateDeck(items: readonly DeckItem[]): void {
  const ids = new Set<string>();
  const objects = new WeakSet<object>();
  let total = 0;

  const visit = (level: readonly DeckItem[], depth: number): void => {
    if (!Array.isArray(level) || level.length > 120) {
      throw new ValidationError('한 폴더에는 키를 120개까지 둘 수 있습니다.');
    }
    const positions = new Set<number>();
    for (const item of level) {
      total += 1;
      if (total > 500) throw new ValidationError('전체 키는 500개까지 만들 수 있습니다.');
      validateDeckItemShallow(item);
      if (ids.has(item.id)) throw new ValidationError('중복된 키 식별자가 있습니다.');
      ids.add(item.id);
      if (positions.has(item.position)) throw new ValidationError('같은 위치에 여러 키를 둘 수 없습니다.');
      positions.add(item.position);
      if (objects.has(item)) throw new ValidationError('폴더 순환 구조는 저장할 수 없습니다.');
      objects.add(item);
      if (item.kind === 'folder') {
        if (depth + 1 > 5) throw new ValidationError('폴더는 다섯 단계까지 만들 수 있습니다.');
        visit(item.children, depth + 1);
      } else if (item.target !== '') {
        validateActionTarget(item);
      }
    }
  };

  visit(items, 0);
}

export function validateAppConfig(config: AppConfig): void {
  if (config.version !== 1) throw new ValidationError('지원하지 않는 설정 버전입니다.');
  if (
    !Number.isInteger(config.grid.cols) ||
    config.grid.cols < 2 ||
    config.grid.cols > 8 ||
    !Number.isInteger(config.grid.rows) ||
    config.grid.rows < 1 ||
    config.grid.rows > 6 ||
    !Number.isInteger(config.grid.buttonSize) ||
    config.grid.buttonSize < 64 ||
    config.grid.buttonSize > 140 ||
    !Number.isInteger(config.grid.gap) ||
    config.grid.gap < 0 ||
    config.grid.gap > 32
  ) {
    throw new ValidationError('그리드 설정 범위를 확인해 주세요.');
  }
  if (
    !['dark', 'light', 'system'].includes(config.theme) ||
    typeof config.hotkey !== 'string' ||
    config.hotkey.length > 80 ||
    typeof config.launchAtLogin !== 'boolean' ||
    typeof config.autoUpdate !== 'boolean'
  ) {
    throw new ValidationError('앱 설정이 올바르지 않습니다.');
  }
  if (
    !(
      (config.window.x === null || Number.isInteger(config.window.x)) &&
      (config.window.y === null || Number.isInteger(config.window.y)) &&
      typeof config.window.alwaysOnTop === 'boolean' &&
      typeof config.window.opacity === 'number' &&
      config.window.opacity >= 0.3 &&
      config.window.opacity <= 1 &&
      typeof config.window.locked === 'boolean' &&
      typeof config.window.hideOnLaunch === 'boolean'
    )
  ) {
    throw new ValidationError('창 설정이 올바르지 않습니다.');
  }
  validateDeck(config.root);
}
