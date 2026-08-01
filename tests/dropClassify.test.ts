import { describe, expect, it } from 'vitest';
import { classifyDroppedItems, parseDroppedUrl } from '../src/main/services/dropClassifier';

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'win32' as const,
    getStats: async () => ({ isDirectory: () => false }),
    readShortcut: () => ({ target: 'C:\\Apps\\Tool.exe', args: '--open "내 문서"', cwd: 'C:\\Apps' }),
    ...overrides,
  };
}

describe('drop classification', () => {
  it('classifies directories, files, executables, and shortcuts', async () => {
    const directory = await classifyDroppedItems(
      { paths: ['C:\\Work'] },
      dependencies({ getStats: async () => ({ isDirectory: () => true }) }),
    );
    expect(directory[0]).toMatchObject({ type: 'folder', target: 'C:\\Work', args: [] });

    const file = await classifyDroppedItems({ paths: ['C:\\Work\\보고서.pdf'] }, dependencies());
    expect(file[0]).toMatchObject({ type: 'file', label: '보고서' });

    const executable = await classifyDroppedItems({ paths: ['C:\\Apps\\Tool.exe'] }, dependencies());
    expect(executable[0]).toMatchObject({ type: 'app', workingDir: 'C:\\Apps' });

    const shortcut = await classifyDroppedItems({ paths: ['C:\\Menu\\Tool.lnk'] }, dependencies());
    expect(shortcut[0]).toMatchObject({
      type: 'app',
      target: 'C:\\Apps\\Tool.exe',
      args: ['--open', '내 문서'],
    });
  });

  it('ignores Windows shortcuts on other platforms', async () => {
    const result = await classifyDroppedItems(
      { paths: ['/tmp/tool.lnk'] },
      dependencies({ platform: 'darwin' }),
    );
    expect(result).toEqual([]);
  });

  it('accepts only http and https URL text and derives a host label', async () => {
    expect(parseDroppedUrl('# 설명\nhttps://example.com/path')?.hostname).toBe('example.com');
    expect(parseDroppedUrl('javascript:alert(1)')).toBeNull();
    const result = await classifyDroppedItems({ paths: [], text: 'https://example.com/path' }, dependencies());
    expect(result[0]).toMatchObject({ type: 'url', label: 'example.com' });
  });

  it('treats dropped images on an empty slot as ordinary files', async () => {
    const result = await classifyDroppedItems({ paths: ['C:\\Images\\cover.png'] }, dependencies());
    expect(result[0]).toMatchObject({ type: 'file', label: 'cover' });
  });
});
