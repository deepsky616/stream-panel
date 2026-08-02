import { describe, expect, it } from 'vitest';
import { buildBrowserFlags } from '../src/main/services/browserService/flags';
import { parseChromiumProfiles } from '../src/main/services/browserService/profiles';
import { getWindowsBrowserCandidates } from '../src/main/services/browserService/windows';
import { getMacosBrowserCandidates } from '../src/main/services/browserService/macos';
import type { BrowserSpec, DetectedBrowser } from '../src/shared/types';

function browser(family: DetectedBrowser['family']): DetectedBrowser {
  return {
    id: family === 'chromium' ? 'chrome' : family,
    name: family,
    path: family === 'safari' ? '/Applications/Safari.app' : `/Applications/${family}.app`,
    family,
    supportsAppMode: family === 'chromium',
    supportsProfiles: family === 'chromium',
    profiles: [],
  };
}

function spec(overrides: Partial<BrowserSpec> = {}): BrowserSpec {
  return {
    path: '/Applications/Google Chrome.app',
    appMode: false,
    ...overrides,
  };
}

describe('browser launch flags', () => {
  it('puts an app-mode URL only inside one generated flag', () => {
    const url = 'https://example.com/app';

    expect(buildBrowserFlags(browser('chromium'), spec({ appMode: true }), url)).toEqual([
      '--app=https://example.com/app',
    ]);
  });

  it('places a validated Chromium profile before either URL form', () => {
    expect(
      buildBrowserFlags(
        browser('chromium'),
        spec({ profileDir: 'Profile 1', appMode: false }),
        'https://example.com',
      ),
    ).toEqual(['--profile-directory=Profile 1', 'https://example.com']);
    expect(
      buildBrowserFlags(
        browser('chromium'),
        spec({ profileDir: 'Default', appMode: true }),
        'https://example.com',
      ),
    ).toEqual(['--profile-directory=Default', '--app=https://example.com']);
  });

  it('passes only the URL to Firefox and Safari', () => {
    const url = 'https://example.com';
    const configured = spec({ profileDir: 'Profile 1', appMode: true });

    expect(buildBrowserFlags(browser('firefox'), configured, url)).toEqual([url]);
    expect(buildBrowserFlags(browser('safari'), configured, url)).toEqual([url]);
  });

  it('rejects profile directory traversal and separators', () => {
    for (const profileDir of ['../Default', 'Group/Profile', 'Group\\Profile', '.']) {
      expect(() =>
        buildBrowserFlags(browser('chromium'), spec({ profileDir }), 'https://example.com'),
      ).toThrow(/프로필/);
    }
  });
});

describe('Chromium profile parsing', () => {
  it('parses display names from Local State in stable directory order', () => {
    const text = JSON.stringify({
      profile: {
        info_cache: {
          'Profile 1': { name: '개인' },
          Default: { name: '업무용' },
          Broken: { name: 42 },
        },
      },
    });

    expect(parseChromiumProfiles(text)).toEqual([
      { dir: 'Default', name: '업무용' },
      { dir: 'Profile 1', name: '개인' },
    ]);
  });

  it('returns an empty list for missing, malformed, or unexpected data', () => {
    expect(parseChromiumProfiles(undefined)).toEqual([]);
    expect(parseChromiumProfiles('{broken')).toEqual([]);
    expect(parseChromiumProfiles(JSON.stringify({ profile: [] }))).toEqual([]);
  });
});

describe('cross-platform browser paths', () => {
  it('builds complete Windows and macOS Local State paths on either host platform', () => {
    const windows = getWindowsBrowserCandidates({
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    });
    const localChrome = windows.find((candidate) =>
      candidate.path.startsWith('C:\\Users\\me\\AppData\\Local'),
    );
    expect(localChrome?.localStatePath).toBe(
      'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Local State',
    );

    const macChrome = getMacosBrowserCandidates('/Users/me').find(
      (candidate) => candidate.id === 'chrome',
    );
    expect(macChrome).toMatchObject({
      path: '/Applications/Google Chrome.app',
      localStatePath: '/Users/me/Library/Application Support/Google/Chrome/Local State',
    });
  });
});
