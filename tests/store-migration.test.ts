import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import { recoverConfigText } from '../src/main/store';

const defaults = createDefaultConfig(
  { downloads: '/Users/test/Downloads', documents: '/Users/test/Documents' },
  (() => {
    let index = 0;
    return () => `id-${index++}`;
  })(),
  'darwin',
);

describe('store migration', () => {
  it('creates defaults when no config exists', () => {
    const result = recoverConfigText(undefined, defaults);
    expect(result.recovered).toBe(false);
    expect(result.config.root.map(({ label }) => label)).toEqual(['구글', '다운로드', '문서']);
  });

  it('backs up and resets an unknown future version', () => {
    const future = JSON.stringify({ ...defaults, version: 99 });
    const result = recoverConfigText(future, defaults);
    expect(result).toMatchObject({ recovered: true, reason: 'future-version', backupText: future });
    expect(result.config.version).toBe(1);
  });

  it('backs up and resets malformed json', () => {
    const result = recoverConfigText('{broken', defaults);
    expect(result).toMatchObject({
      recovered: true,
      reason: 'corrupt-json',
      backupText: '{broken',
    });
  });

  it('normalizes damaged positions recursively', () => {
    const damaged = structuredClone(defaults);
    damaged.root[1].position = 0;
    const result = recoverConfigText(JSON.stringify(damaged), defaults);
    expect(result.recovered).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.config.root.map(({ position }) => position)).toEqual([0, 1, 2]);
  });

  it('fills fields added to a legacy version-one config without deleting its items', () => {
    const legacy = structuredClone(defaults) as unknown as Record<string, unknown>;
    delete legacy.platform;
    delete legacy.behavior;
    delete legacy.keyboard;
    legacy.hotkey = 'Control+Alt+D';

    const result = recoverConfigText(JSON.stringify(legacy), defaults);

    expect(result.config.root).toHaveLength(3);
    expect(result.config.platform).toBe('darwin');
    expect(result.config.behavior).toMatchObject({ hideAfterLaunch: true, edgePeek: true });
    expect(result.config.keyboard).toMatchObject({
      hintKeys: expect.any(String),
      globalNumberHotkeys: true,
      globalNumberModifier: 'Control+Alt',
      quickLauncher: true,
      quickLauncherHotkey: 'CommandOrControl+Alt+Space',
    });
    expect(result.config.keyboard.hintKeys).toHaveLength(40);
    expect(result.config.hotkey).toBe('CommandOrControl+Alt+D');
  });

  it('preserves a config that was created on the other supported platform', () => {
    const foreign = { ...defaults, platform: 'win32' as const };
    const result = recoverConfigText(JSON.stringify(foreign), defaults);

    expect(result.config.platform).toBe('win32');
    expect(result.config.root).toEqual(foreign.root);
  });
});

describe('platform defaults', () => {
  it('uses portable accelerators and disables automatic updates on macOS', () => {
    const config = createDefaultConfig(
      { downloads: '/Users/test/Downloads', documents: '/Users/test/Documents' },
      () => 'fixed-id',
      'darwin',
    );

    expect(config.platform).toBe('darwin');
    expect(config.hotkey).toBe('CommandOrControl+Alt+D');
    expect(config.keyboard).toMatchObject({
      globalNumberHotkeys: true,
      globalNumberModifier: 'Control+Alt',
      quickLauncher: true,
      quickLauncherHotkey: 'CommandOrControl+Alt+Space',
    });
    expect(config.behavior).toMatchObject({
      hideAfterLaunch: true,
      edgePeek: true,
      peekEdge: 'auto',
      idleFade: false,
    });
    expect(config.autoUpdate).toBe(false);
  });

  it('enables automatic updates on Windows', () => {
    const config = createDefaultConfig(
      { downloads: 'C:/Users/test/Downloads', documents: 'C:/Users/test/Documents' },
      () => 'fixed-id',
      'win32',
    );

    expect(config.platform).toBe('win32');
    expect(config.keyboard).toMatchObject({
      globalNumberHotkeys: true,
      globalNumberModifier: 'Alt+Shift',
      quickLauncher: true,
      quickLauncherHotkey: 'CommandOrControl+Alt+Space',
    });
    expect(config.autoUpdate).toBe(true);
  });
});
