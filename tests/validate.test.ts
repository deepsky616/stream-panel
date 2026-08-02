import { describe, expect, it, vi } from 'vitest';
import type { ActionItem, DeckItem } from '../src/shared/types';
import {
  validateActionTarget,
  validateDeck,
  validateDeckItemShallow,
  validateGlobalHotkey,
  validatePathTarget,
  validateUrl,
} from '../src/main/security/validate';
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
