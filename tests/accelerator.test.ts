import { describe, expect, it } from 'vitest';
import {
  buildNumberAccelerators,
  formatAccelerator,
  formatNumberModifier,
  normalizeAccelerator,
} from '../src/shared/accelerator';
import { getPlatformConfig, shouldStartHidden } from '../src/main/platform';
import { focusWithRetry } from '../src/main/services/windowFocus';

describe('accelerator', () => {
  it('formats a portable accelerator for Windows', () => {
    expect(formatAccelerator('CommandOrControl+Alt+D', 'win32')).toBe('Ctrl+Alt+D');
  });

  it('formats a portable accelerator for macOS', () => {
    expect(formatAccelerator('CommandOrControl+Alt+D', 'darwin')).toBe('⌘⌥D');
  });

  it('normalizes platform-specific control keys to CommandOrControl for storage', () => {
    expect(normalizeAccelerator('Control+Alt+D')).toBe('CommandOrControl+Alt+D');
    expect(normalizeAccelerator('Command+Option+D')).toBe('CommandOrControl+Alt+D');
    expect(normalizeAccelerator('CommandOrControl+Alt+D')).toBe('CommandOrControl+Alt+D');
  });

  it('keeps the macOS global-number Control modifier distinct from Command', () => {
    expect(buildNumberAccelerators('Control+Alt')).toEqual([
      'Control+Alt+1',
      'Control+Alt+2',
      'Control+Alt+3',
      'Control+Alt+4',
      'Control+Alt+5',
      'Control+Alt+6',
      'Control+Alt+7',
      'Control+Alt+8',
      'Control+Alt+9',
      'Control+Alt+0',
    ]);
    expect(formatNumberModifier('Control+Alt', 'darwin')).toBe('Ctrl+⌥');
    expect(formatNumberModifier('Alt+Shift', 'win32')).toBe('Alt+Shift');
  });
});

describe('platform settings', () => {
  it('uses the screen-saver level on Windows and the floating level on macOS', () => {
    expect(getPlatformConfig('win32')).toMatchObject({
      supported: true,
      alwaysOnTopLevel: 'screen-saver',
      hideDock: false,
      trayAsset: 'tray.ico',
    });
    expect(getPlatformConfig('darwin')).toMatchObject({
      supported: true,
      alwaysOnTopLevel: 'floating',
      hideDock: true,
      trayAsset: 'trayTemplate.png',
    });
  });

  it('returns harmless settings for an unsupported platform', () => {
    expect(getPlatformConfig('linux')).toMatchObject({
      supported: false,
      alwaysOnTopLevel: 'normal',
      hideDock: false,
    });
  });

  it('uses command-line hiding on Windows and login-item state on macOS', () => {
    expect(shouldStartHidden('win32', { argv: ['app', '--hidden'] })).toBe(true);
    expect(
      shouldStartHidden('darwin', {
        argv: ['app'],
        getWasOpenedAsHidden: () => true,
      }),
    ).toBe(true);
    expect(
      shouldStartHidden('win32', {
        argv: ['app'],
        getWasOpenedAsHidden: () => true,
      }),
    ).toBe(false);
  });
});

describe('window focus retry', () => {
  it('retries once after one hundred milliseconds and avoids the fallback when focus succeeds', async () => {
    const waits: number[] = [];
    const attempts = [false, true];
    let failures = 0;

    const focused = await focusWithRetry({
      attempt: () => attempts.shift() ?? false,
      wait: async (delay) => { waits.push(delay); },
      onFailure: () => { failures += 1; },
    });

    expect(focused).toBe(true);
    expect(waits).toEqual([100]);
    expect(failures).toBe(0);
  });

  it('reports a visible fallback after exactly two failed attempts', async () => {
    let attempts = 0;
    let failures = 0;

    const focused = await focusWithRetry({
      attempt: () => { attempts += 1; return false; },
      wait: async () => undefined,
      onFailure: () => { failures += 1; },
    });

    expect(focused).toBe(false);
    expect(attempts).toBe(2);
    expect(failures).toBe(1);
  });
});
