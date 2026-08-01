import { describe, expect, it } from 'vitest';
import { formatAccelerator, normalizeAccelerator } from '../src/shared/accelerator';
import { getPlatformConfig, shouldStartHidden } from '../src/main/platform';

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
