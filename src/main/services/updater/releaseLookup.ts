import { normalizeVersion } from './version';

export const UPDATE_MIRROR_URL = 'https://deepsky616.github.io/stream-panel';
export const UPDATE_MIRROR_VERSION_URL = `${UPDATE_MIRROR_URL}/version.json`;
export const GITHUB_LATEST_YML_URL =
  'https://github.com/deepsky616/stream-panel/releases/latest/download/latest.yml';

export type UpdateLookupSource = 'mirror' | 'github-release';

export interface LatestVersionLookup {
  version: string;
  source: UpdateLookupSource;
}

export type UpdateFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

function mirrorVersion(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return typeof (parsed as { version?: unknown }).version === 'string'
      ? normalizeVersion((parsed as { version: string }).version)
      : null;
  } catch {
    return null;
  }
}

function latestYmlVersion(text: string): string | null {
  const match = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text);
  return match ? normalizeVersion(match[1]) : null;
}

async function fetchVersion(
  fetcher: UpdateFetch,
  url: string,
  source: UpdateLookupSource,
  parse: (text: string) => string | null,
  signal?: AbortSignal,
): Promise<LatestVersionLookup> {
  const response = await fetcher(url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'User-Agent': 'StreamPanel' },
    signal,
  });
  if (!response.ok) throw new Error(`${source} HTTP ${response.status}`);
  const version = parse(await response.text());
  if (!version) throw new Error(`${source} invalid metadata`);
  return { version, source };
}

export async function lookupLatestVersion(
  fetcher: UpdateFetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<LatestVersionLookup> {
  const failures: string[] = [];
  try {
    return await fetchVersion(
      fetcher,
      UPDATE_MIRROR_VERSION_URL,
      'mirror',
      mirrorVersion,
      signal,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'mirror unknown error');
  }
  try {
    return await fetchVersion(
      fetcher,
      GITHUB_LATEST_YML_URL,
      'github-release',
      latestYmlVersion,
      signal,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'github-release unknown error');
  }
  throw new Error(`업데이트 메타데이터를 읽지 못했습니다: ${failures.join('; ')}`);
}

export function updaterFailureCode(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/abort|timeout/i.test(text)) return 'UPD-TIMEOUT';
  if (/certificate|cert_|ssl|tls/i.test(text)) return 'UPD-CERT';
  if (/proxy|407/i.test(text)) return 'UPD-PROXY';
  if (/ENOTFOUND|EAI_AGAIN|name not resolved|dns/i.test(text)) return 'UPD-DNS';
  const http = /\b(?:HTTP\s*)?([45]\d{2})\b/i.exec(text);
  return http ? `UPD-HTTP-${http[1]}` : 'UPD-CHECK';
}

export function safeUpdaterErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/\S+/gi, (url) => url.replace(/\?.*$/, '?…'))
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}
