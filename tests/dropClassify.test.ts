import { describe, expect, it } from 'vitest';
import { classifyDroppedItems, parseDroppedUrl } from '../src/main/services/dropClassifier';

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'win32' as const,
    realpath: async (path: string) => path,
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

  it('does not call the Windows shortcut API on other platforms', async () => {
    const result = await classifyDroppedItems(
      { paths: ['/tmp/tool.lnk'] },
      dependencies({
        platform: 'darwin',
        readShortcut: () => {
          throw new Error('맥에서 윈도우 바로 가기 읽기를 호출하면 안 됩니다.');
        },
      }),
    );
    expect(result[0]).toMatchObject({ type: 'file', target: '/tmp/tool.lnk' });
  });

  it('classifies a macOS app bundle as an app before treating directories as folders', async () => {
    const result = await classifyDroppedItems(
      { paths: ['/Applications/Stream Panel.app'] },
      dependencies({
        platform: 'darwin',
        getStats: async () => ({ isDirectory: () => true }),
      }),
    );

    expect(result[0]).toMatchObject({
      type: 'app',
      target: '/Applications/Stream Panel.app',
      label: 'Stream Panel',
      workingDir: '/Applications',
    });
  });

  it('resolves macOS symbolic links before classifying their targets', async () => {
    const result = await classifyDroppedItems(
      { paths: ['/tmp/My Tool'] },
      dependencies({
        platform: 'darwin',
        realpath: async () => '/Applications/My Tool.app',
        getStats: async () => ({ isDirectory: () => true }),
      }),
    );

    expect(result[0]).toMatchObject({
      type: 'app',
      target: '/Applications/My Tool.app',
      label: 'My Tool',
    });
  });

  it('returns a safe empty result on unsupported platforms', async () => {
    const result = await classifyDroppedItems(
      { paths: ['/tmp/tool'] },
      dependencies({
        platform: 'linux',
        getStats: async () => {
          throw new Error('지원하지 않는 운영체제에서는 파일을 읽으면 안 됩니다.');
        },
      }),
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

  it('keeps the order of multiple dropped paths before an appended URL', async () => {
    const result = await classifyDroppedItems(
      {
        paths: ['C:\\Work\\first.txt', 'C:\\Work\\second.txt'],
        text: 'https://example.com/path',
      },
      dependencies(),
    );

    expect(result.map((item) => item.label)).toEqual(['first', 'second', 'example.com']);
  });
});
