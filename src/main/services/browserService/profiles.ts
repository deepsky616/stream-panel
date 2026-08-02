import { readFile } from 'node:fs/promises';
import type { BrowserProfile } from '../../../shared/types';
import { isValidProfileDirectory } from './flags';

export function parseChromiumProfiles(text: string | undefined): BrowserProfile[] {
  if (text === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const profile = (parsed as Record<string, unknown>).profile;
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return [];
    const infoCache = (profile as Record<string, unknown>).info_cache;
    if (!infoCache || typeof infoCache !== 'object' || Array.isArray(infoCache)) return [];
    return Object.entries(infoCache)
      .flatMap(([dir, value]): BrowserProfile[] => {
        if (!isValidProfileDirectory(dir) || !value || typeof value !== 'object' || Array.isArray(value)) {
          return [];
        }
        const name = (value as Record<string, unknown>).name;
        return typeof name === 'string' && name.trim()
          ? [{ dir, name: name.trim() }]
          : [];
      })
      .sort((left, right) => left.dir.localeCompare(right.dir, 'en'));
  } catch {
    return [];
  }
}

export async function readChromiumProfiles(localStatePath: string): Promise<BrowserProfile[]> {
  try {
    return parseChromiumProfiles(await readFile(localStatePath, 'utf8'));
  } catch {
    return [];
  }
}
