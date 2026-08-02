import { basename } from 'node:path';
import type { DetectedBrowser } from '../../../shared/types';

export function inferBrowserFamily(path: string): DetectedBrowser['family'] {
  const name = basename(path).toLocaleLowerCase();
  if (name.includes('firefox')) return 'firefox';
  if (name.includes('safari')) return 'safari';
  return 'chromium';
}
