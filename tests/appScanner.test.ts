import { describe, expect, it } from 'vitest';
import {
  createAppScanner,
  deduplicateApps,
  parseStoreApps,
  shouldIncludeShortcut,
} from '../src/main/services/appScanner';
import { WindowsAppScanner } from '../src/main/services/appScanner/windows';
import { MacAppScanner, parseBundleMetadata } from '../src/main/services/appScanner/macos';
import { parseMacIconMetadata } from '../src/main/services/iconService/macos';
import type { InstalledApp } from '../src/shared/types';

describe('installed app scanner', () => {
  it('keeps executable shortcuts and filters uninstallers and document links', () => {
    expect(
      shouldIncludeShortcut('C:\\Menu\\Editor.lnk', { target: 'C:\\Apps\\Editor.exe' }),
    ).toBe(true);
    expect(
      shouldIncludeShortcut('C:\\Menu\\제거.lnk', { target: 'C:\\Apps\\uninstall.exe' }),
    ).toBe(false);
    expect(
      shouldIncludeShortcut('C:\\Menu\\설명서.lnk', { target: 'C:\\Docs\\manual.chm' }),
    ).toBe(false);
  });

  it('parses Store JSON with Korean names and excludes AppIDs without an exclamation mark', () => {
    const output = JSON.stringify([
      { Name: '계산기', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
      { Name: '일반 앱', AppID: 'C:\\Apps\\Desktop.exe' },
    ]);
    expect(parseStoreApps(output)).toEqual([
      {
        name: '계산기',
        type: 'uwp',
        target: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App',
        args: [],
        source: 'store',
      },
    ]);
  });

  it('accepts a single PowerShell object and ignores malformed output', () => {
    expect(
      parseStoreApps(
        JSON.stringify({ Name: '사진', AppID: 'Microsoft.Windows.Photos_8wekyb3d8bbwe!App' }),
      ),
    ).toHaveLength(1);
    expect(parseStoreApps('not-json')).toEqual([]);
  });

  it('deduplicates by name while preserving the first source', () => {
    const apps: InstalledApp[] = [
      {
        name: '편집기',
        type: 'app',
        target: 'C:\\Apps\\Editor.exe',
        args: [],
        source: 'start-menu',
      },
      {
        name: '편집기',
        type: 'uwp',
        target: 'Vendor.Editor!App',
        args: [],
        source: 'store',
      },
    ];
    expect(deduplicateApps(apps)).toEqual([apps[0]]);
  });

  it('tests the Windows scanner with injected platform services on macOS', async () => {
    const programRoot = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs';
    const userRoot = 'C:\\Users\\tester\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs';
    const entries = new Map<string, Array<{ name: string; directory: boolean }>>([
      [programRoot, [
        { name: '도구', directory: true },
        { name: '설명서.lnk', directory: false },
      ]],
      [`${programRoot}\\도구`, [{ name: '편집기.lnk', directory: false }]],
      [userRoot, [{ name: '제거.lnk', directory: false }]],
    ]);
    const scanner = new WindowsAppScanner(
      { ProgramData: 'C:\\ProgramData', APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' },
      {
        readdir: async (path) => (entries.get(path) ?? []).map((entry) => ({
          name: entry.name,
          isDirectory: () => entry.directory,
          isFile: () => !entry.directory,
        })),
        access: async () => undefined,
        readShortcut: async (path) => ({
          target: path.endsWith('편집기.lnk') ? 'C:\\Apps\\Editor.exe' : 'C:\\Docs\\manual.chm',
          args: '--name "한글 문서"',
          cwd: 'C:\\Apps',
        }),
        runStoreCommand: async () => JSON.stringify([
          { Name: '계산기', AppID: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' },
        ]),
      },
    );

    await expect(scanner.scan()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '편집기', type: 'app', args: ['--name', '한글 문서'] }),
      expect.objectContaining({ name: '계산기', type: 'uwp' }),
    ]));
  });

  it('tests the macOS scanner without descending into app bundles', async () => {
    const visited: string[] = [];
    const entries = new Map<string, Array<{ name: string; directory: boolean }>>([
      ['/Applications', [
        { name: '편집기.app', directory: true },
        { name: 'Utilities', directory: true },
      ]],
      ['/Applications/Utilities', [
        { name: 'Calculator.app', directory: true },
        { name: 'Tool Uninstaller.app', directory: true },
      ]],
      ['/System/Applications', []],
      ['/Users/tester/Applications', [{ name: '개인 앱.app', directory: true }]],
    ]);
    const scanner = new MacAppScanner('/Users/tester', {
      readdir: async (path) => {
        visited.push(path);
        return (entries.get(path) ?? []).map((entry) => ({
          name: entry.name,
          isDirectory: () => entry.directory,
        }));
      },
      readBundleMetadata: async (path) =>
        path.endsWith('Calculator.app') ? { CFBundleDisplayName: '계산기' } : {},
    });

    const apps = await scanner.scan();
    expect(apps).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '편집기', target: '/Applications/편집기.app' }),
      expect.objectContaining({ name: '계산기', target: '/Applications/Utilities/Calculator.app' }),
      expect.objectContaining({ name: '개인 앱', target: '/Users/tester/Applications/개인 앱.app' }),
    ]));
    expect(apps.some((app) => app.name.includes('Uninstall'))).toBe(false);
    expect(visited.some((path) => path.includes('.app/'))).toBe(false);
  });

  it('parses macOS bundle metadata and returns a safe scanner for unsupported platforms', async () => {
    expect(parseBundleMetadata('{"CFBundleDisplayName":"한글 앱","CFBundleName":"Fallback"}'))
      .toEqual({ CFBundleDisplayName: '한글 앱', CFBundleName: 'Fallback' });
    expect(parseBundleMetadata('broken')).toEqual({});
    await expect(createAppScanner({
      platform: 'linux',
      userDataPath: '/tmp/stream-panel-unsupported',
    }).list(true)).resolves.toEqual([]);
  });

  it('parses direct and nested macOS bundle icon declarations', () => {
    expect(parseMacIconMetadata('{"CFBundleIconFile":"AppIcon"}')).toEqual(['AppIcon']);
    expect(parseMacIconMetadata(JSON.stringify({
      CFBundleIcons: {
        CFBundlePrimaryIcon: { CFBundleIconFiles: ['SmallIcon', 'LargeIcon'] },
      },
    }))).toEqual(['LargeIcon', 'SmallIcon']);
    expect(parseMacIconMetadata('broken')).toEqual([]);
  });
});
