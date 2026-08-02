import type { BrowserSpec, DetectedBrowser } from '../../../shared/types';

const PROFILE_DIRECTORY_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;

export function isValidProfileDirectory(value: string): boolean {
  return PROFILE_DIRECTORY_PATTERN.test(value) && !value.includes('..');
}

export function buildBrowserFlags(
  browser: Pick<DetectedBrowser, 'family'>,
  specification: BrowserSpec,
  url: string,
): string[] {
  if (browser.family !== 'chromium') return [url];
  const flags: string[] = [];
  if (specification.profileDir) {
    if (!isValidProfileDirectory(specification.profileDir)) {
      throw new TypeError('브라우저 프로필 폴더가 올바르지 않습니다. 목록에서 다시 선택해 주세요.');
    }
    flags.push(`--profile-directory=${specification.profileDir}`);
  }
  flags.push(specification.appMode ? `--app=${url}` : url);
  return flags;
}
