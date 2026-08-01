import { describe, expect, it, vi } from 'vitest';
import type { SpawnOptions } from 'node:child_process';
import type { ActionItem, DeckItem } from '../src/shared/types';
import { launchDeckItem, type LauncherDependencies } from '../src/main/services/launcher';
import { createDefaultConfig } from '../src/shared/defaults';
import { createVisibilityService, shouldAutoHideAfterLaunch } from '../src/main/services/visibility';

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

function dependencies(): LauncherDependencies {
  return {
    exists: vi.fn(() => true),
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    spawnProcess: vi.fn(() => ({ unref: vi.fn() })),
  };
}

describe('launcher', () => {
  it('routes URLs and file paths to the matching shell function', async () => {
    const deps = dependencies();
    expect(await launchDeckItem([action()], [], 'item', deps)).toEqual({ ok: true });
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com');

    const file = action({ type: 'file', target: '/tmp/report.txt' });
    expect(await launchDeckItem([file], [], 'item', deps)).toEqual({ ok: true });
    expect(deps.openPath).toHaveBeenCalledWith('/tmp/report.txt');
  });

  it('spawns apps with an argument array and never enables shell mode', async () => {
    const deps = dependencies();
    const app = action({
      type: 'app',
      target: 'C:\\Tools\\tool.exe',
      args: ['--safe', '값'],
      workingDir: 'C:\\Tools',
    });
    expect(await launchDeckItem([app], [], 'item', deps, 'win32')).toEqual({ ok: true });
    expect(deps.spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = vi.mocked(deps.spawnProcess).mock.calls[0] as [
      string,
      readonly string[],
      SpawnOptions,
    ];
    expect(command).toBe('C:\\Tools\\tool.exe');
    expect(args).toEqual(['--safe', '값']);
    expect(options).toMatchObject({ detached: true, stdio: 'ignore', cwd: 'C:\\Tools' });
    expect(options.shell).not.toBe(true);
  });

  it('returns NOT_FOUND before opening a missing path', async () => {
    const deps = dependencies();
    deps.exists = vi.fn(() => false);
    const result = await launchDeckItem(
      [action({ type: 'folder', target: '/missing' })],
      [],
      'item',
      deps,
    );
    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(deps.openPath).not.toHaveBeenCalled();
  });

  it('does not execute FolderItem entries', async () => {
    const deps = dependencies();
    const folder: DeckItem = {
      id: 'folder',
      kind: 'folder',
      label: '폴더',
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      children: [],
    };
    const result = await launchDeckItem([folder], [], 'folder', deps);
    expect(result).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.openPath).not.toHaveBeenCalled();
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });

  it('blocks dangerous URL schemes', async () => {
    const result = await launchDeckItem(
      [action({ target: 'javascript:alert(1)' })],
      [],
      'item',
      dependencies(),
    );
    expect(result).toMatchObject({ ok: false, code: 'BLOCKED' });
  });

  it('opens a macOS app bundle directly when it has no arguments', async () => {
    const deps = dependencies();
    const app = action({ type: 'app', target: '/Applications/Tool.app', args: [] });

    expect(await launchDeckItem([app], [], 'item', deps, 'darwin')).toEqual({ ok: true });
    expect(deps.openPath).toHaveBeenCalledWith('/Applications/Tool.app');
    expect(deps.spawnProcess).not.toHaveBeenCalled();
  });

  it('uses open with an argument array for macOS app arguments and never enables shell mode', async () => {
    const deps = dependencies();
    const app = action({
      type: 'app',
      target: '/Applications/Tool.app',
      args: ['--safe', '값'],
    });

    expect(await launchDeckItem([app], [], 'item', deps, 'darwin')).toEqual({ ok: true });
    const [command, args, options] = vi.mocked(deps.spawnProcess).mock.calls[0] as [
      string,
      readonly string[],
      SpawnOptions,
    ];
    expect(command).toBe('open');
    expect(args).toEqual(['-a', '/Applications/Tool.app', '--args', '--safe', '값']);
    expect(options.shell).not.toBe(true);
  });

  it('blocks Windows Store apps on macOS and safely blocks unsupported platforms', async () => {
    const deps = dependencies();
    const storeApp = action({ type: 'uwp', target: 'Example.App!Main' });

    await expect(launchDeckItem([storeApp], [], 'item', deps, 'darwin')).resolves.toMatchObject({
      ok: false,
      code: 'BLOCKED',
    });
    await expect(launchDeckItem([action()], [], 'item', deps, 'linux')).resolves.toMatchObject({
      ok: false,
      code: 'BLOCKED',
    });
  });
});

describe('automatic panel hiding', () => {
  const config = createDefaultConfig(
    { downloads: '/Users/test/Downloads', documents: '/Users/test/Documents' },
    () => 'id',
    'darwin',
  );

  it('hides only after a successful launch when keep-open and editor guards are clear', () => {
    expect(
      shouldAutoHideAfterLaunch(config, { ok: true }, { keepOpen: undefined, editorOpen: false }),
    ).toBe(true);
    expect(
      shouldAutoHideAfterLaunch(config, { ok: true }, { keepOpen: true, editorOpen: false }),
    ).toBe(false);
    expect(
      shouldAutoHideAfterLaunch(config, { ok: true }, { keepOpen: undefined, editorOpen: true }),
    ).toBe(false);
    expect(
      shouldAutoHideAfterLaunch(
        config,
        { ok: false, code: 'FAILED', message: '실패' },
        { keepOpen: undefined, editorOpen: false },
      ),
    ).toBe(false);
  });

  it('lets an explicit false keep-open value request hint-key hiding', () => {
    const noPointerHide = {
      ...config,
      behavior: { ...config.behavior, hideAfterLaunch: false },
    };
    expect(
      shouldAutoHideAfterLaunch(noPointerHide, { ok: true }, { keepOpen: false, editorOpen: false }),
    ).toBe(true);
  });

  it('schedules one hide and cancels it when a keep-open launch follows', () => {
    const hidePanel = vi.fn();
    const clearTimer = vi.fn();
    const setTimer = vi.fn(() => 7);
    const service = createVisibilityService({ hidePanel, setTimer, clearTimer });

    service.afterLaunch(config, { ok: true }, { keepOpen: undefined, editorOpen: false });
    expect(setTimer).toHaveBeenCalledWith(hidePanel, 180);
    service.afterLaunch(config, { ok: true }, { keepOpen: true, editorOpen: false });
    expect(clearTimer).toHaveBeenCalledWith(7);
  });
});
