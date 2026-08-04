import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, normalize, win32 } from 'node:path';
import type { Stats } from 'node:fs';
import { buildNumberAccelerators, normalizeAccelerator } from '../../shared/accelerator';
import { isEducationOfficeCode } from '../../shared/educationOffices';
import { validateHintKeys } from '../../shared/hintMap';
import type {
  ActionItem,
  AppConfig,
  DeckItem,
  IconSpec,
  MultiActionSpec,
} from '../../shared/types';
import {
  browserIdFromPath,
  getWebWorkflowDefinition,
  isAllowedWebWorkflowTarget,
  isWebWorkflowSpec,
} from '../../shared/webWorkflows';
import { isValidProfileDirectory } from '../services/browserService/flags';

export interface GlobalHotkeyConflict {
  accelerator: string;
  label: string;
}

export interface GlobalHotkeyValidationOptions {
  conflicts?: readonly GlobalHotkeyConflict[];
  reserved?: readonly string[];
  assignedCount?: number;
}

export type GlobalHotkeyValidationResult =
  | { ok: true; accelerator: string }
  | { ok: false; reason: string };

export function validateGlobalHotkey(
  input: string,
  {
    conflicts = [],
    reserved = [],
    assignedCount = 0,
  }: GlobalHotkeyValidationOptions = {},
): GlobalHotkeyValidationResult {
  const accelerator = normalizeAccelerator(input);
  const tokens = accelerator.split('+').map((token) => token.trim()).filter(Boolean);
  const modifierSet = new Set(['CommandOrControl', 'Alt', 'Shift', 'Super']);
  const modifiers = tokens.filter((token) => modifierSet.has(token));
  const keys = tokens.filter((token) => !modifierSet.has(token));
  if (modifiers.length === 0 || keys.length !== 1) {
    return { ok: false, reason: '수식키와 일반 키 하나를 함께 눌러 주세요.' };
  }
  if (modifiers.length === 1 && modifiers[0] === 'Shift') {
    return { ok: false, reason: 'Shift만 쓴 조합은 대문자 입력을 막으므로 등록할 수 없습니다.' };
  }
  if (assignedCount >= 20) {
    return { ok: false, reason: '키별 전역 단축키는 최대 20개까지 등록할 수 있습니다.' };
  }
  const normalizedLower = accelerator.toLowerCase();
  const conflict = conflicts.find(
    (entry) => normalizeAccelerator(entry.accelerator).toLowerCase() === normalizedLower,
  );
  if (conflict) {
    return { ok: false, reason: `이미 '${conflict.label}' 키가 쓰는 단축키입니다.` };
  }
  if (
    reserved.some(
      (entry) => normalizeAccelerator(entry).toLowerCase() === normalizedLower,
    )
  ) {
    return { ok: false, reason: '패널 또는 전역 숫자 단축키와 겹칩니다.' };
  }
  return { ok: true, accelerator };
}

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

function isAbsoluteOnPlatform(target: string, platform: NodeJS.Platform): boolean {
  if (platform === 'win32') return win32.isAbsolute(target);
  if (platform === 'darwin') return isAbsolute(target);
  return false;
}

function hasTraversalSegment(target: string): boolean {
  return target.split(/[\\/]+/).includes('..');
}

function normalizePlatformPath(target: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? win32.normalize(target) : normalize(target);
}

export interface PathValidationDependencies {
  exists: (target: string) => boolean;
  stat: (target: string) => Pick<Stats, 'isDirectory'>;
  canExecute?: (target: string) => boolean;
}

const defaultPathDependencies: PathValidationDependencies = {
  exists: existsSync,
  stat: statSync,
  canExecute: (target) => {
    try {
      accessSync(target, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
};

export function validatePathTarget(
  item: ActionItem,
  dependencies: PathValidationDependencies = defaultPathDependencies,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!isAbsoluteOnPlatform(item.target, platform) || hasTraversalSegment(item.target)) {
    throw new ValidationError('상대 경로나 상위 폴더 이동이 포함된 경로는 사용할 수 없습니다.');
  }
  const normalized = normalizePlatformPath(item.target, platform);
  if (!isAbsoluteOnPlatform(normalized, platform) || hasTraversalSegment(normalized)) {
    throw new ValidationError('경로를 안전하게 해석할 수 없습니다.');
  }

  const extension =
    platform === 'win32' ? win32.extname(normalized).toLowerCase() : extname(normalized).toLowerCase();
  if (platform === 'darwin' && item.type === 'folder' && extension === '.app') {
    throw new ValidationError('app 묶음은 폴더가 아니라 앱으로 등록해 주세요.');
  }
  if (item.type === 'app' && platform === 'win32' && !['.exe', '.bat', '.cmd'].includes(extension)) {
    throw new ValidationError('Windows 앱은 exe, bat, cmd 파일만 등록할 수 있습니다.');
  }

  if (dependencies.exists(normalized)) {
    const directory = dependencies.stat(normalized).isDirectory();
    if (item.type === 'folder' && !directory) {
      throw new ValidationError('선택한 대상은 폴더가 아닙니다.');
    }
    if (item.type === 'file' && directory) {
      throw new ValidationError('선택한 대상은 파일이 아닙니다.');
    }
    if (item.type === 'app' && platform === 'win32' && directory) {
      throw new ValidationError('선택한 대상은 앱 파일이 아닙니다.');
    }
    if (item.type === 'app' && platform === 'darwin') {
      if (extension === '.app' && !directory) {
        throw new ValidationError('선택한 app 묶음은 폴더 형태가 아닙니다. 다시 선택해 주세요.');
      }
      if (extension !== '.app' && directory) {
        throw new ValidationError('일반 폴더는 앱으로 실행할 수 없습니다. app 묶음을 선택해 주세요.');
      }
      if (extension !== '.app' && !(dependencies.canExecute?.(normalized) ?? false)) {
        throw new ValidationError('선택한 파일에 실행 권한이 없습니다. 권한을 확인해 주세요.');
      }
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

function validateMultiActionSpec(value: unknown): asserts value is MultiActionSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('멀티 액션 설정이 올바르지 않습니다. 편집기에서 다시 만들어 주세요.');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'steps') || !Array.isArray(record.steps)) {
    throw new ValidationError('멀티 액션 단계 목록이 올바르지 않습니다. 편집기에서 다시 만들어 주세요.');
  }
  if (record.steps.length > 20) {
    throw new ValidationError('멀티 액션 단계는 최대 20개까지 추가할 수 있습니다.');
  }
  const ids = new Set<string>();
  let totalDelayMs = 0;
  for (const step of record.steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new ValidationError('멀티 액션 단계 형식이 올바르지 않습니다. 해당 단계를 다시 추가해 주세요.');
    }
    const candidate = step as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      candidate.id.length < 1 ||
      candidate.id.length > 100 ||
      ids.has(candidate.id)
    ) {
      throw new ValidationError('멀티 액션 단계 식별자가 비어 있거나 중복되었습니다. 해당 단계를 다시 추가해 주세요.');
    }
    ids.add(candidate.id);
    if (candidate.kind === 'action') {
      if (
        Object.keys(candidate).some((key) => !['id', 'kind', 'actionId'].includes(key)) ||
        typeof candidate.actionId !== 'string' ||
        candidate.actionId.length < 1 ||
        candidate.actionId.length > 100
      ) {
        throw new ValidationError('멀티 액션 실행 단계가 참조하는 키가 올바르지 않습니다. 다시 선택해 주세요.');
      }
      continue;
    }
    if (candidate.kind === 'delay') {
      if (
        Object.keys(candidate).some((key) => !['id', 'kind', 'delayMs'].includes(key)) ||
        !Number.isInteger(candidate.delayMs) ||
        Number(candidate.delayMs) < 0 ||
        Number(candidate.delayMs) > 60_000
      ) {
        throw new ValidationError('멀티 액션 기다리기는 0초부터 60초까지 지정해 주세요.');
      }
      totalDelayMs += Number(candidate.delayMs);
      if (totalDelayMs > 60_000) {
        throw new ValidationError('멀티 액션의 전체 기다리기 시간은 60초를 넘을 수 없습니다.');
      }
      continue;
    }
    throw new ValidationError('지원하지 않는 멀티 액션 단계입니다. 해당 단계를 다시 추가해 주세요.');
  }
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
  if (
    item.globalHotkey !== undefined &&
    (typeof item.globalHotkey !== 'string' || item.globalHotkey.length < 1 || item.globalHotkey.length > 80)
  ) {
    throw new ValidationError('전역 단축키 값이 올바르지 않습니다. 키 조합을 다시 입력해 주세요.');
  }
  validateIcon(item.icon);
  if (item.kind === 'folder') {
    if (!Array.isArray(item.children)) throw new ValidationError('폴더 내용이 올바르지 않습니다.');
    if (item.globalHotkey) {
      throw new ValidationError('폴더 키에는 전역 단축키를 지정할 수 없습니다. 실행 키에 지정해 주세요.');
    }
    return;
  }
  if (!['url', 'folder', 'file', 'app', 'uwp', 'multi'].includes(item.type)) {
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
  if (item.browser !== undefined && item.type !== 'url') {
    throw new ValidationError('브라우저 지정은 웹사이트 키에만 사용할 수 있습니다.');
  }
  if (item.webWorkflow !== undefined) {
    if (item.type !== 'url') {
      throw new ValidationError('웹 업무 연결은 웹사이트 키에만 사용할 수 있습니다.');
    }
    if (!isWebWorkflowSpec(item.webWorkflow)) {
      throw new ValidationError('웹 업무 연결 설정이 올바르지 않습니다. 목록에서 다시 선택해 주세요.');
    }
    if (item.browser) {
      const browserId = browserIdFromPath(item.browser.path);
      if (browserId !== item.webWorkflow.browserId) {
        throw new ValidationError('웹 업무 연결 브라우저가 선택한 브라우저와 다릅니다. 다시 선택해 주세요.');
      }
    }
  }
  if (item.type === 'multi') {
    if (
      item.target !== '' ||
      item.args.length > 0 ||
      item.workingDir !== undefined ||
      item.browser !== undefined ||
      item.webWorkflow !== undefined
    ) {
      throw new ValidationError('멀티 액션에는 주소, 경로, 실행 인자나 브라우저를 지정할 수 없습니다.');
    }
    validateMultiActionSpec(item.multiAction);
  } else if (item.multiAction !== undefined) {
    throw new ValidationError('멀티 액션 단계는 멀티 액션 키에만 저장할 수 있습니다.');
  }
}

function validateBrowserSpecification(
  item: ActionItem & { browser: NonNullable<ActionItem['browser']> },
  platform: NodeJS.Platform,
): void {
  const browser = item.browser;
  if (
    !browser ||
    typeof browser !== 'object' ||
    Array.isArray(browser) ||
    Object.keys(browser).some((key) => !['path', 'profileDir', 'appMode'].includes(key)) ||
    typeof browser.path !== 'string' ||
    browser.path.length < 1 ||
    browser.path.length > 2048 ||
    typeof browser.appMode !== 'boolean' ||
    (browser.profileDir !== undefined &&
      (typeof browser.profileDir !== 'string' || !isValidProfileDirectory(browser.profileDir)))
  ) {
    throw new ValidationError('브라우저 또는 프로필 설정이 올바르지 않습니다. 목록에서 다시 선택해 주세요.');
  }
  try {
    validatePathTarget(
      { ...item, type: 'app', target: browser.path, browser: undefined },
      { exists: () => false, stat: () => ({ isDirectory: () => false }) },
      platform,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : '경로 형식이 올바르지 않습니다.';
    throw new ValidationError(`브라우저 경로가 안전하지 않습니다. 목록에서 다시 선택해 주세요: ${detail}`);
  }
}

export function validateActionTarget(
  item: ActionItem,
  platform: NodeJS.Platform = process.platform,
): void {
  validateDeckItemShallow(item);
  if (item.type === 'multi') {
    if (!item.multiAction || item.multiAction.steps.length === 0) {
      throw new ValidationError('멀티 액션 단계가 없습니다. 편집기에서 실행 단계를 추가해 주세요.');
    }
  } else if (item.type === 'url') {
    validateUrl(item.target);
    if (item.browser) {
      validateBrowserSpecification(
        item as ActionItem & { browser: NonNullable<ActionItem['browser']> },
        platform,
      );
    }
    if (item.webWorkflow && !isAllowedWebWorkflowTarget(item.webWorkflow.id, item.target)) {
      const definition = getWebWorkflowDefinition(item.webWorkflow.id);
      const systemName = definition.system === 'neis' ? '나이스' : '에듀파인';
      throw new ValidationError(`${systemName} 웹 업무는 허용된 ${systemName} 주소에서만 실행할 수 있습니다.`);
    }
  } else if (item.type === 'uwp') {
    if (platform !== 'win32') {
      throw new ValidationError('이 항목은 Windows에서만 실행할 수 있습니다.');
    }
    if (!item.target.includes('!')) throw new ValidationError('스토어 앱 식별자가 올바르지 않습니다.');
  } else {
    validatePathTarget(item, defaultPathDependencies, platform);
  }
}

export function validateDeck(
  items: readonly DeckItem[],
  platform: NodeJS.Platform = process.platform,
): void {
  const ids = new Set<string>();
  const itemsById = new Map<string, DeckItem>();
  const objects = new WeakSet<object>();
  const hotkeys: GlobalHotkeyConflict[] = [];
  let total = 0;
  let assignedHotkeys = 0;

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
      itemsById.set(item.id, item);
      if (positions.has(item.position)) throw new ValidationError('같은 위치에 여러 키를 둘 수 없습니다.');
      positions.add(item.position);
      if (objects.has(item)) throw new ValidationError('폴더 순환 구조는 저장할 수 없습니다.');
      objects.add(item);
      if (item.kind === 'action' && item.globalHotkey) {
        const result = validateGlobalHotkey(item.globalHotkey, {
          conflicts: hotkeys,
          assignedCount: assignedHotkeys,
        });
        if (!result.ok) throw new ValidationError(result.reason);
        hotkeys.push({ accelerator: result.accelerator, label: item.label });
        assignedHotkeys += 1;
      }
      if (item.kind === 'folder') {
        if (depth + 1 > 5) throw new ValidationError('폴더는 다섯 단계까지 만들 수 있습니다.');
        visit(item.children, depth + 1);
      } else if (item.target !== '') {
        validateActionTarget(item, platform);
      }
    }
  };

  visit(items, 0);
  for (const item of itemsById.values()) {
    if (item.kind !== 'action' || item.type !== 'multi' || !item.multiAction) continue;
    for (const step of item.multiAction.steps) {
      if (step.kind !== 'action') continue;
      const target = itemsById.get(step.actionId);
      if (!target) {
        throw new ValidationError(`멀티 액션이 참조하는 키를 찾을 수 없습니다: ${step.actionId}`);
      }
      if (target.kind !== 'action') {
        throw new ValidationError('멀티 액션에는 실행 키만 넣을 수 있습니다. 폴더 키를 다시 선택해 주세요.');
      }
      if (target.type === 'multi') {
        throw new ValidationError('멀티 액션 안에는 다른 멀티 액션을 넣을 수 없습니다.');
      }
      if (target.target === '') {
        throw new ValidationError(`'${target.label}' 키의 실행 대상이 비어 있습니다. 먼저 해당 키를 완성해 주세요.`);
      }
    }
  }
}

export function validateAppConfig(config: AppConfig): void {
  if (config.version !== 1) throw new ValidationError('지원하지 않는 설정 버전입니다.');
  if (config.platform !== 'win32' && config.platform !== 'darwin') {
    throw new ValidationError('지원하지 않는 운영체제 설정입니다.');
  }
  if (!isEducationOfficeCode(config.educationOfficeCode)) {
    throw new ValidationError('소속 교육청 설정이 올바르지 않습니다. 목록에서 다시 선택해 주세요.');
  }
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
  const panelHotkey = validateGlobalHotkey(config.hotkey);
  if (!panelHotkey.ok) throw new ValidationError(panelHotkey.reason);
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
  if (
    !config.behavior ||
    typeof config.behavior.hideAfterLaunch !== 'boolean' ||
    !Number.isInteger(config.behavior.hideAfterLaunchDelayMs) ||
    config.behavior.hideAfterLaunchDelayMs < 0 ||
    config.behavior.hideAfterLaunchDelayMs > 600 ||
    typeof config.behavior.edgePeek !== 'boolean' ||
    !['auto', 'right', 'left', 'top', 'bottom'].includes(config.behavior.peekEdge) ||
    !Number.isInteger(config.behavior.peekThickness) ||
    config.behavior.peekThickness < 4 ||
    config.behavior.peekThickness > 12 ||
    !Number.isInteger(config.behavior.peekDelayMs) ||
    config.behavior.peekDelayMs < 0 ||
    config.behavior.peekDelayMs > 600 ||
    typeof config.behavior.idleFade !== 'boolean' ||
    !Number.isInteger(config.behavior.idleFadeAfterMs) ||
    config.behavior.idleFadeAfterMs < 1_000 ||
    config.behavior.idleFadeAfterMs > 15_000 ||
    typeof config.behavior.idleOpacity !== 'number' ||
    config.behavior.idleOpacity < 0.1 ||
    config.behavior.idleOpacity > 0.9
  ) {
    throw new ValidationError('패널 동작 설정 범위를 확인해 주세요.');
  }
  if (
    !config.keyboard ||
    !['on-focus', 'always', 'never'].includes(config.keyboard.quickHints) ||
    typeof config.keyboard.hintKeys !== 'string' ||
    !validateHintKeys(config.keyboard.hintKeys) ||
    typeof config.keyboard.hideAfterHotkeyLaunch !== 'boolean' ||
    typeof config.keyboard.globalNumberHotkeys !== 'boolean' ||
    typeof config.keyboard.globalNumberModifier !== 'string' ||
    config.keyboard.globalNumberModifier.length < 1 ||
    config.keyboard.globalNumberModifier.length > 80 ||
    typeof config.keyboard.quickLauncher !== 'boolean' ||
    typeof config.keyboard.quickLauncherHotkey !== 'string' ||
    config.keyboard.quickLauncherHotkey.length < 1 ||
    config.keyboard.quickLauncherHotkey.length > 80
  ) {
    throw new ValidationError('키보드 설정이 올바르지 않습니다. 힌트 문자는 중복 없이 입력해 주세요.');
  }
  const numberModifier = config.keyboard.globalNumberModifier;
  if (
    ![
      'Control+Alt',
      'CommandOrControl+Alt',
      'CommandOrControl+Shift',
      'Alt+Shift',
      'Super+Alt',
    ].includes(numberModifier)
  ) {
    throw new ValidationError('전역 숫자 단축키의 수식키 조합을 다시 선택해 주세요.');
  }
  const quickLauncherValidation = validateGlobalHotkey(config.keyboard.quickLauncherHotkey, {
    reserved: [
      config.hotkey,
      ...(config.keyboard.globalNumberHotkeys
        ? config.platform === 'darwin' && numberModifier === 'Control+Alt'
          ? []
          : buildNumberAccelerators(numberModifier)
        : []),
    ],
  });
  if (!quickLauncherValidation.ok) {
    throw new ValidationError(`퀵 런처 단축키가 올바르지 않습니다. ${quickLauncherValidation.reason}`);
  }
  validateDeck(config.root, config.platform);
  const itemHotkeys: GlobalHotkeyConflict[] = [];
  const collect = (items: readonly DeckItem[]): void => {
    for (const item of items) {
      if (item.kind === 'folder') collect(item.children);
      else if (item.globalHotkey) {
        const validation = validateGlobalHotkey(item.globalHotkey, {
          conflicts: itemHotkeys,
          reserved: [
            config.hotkey,
            config.keyboard.quickLauncherHotkey,
            ...(config.keyboard.globalNumberHotkeys
              ? config.platform === 'darwin' && numberModifier === 'Control+Alt'
                ? []
                : buildNumberAccelerators(numberModifier)
              : []),
          ],
          assignedCount: itemHotkeys.length,
        });
        if (!validation.ok) throw new ValidationError(validation.reason);
        itemHotkeys.push({ accelerator: validation.accelerator, label: item.label });
      }
    }
  };
  collect(config.root);
}
