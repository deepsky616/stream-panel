import { describe, expect, it } from 'vitest';
import {
  GITHUB_LATEST_YML_URL,
  lookupLatestVersion,
  safeUpdaterErrorMessage,
  UPDATE_MIRROR_VERSION_URL,
  updaterFailureCode,
  type UpdateFetch,
} from '../src/main/services/updater/releaseLookup';

function response(status: number, text: string): Awaited<ReturnType<UpdateFetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

describe('updater release lookup', () => {
  it('uses the fixed download mirror without calling GitHub releases', async () => {
    const calls: string[] = [];
    const fetcher: UpdateFetch = async (input) => {
      calls.push(String(input));
      return response(200, JSON.stringify({ version: '1.5.47' }));
    };

    await expect(lookupLatestVersion(fetcher)).resolves.toEqual({
      version: '1.5.47',
      source: 'mirror',
    });
    expect(calls).toEqual([UPDATE_MIRROR_VERSION_URL]);
  });

  it('falls back to the GitHub latest.yml when the mirror is unavailable', async () => {
    const calls: string[] = [];
    const fetcher: UpdateFetch = async (input) => {
      const url = String(input);
      calls.push(url);
      return url === UPDATE_MIRROR_VERSION_URL
        ? response(503, 'unavailable')
        : response(200, "version: '1.5.48'\npath: StreamPanel-1.5.48-Setup.exe\n");
    };

    await expect(lookupLatestVersion(fetcher)).resolves.toEqual({
      version: '1.5.48',
      source: 'github-release',
    });
    expect(calls).toEqual([UPDATE_MIRROR_VERSION_URL, GITHUB_LATEST_YML_URL]);
  });

  it('rejects invalid metadata from both independent sources', async () => {
    const fetcher: UpdateFetch = async () => response(200, 'not a version');
    await expect(lookupLatestVersion(fetcher)).rejects.toThrow(/mirror.*github-release/i);
  });

  it('assigns actionable error codes and removes signed query strings', () => {
    expect(updaterFailureCode(new Error('certificate verify failed'))).toBe('UPD-CERT');
    expect(updaterFailureCode(new Error('proxy HTTP 407'))).toBe('UPD-PROXY');
    expect(updaterFailureCode(new Error('request HTTP 503'))).toBe('UPD-HTTP-503');
    expect(safeUpdaterErrorMessage(
      new Error('failed https://example.test/file?secret=signed-token\nnext'),
    )).toBe('failed https://example.test/file?… next');
  });
});
