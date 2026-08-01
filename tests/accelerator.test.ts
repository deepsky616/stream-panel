import { describe, expect, it } from 'vitest';
import { formatAccelerator, normalizeAccelerator } from '../src/shared/accelerator';

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
