import { describe, expect, it } from 'vitest';
import {
  deduplicateApps,
  parseStoreApps,
  shouldIncludeShortcut,
} from '../src/main/services/appScanner';
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
});
