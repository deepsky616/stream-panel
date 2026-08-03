import { describe, expect, it, vi } from 'vitest';
import type { SpawnOptions } from 'node:child_process';
import type { ActionItem, DeckItem } from '../src/shared/types';
import { launchDeckItem, type LauncherDependencies } from '../src/main/services/launcher';
import { createDefaultConfig } from '../src/shared/defaults';
import { compareVersions } from '../src/main/services/updater/version';
import { resolveTrayAssetPaths } from '../src/main/trayAsset';
import {
  createVisibilityService,
  getPeekBounds,
  inferPeekEdge,
  shouldAutoHideAfterLaunch,
} from '../src/main/services/visibility';

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
    resolveMacBundleExecutable: vi.fn(async (bundlePath: string) =>
      `${bundlePath}/Contents/MacOS/Browser`,
    ),
    notifyWarning: vi.fn(),
    queueWebWorkflow: vi.fn(() => ({ queued: true })),
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

  it('opens a URL in a selected Windows Chromium profile without duplicate app-mode URLs', async () => {
    const deps = dependencies();
    const item = action({
      browser: {
        path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        profileDir: 'Profile 1',
        appMode: true,
      },
    });

    expect(await launchDeckItem([item], [], 'item', deps, 'win32')).toEqual({ ok: true });
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.spawnProcess).toHaveBeenCalledWith(
      item.browser?.path,
      ['--profile-directory=Profile 1', '--app=https://example.com'],
      { detached: true, stdio: 'ignore' },
    );
    const options = vi.mocked(deps.spawnProcess).mock.calls[0]?.[2];
    expect(options?.shell).not.toBe(true);
  });

  it('queues a fixed web workflow before opening its selected browser', async () => {
    const events: string[] = [];
    const deps = dependencies();
    deps.queueWebWorkflow = vi.fn(() => {
      events.push('queue');
      return { queued: true };
    });
    deps.spawnProcess = vi.fn(() => {
      events.push('open');
      return { unref: vi.fn() };
    });
    const item = action({
      target: 'https://goe.neis.go.kr',
      browser: {
        path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        profileDir: 'Default',
        appMode: false,
      },
      webWorkflow: { id: 'neis-leave', browserId: 'edge' },
    });

    expect(await launchDeckItem([item], [], 'item', deps, 'win32')).toEqual({ ok: true });
    expect(deps.queueWebWorkflow).toHaveBeenCalledWith(item);
    expect(events).toEqual(['queue', 'open']);
  });

  it('opens the site without queuing automation when a workflow browser is not selected', async () => {
    const deps = dependencies();
    const item = action({
      target: 'https://goe.neis.go.kr',
      webWorkflow: { id: 'neis-trip', browserId: 'edge' },
    });

    expect(await launchDeckItem([item], [], 'item', deps, 'win32')).toEqual({ ok: true });
    expect(deps.queueWebWorkflow).not.toHaveBeenCalled();
    expect(deps.openExternal).toHaveBeenCalledWith('https://goe.neis.go.kr');
    expect(deps.notifyWarning).toHaveBeenCalledWith(expect.stringMatching(/엣지나 크롬/));
  });

  it('launches a selected macOS browser through its internal executable', async () => {
    const deps = dependencies();
    const item = action({
      browser: {
        path: '/Applications/Google Chrome.app',
        profileDir: 'Default',
        appMode: false,
      },
    });

    expect(await launchDeckItem([item], [], 'item', deps, 'darwin')).toEqual({ ok: true });
    expect(deps.resolveMacBundleExecutable).toHaveBeenCalledWith(item.browser?.path);
    expect(deps.spawnProcess).toHaveBeenCalledWith(
      '/Applications/Google Chrome.app/Contents/MacOS/Browser',
      ['--profile-directory=Default', 'https://example.com'],
      { detached: true, stdio: 'ignore' },
    );
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  it('falls back to the default browser and warns when the selected browser is missing', async () => {
    const deps = dependencies();
    deps.exists = vi.fn(() => false);
    const item = action({
      browser: { path: '/Applications/Missing.app', appMode: false },
    });

    expect(await launchDeckItem([item], [], 'item', deps, 'darwin')).toEqual({ ok: true });
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(deps.spawnProcess).not.toHaveBeenCalled();
    expect(deps.notifyWarning).toHaveBeenCalledWith(
      '지정한 브라우저를 찾을 수 없어 기본 브라우저로 열었습니다.',
    );
  });

  it('falls back safely when starting the selected browser throws', async () => {
    const deps = dependencies();
    deps.spawnProcess = vi.fn(() => {
      throw new Error('spawn failed');
    });
    const item = action({
      browser: {
        path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        appMode: false,
      },
    });

    expect(await launchDeckItem([item], [], 'item', deps, 'win32')).toEqual({ ok: true });
    expect(deps.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(deps.notifyWarning).toHaveBeenCalledOnce();
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

describe('panel edge peek geometry', () => {
  const workArea = { x: 0, y: 24, width: 1440, height: 876 };

  it('infers the nearest work-area edge from the panel center', () => {
    expect(inferPeekEdge({ x: 1210, y: 80, width: 200, height: 300 }, workArea)).toBe('right');
    expect(inferPeekEdge({ x: 20, y: 280, width: 200, height: 300 }, workArea)).toBe('left');
    expect(inferPeekEdge({ x: 500, y: 30, width: 200, height: 100 }, workArea)).toBe('top');
    expect(inferPeekEdge({ x: 500, y: 780, width: 200, height: 100 }, workArea)).toBe('bottom');
  });

  it('places and clamps a 160px strip inside the work area', () => {
    expect(
      getPeekBounds({ x: 1320, y: 850, width: 200, height: 300 }, workArea, 'right', 6),
    ).toEqual({ x: 1434, y: 740, width: 6, height: 160 });
    expect(
      getPeekBounds({ x: -50, y: 40, width: 200, height: 300 }, workArea, 'left', 8),
    ).toEqual({ x: 0, y: 40, width: 8, height: 160 });
    expect(
      getPeekBounds({ x: 1370, y: 50, width: 200, height: 300 }, workArea, 'top', 5),
    ).toEqual({ x: 1280, y: 24, width: 160, height: 5 });
  });
});

describe('release version comparison', () => {
  it('compares numeric release parts without lexical ordering mistakes', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.1', '1.0.1')).toBe(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
  });
});

describe('tray asset paths', () => {
  it('keeps the packaged tray icon reachable outside and inside the app archive', () => {
    expect(
      resolveTrayAssetPaths({
        isPackaged: true,
        resourcesPath: '/installed/Resources',
        appPath: '/installed/Resources/app.asar',
        assetName: 'tray.ico',
      }).map((path) => path.replaceAll('\\', '/')),
    ).toEqual([
      '/installed/Resources/resources/tray.ico',
      '/installed/Resources/app.asar/resources/tray.ico',
    ]);
  });
});
