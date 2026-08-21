import { describe, expect, it, vi } from 'vitest';
import type { ActionItem, DeckItem } from '../src/shared/types';
import { createDefaultConfig } from '../src/shared/defaults';
import {
  validateActionTarget,
  validateAppConfig,
  validateDeck,
  validateDeckItemShallow,
  validateGlobalHotkey,
  validatePathTarget,
  validateUrl,
} from '../src/main/security/validate';
import {
  assertLauncherQueryInput,
  assertLauncherResizeInput,
  assertLauncherRunInput,
  assertNoInput,
  assertBrowsersListInput,
  assertMultiActionCancelInput,
} from '../src/main/security/inputValidation';
import * as inputValidation from '../src/main/security/inputValidation';
import {
  getExecutableDialogOptions,
  resolveExecutableSelection,
} from '../src/main/services/executablePicker';

function action(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    id: 'item',
    kind: 'action',
    type: 'url',
    target: 'https://example.com',
    args: [],
    label: '시험',
    icon: { kind: 'auto' },
    color: '#5B8CFF',
    position: 0,
    ...overrides,
  };
}

describe('security validation', () => {
  it('allows only the documented URL protocols', () => {
    expect(validateUrl('https://example.com').protocol).toBe('https:');
    expect(validateUrl('mailto:test@example.com').protocol).toBe('mailto:');
    expect(() => validateUrl('javascript:alert(1)')).toThrow(/보안/);
    expect(() => validateUrl('file:///tmp/a')).toThrow(/보안/);
    expect(() => validateUrl('spotify:track')).toThrow(/현재/);
  });

  it('rejects relative paths and traversal segments', () => {
    const relative = action({ type: 'file', target: 'notes.txt' });
    expect(() => validatePathTarget(relative)).toThrow(/상대 경로/);
    const traversal = action({ type: 'file', target: '/tmp/folder/../secret.txt' });
    expect(() => validatePathTarget(traversal)).toThrow(/상대 경로/);
  });

  it('validates path kinds and app extensions without requiring a real file', () => {
    const dependencies = {
      exists: () => true,
      stat: () => ({ isDirectory: () => true }),
    };
    expect(() => validatePathTarget(action({ type: 'folder', target: '/tmp/folder' }), dependencies)).not.toThrow();
    expect(() => validatePathTarget(action({ type: 'file', target: '/tmp/folder' }), dependencies)).toThrow(/파일/);
    expect(() =>
      validateActionTarget(action({ type: 'app', target: 'C:\\tmp\\app.sh' }), 'win32'),
    ).toThrow(/exe/);
  });

  it('applies Windows and macOS app rules with an injected platform', () => {
    const directory = {
      exists: () => true,
      stat: () => ({ isDirectory: () => true }),
      canExecute: () => false,
    };
    const executable = {
      exists: () => true,
      stat: () => ({ isDirectory: () => false }),
      canExecute: () => true,
    };

    expect(() =>
      validatePathTarget(action({ type: 'app', target: 'C:\\Tools\\tool.exe' }), executable, 'win32'),
    ).not.toThrow();
    expect(() =>
      validatePathTarget(action({ type: 'app', target: 'C:\\Tools\\tool.app' }), executable, 'win32'),
    ).toThrow(/exe/);
    expect(() =>
      validatePathTarget(action({ type: 'app', target: '/Applications/Tool.app' }), directory, 'darwin'),
    ).not.toThrow();
    expect(() =>
      validatePathTarget(action({ type: 'folder', target: '/Applications/Tool.app' }), directory, 'darwin'),
    ).toThrow(/앱/);
    expect(() =>
      validatePathTarget(action({ type: 'app', target: '/usr/local/bin/tool' }), executable, 'darwin'),
    ).not.toThrow();
    expect(() =>
      validatePathTarget(
        action({ type: 'app', target: '/usr/local/bin/tool' }),
        { ...executable, canExecute: () => false },
        'darwin',
      ),
    ).toThrow(/실행 권한/);
    expect(() =>
      validateActionTarget(action({ type: 'uwp', target: 'Example.App!Main' }), 'darwin'),
    ).toThrow(/Windows/);
  });

  it('limits labels, arguments, target length, and colors', () => {
    expect(() => validateDeckItemShallow(action({ label: '' }))).toThrow(/제목/);
    expect(() => validateDeckItemShallow(action({ label: '가'.repeat(25) }))).toThrow(/24/);
    expect(() => validateDeckItemShallow(action({ args: Array(17).fill('a') }))).toThrow(/16/);
    expect(() => validateDeckItemShallow(action({ args: ['a'.repeat(513)] }))).toThrow(/512/);
    expect(() => validateDeckItemShallow(action({ target: 'a'.repeat(2049) }))).toThrow(/2048/);
    expect(() => validateDeckItemShallow(action({ color: 'red' }))).toThrow(/색상/);
  });

  it('accepts only safe browser paths and generated-profile settings on URL actions', () => {
    const selectedBrowser = {
      path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      profileDir: 'Profile 1',
      appMode: true,
    };
    expect(() =>
      validateActionTarget(action({ browser: selectedBrowser }), 'win32'),
    ).not.toThrow();
    expect(() =>
      validateActionTarget(
        action({ browser: { ...selectedBrowser, path: 'chrome.exe' } }),
        'win32',
      ),
    ).toThrow(/브라우저/);
    expect(() =>
      validateActionTarget(
        action({ browser: { ...selectedBrowser, profileDir: '../Default' } }),
        'win32',
      ),
    ).toThrow(/프로필/);
    expect(() =>
      validateDeckItemShallow(
        action({ type: 'file', target: '/tmp/page.html', browser: selectedBrowser }),
      ),
    ).toThrow(/웹사이트/);
  });

  it('allows only validated web workflows on their matching secure work sites and browsers', () => {
    const edge = {
      path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      profileDir: 'Default',
      appMode: false,
    };
    const leave = action({
      target: 'https://goe.neis.go.kr',
      browser: edge,
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    } as Partial<ActionItem>);

    expect(() => validateActionTarget(leave, 'win32')).not.toThrow();
    expect(() =>
      validateActionTarget(
        { ...leave, target: 'https://klef.goe.go.kr' },
        'win32',
      ),
    ).toThrow(/나이스/);
    expect(() =>
      validateActionTarget(
        {
          ...leave,
          webWorkflow: { id: 'edufine-draft', browserId: 'edge' },
        } as ActionItem,
        'win32',
      ),
    ).toThrow(/에듀파인/);
    expect(() =>
      validateDeckItemShallow(
        {
          ...leave,
          webWorkflow: { id: 'run-any-script', browserId: 'edge' },
        } as unknown as ActionItem,
      ),
    ).toThrow(/웹 업무/);
    expect(() =>
      validateActionTarget(
        {
          ...leave,
          webWorkflow: { id: 'neis-leave', browserId: 'chrome' },
        } as ActionItem,
        'win32',
      ),
    ).toThrow(/브라우저/);
    expect(() =>
      validateDeckItemShallow(
        action({
          type: 'file',
          target: 'C:\\report.txt',
          webWorkflow: { id: 'neis-leave', browserId: 'edge' },
        } as Partial<ActionItem>),
      ),
    ).toThrow(/웹사이트/);

    const customSpec = {
      id: 'custom' as const,
      browserId: 'edge' as const,
      custom: {
        name: '에듀파인 문서함',
        system: 'edufine' as const,
        steps: [{ id: 'step-1', label: '내 문서함' }],
        finalText: '내 문서함 목록',
      },
    };
    const custom: ActionItem = {
      ...leave,
      id: 'custom-documents',
      label: '에듀파인 문서함',
      target: 'https://klef.goe.go.kr/',
      webWorkflow: customSpec,
    };
    expect(() => validateActionTarget(custom, 'win32')).not.toThrow();
    expect(() => validateActionTarget({
      ...custom,
      target: 'https://goe.neis.go.kr/',
    }, 'win32')).toThrow(/에듀파인/);
    expect(() => validateDeckItemShallow({
      ...custom,
      webWorkflow: {
        ...customSpec,
        custom: {
          ...customSpec.custom,
          steps: [{ id: 'step-1', label: '결재 요청' }],
        },
      },
    } as ActionItem)).toThrow(/웹 업무/);
  });

  it('validates multi-action steps, references, and delay limits', () => {
    const referenced = action({ id: 'open-site', position: 1, label: '사이트 열기' });
    const valid = action({
      id: 'morning',
      type: 'multi',
      target: '',
      label: '아침 준비',
      multiAction: {
        steps: [
          { id: 'step-1', kind: 'action', actionId: 'open-site' },
          { id: 'step-2', kind: 'delay', delayMs: 1_000 },
        ],
      },
    });

    expect(() => validateDeck([valid, referenced], 'darwin')).not.toThrow();
    expect(() => validateActionTarget(action({
      ...valid,
      multiAction: { steps: [] },
    }), 'darwin')).toThrow(/단계/);
    expect(() => validateDeck([
      { ...valid, multiAction: { steps: [{ id: 'step-1', kind: 'action', actionId: 'missing' }] } },
      referenced,
    ], 'darwin')).toThrow(/찾을 수/);
    expect(() => validateDeck([
      valid,
      { ...valid, id: 'nested', position: 2, multiAction: {
        steps: [{ id: 'nested-step', kind: 'action', actionId: 'morning' }],
      } },
      referenced,
    ], 'darwin')).toThrow(/다른 멀티 액션/);
    expect(() => validateDeck([
      { ...valid, multiAction: { steps: Array.from({ length: 21 }, (_, index) => ({
        id: `step-${index}`,
        kind: 'delay' as const,
        delayMs: 0,
      })) } },
      referenced,
    ], 'darwin')).toThrow(/20/);
    expect(() => validateDeck([
      { ...valid, multiAction: { steps: [
        { id: 'step-1', kind: 'delay', delayMs: 30_000 },
        { id: 'step-2', kind: 'delay', delayMs: 30_001 },
      ] } },
      referenced,
    ], 'darwin')).toThrow(/60초/);
  });

  it('enforces layer, depth, and total item limits', () => {
    const layer = Array.from({ length: 121 }, (_, index) => action({ id: `id-${index}`, position: index }));
    expect(() => validateDeck(layer)).toThrow(/120/);

    let nested: DeckItem = {
      id: 'bottom',
      kind: 'folder',
      label: '폴더',
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      children: [],
    };
    for (let depth = 0; depth < 5; depth += 1) {
      nested = { ...nested, id: `folder-${depth}`, children: [nested] };
    }
    expect(() => validateDeck([nested])).toThrow(/다섯 단계/);

    const roots = Array.from({ length: 5 }, (_, rootIndex) => ({
      id: `root-${rootIndex}`,
      kind: 'folder' as const,
      label: '묶음',
      icon: { kind: 'auto' as const },
      color: '#5B8CFF',
      position: rootIndex,
      children: Array.from({ length: 100 }, (_, index) =>
        action({ id: `item-${rootIndex}-${index}`, position: index }),
      ),
    }));
    expect(() => validateDeck(roots)).toThrow(/500/);
  });

  it('rejects unsafe, duplicate, and excessive per-key global hotkeys', () => {
    expect(validateGlobalHotkey('G')).toMatchObject({ ok: false, reason: expect.stringMatching(/수식키/) });
    expect(validateGlobalHotkey('Shift+G')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Shift/),
    });
    expect(
      validateGlobalHotkey('Control+Alt+G', {
        conflicts: [{ accelerator: 'CommandOrControl+Alt+G', label: '개발 폴더' }],
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/개발 폴더/) });
    expect(validateGlobalHotkey('CommandOrControl+Alt+G', { assignedCount: 20 })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/20개/),
    });
    expect(validateGlobalHotkey('Control+Alt+G')).toEqual({
      ok: true,
      accelerator: 'CommandOrControl+Alt+G',
    });
  });

  it('accepts platform number defaults and rejects unsafe quick-launcher settings', () => {
    const paths = { downloads: '/tmp/Downloads', documents: '/tmp/Documents' };
    const mac = createDefaultConfig(paths, () => crypto.randomUUID(), 'darwin');
    const windows = createDefaultConfig(paths, () => crypto.randomUUID(), 'win32');

    expect(() => validateAppConfig(mac)).not.toThrow();
    expect(() => validateAppConfig(windows)).not.toThrow();
    expect(() =>
      validateAppConfig({
        ...mac,
        keyboard: {
          ...mac.keyboard,
          quickLauncherHotkey: 'CommandOrControl+Alt+1',
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateAppConfig({
        ...mac,
        keyboard: { ...mac.keyboard, quickLauncherHotkey: 'Space' },
      }),
    ).toThrow(/퀵 런처/);
    expect(() =>
      validateAppConfig({
        ...mac,
        keyboard: { ...mac.keyboard, quickLauncher: 'yes' as unknown as boolean },
      }),
    ).toThrow(/키보드/);
    expect(() =>
      validateAppConfig({
        ...mac,
        educationOfficeCode: 'wrong' as typeof mac.educationOfficeCode,
      }),
    ).toThrow(/교육청/);
    expect(() => inputValidation.assertConfigPatch({ educationOfficeCode: 'sen' })).not.toThrow();
    expect(() => inputValidation.assertConfigPatch({ educationOfficeCode: 'wrong' })).toThrow(
      /교육청/,
    );
    expect(() => inputValidation.assertConfigPatch({
      webConnection: {
        autoConnectAfterPortalLogin: true,
        autoConnectTarget: 'both',
        sessionKeepAlive: { neis: true, edufine: true },
      },
    })).not.toThrow();
    expect(() => inputValidation.assertConfigPatch({
      webConnection: {
        autoConnectAfterPortalLogin: true,
        autoConnectTarget: 'all',
        sessionKeepAlive: { neis: true, edufine: true },
      },
    })).toThrow(/직접 연결/);
  });

  it('validates every quick-launcher IPC payload and rejects extra fields', () => {
    expect(() => assertLauncherQueryInput({ text: '개발' })).not.toThrow();
    expect(() => assertLauncherQueryInput({ text: '가'.repeat(121) })).toThrow(/검색어/);
    expect(() => assertLauncherRunInput({ id: 'action-id' })).not.toThrow();
    expect(() => assertLauncherRunInput({ id: 'action-id', path: [] })).toThrow(/항목/);
    expect(() => assertLauncherResizeInput({ height: 512 })).not.toThrow();
    expect(() => assertLauncherResizeInput({ height: 513 })).toThrow(/높이/);
    expect(() => assertNoInput(undefined)).not.toThrow();
    expect(() => assertNoInput({})).toThrow(/입력/);
    expect(() => assertBrowsersListInput({ refresh: true })).not.toThrow();
    expect(() => assertBrowsersListInput({ refresh: 'yes' })).toThrow(/브라우저/);
  });

  it('validates multi-action cancellation input', () => {
    expect(() => assertMultiActionCancelInput({ itemId: 'multi-id' })).not.toThrow();
    expect(() => assertMultiActionCancelInput({ itemId: '' })).toThrow(/멀티 액션/);
    expect(() => assertMultiActionCancelInput({ itemId: 'multi-id', force: true })).toThrow(
      /멀티 액션/,
    );
  });

  it('validates every web connector IPC payload before handling it', () => {
    const validators = inputValidation as typeof inputValidation & {
      assertWebConnectorStatusInput(value: unknown): asserts value is Record<string, never>;
      assertWebConnectorBrowserInput(value: unknown): asserts value is { browserId: 'chrome' | 'edge' };
      assertWebConnectorSetupInput(value: unknown): asserts value is {
        browserId: 'chrome' | 'edge';
        target: 'pair' | 'connect' | 'folder' | 'extensions';
      };
    };
    expect(() => validators.assertWebConnectorStatusInput({})).not.toThrow();
    expect(() => validators.assertWebConnectorStatusInput({ browserId: 'edge' })).toThrow(/연결 상태/);
    expect(() => validators.assertWebConnectorBrowserInput({ browserId: 'edge' })).not.toThrow();
    expect(() => validators.assertWebConnectorBrowserInput({ browserId: 'safari' })).toThrow(/브라우저/);
    expect(() =>
      validators.assertWebConnectorSetupInput({ browserId: 'chrome', target: 'pair' }),
    ).not.toThrow();
    expect(() =>
      validators.assertWebConnectorSetupInput({ browserId: 'edge', target: 'connect' }),
    ).not.toThrow();
    expect(() =>
      validators.assertWebConnectorSetupInput({ browserId: 'chrome', target: 'pair', command: 'run' }),
    ).toThrow(/설치/);
  });
});

describe('executable picker', () => {
  it('offers Windows shortcuts only on Windows and app bundles on macOS', () => {
    expect(getExecutableDialogOptions('win32')?.filters?.[0].extensions).toEqual(['exe', 'lnk']);
    expect(getExecutableDialogOptions('darwin')).toEqual({ properties: ['openFile'] });
    expect(getExecutableDialogOptions('linux')).toBeNull();
  });

  it('resolves Windows shortcuts through an injected reader', () => {
    const readShortcutLink = vi.fn(() => ({
      target: 'C:\\Tools\\tool.exe',
      args: '--safe "한글 값"',
      cwd: 'C:\\Tools',
    }));
    expect(
      resolveExecutableSelection('C:\\Menu\\Tool.lnk', 'win32', { readShortcutLink }),
    ).toEqual({
      target: 'C:\\Tools\\tool.exe',
      args: ['--safe', '한글 값'],
      workingDir: 'C:\\Tools',
      name: 'Tool',
    });
    expect(readShortcutLink).toHaveBeenCalledOnce();
  });

  it('resolves macOS app bundles without calling Windows APIs', () => {
    const readShortcutLink = vi.fn();
    expect(
      resolveExecutableSelection('/Applications/Tool.app', 'darwin', { readShortcutLink }),
    ).toEqual({
      target: '/Applications/Tool.app',
      args: [],
      workingDir: '/Applications',
      name: 'Tool',
    });
    expect(readShortcutLink).not.toHaveBeenCalled();
  });
});
