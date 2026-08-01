import { describe, expect, it, vi } from 'vitest';
import type { SpawnOptions } from 'node:child_process';
import type { ActionItem, DeckItem } from '../src/shared/types';
import { launchDeckItem, type LauncherDependencies } from '../src/main/services/launcher';

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
    expect(await launchDeckItem([app], [], 'item', deps)).toEqual({ ok: true });
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
});
