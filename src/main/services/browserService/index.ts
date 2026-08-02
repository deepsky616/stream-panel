import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DetectedBrowser } from '../../../shared/types';
import { readChromiumProfiles } from './profiles';
import { getMacosBrowserCandidates } from './macos';
import type { BrowserBackend, BrowserCandidate, BrowserService } from './types';
import { getWindowsBrowserCandidates } from './windows';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheDocument {
  timestamp: number;
  browsers: DetectedBrowser[];
}

export interface CreateBrowserServiceOptions {
  userDataPath: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homePath?: string;
  now?: () => number;
  exists?: (path: string) => boolean;
  readProfiles?: (localStatePath: string) => Promise<DetectedBrowser['profiles']>;
  getIcon?: (path: string) => Promise<string | undefined>;
}

class PlatformBrowserBackend implements BrowserBackend {
  constructor(
    private readonly candidates: BrowserCandidate[],
    private readonly exists: (path: string) => boolean,
    private readonly readProfiles: (localStatePath: string) => Promise<DetectedBrowser['profiles']>,
    private readonly getIcon: (path: string) => Promise<string | undefined>,
  ) {}

  async scan(): Promise<DetectedBrowser[]> {
    const found: DetectedBrowser[] = [];
    const seen = new Set<DetectedBrowser['id']>();
    for (const candidate of this.candidates) {
      if (seen.has(candidate.id) || !this.exists(candidate.path)) continue;
      try {
        const [profiles, iconDataUrl] = await Promise.all([
          candidate.localStatePath
            ? this.readProfiles(candidate.localStatePath).catch(() => [])
            : Promise.resolve([]),
          this.getIcon(candidate.path).catch(() => undefined),
        ]);
        found.push({
          id: candidate.id,
          name: candidate.name,
          path: candidate.path,
          family: candidate.family,
          supportsAppMode: candidate.supportsAppMode,
          supportsProfiles: candidate.supportsProfiles,
          profiles,
          ...(iconDataUrl ? { iconDataUrl } : {}),
        });
        seen.add(candidate.id);
      } catch {
        // A broken browser installation does not block the rest of the list.
      }
    }
    return found;
  }
}

class NullBrowserBackend implements BrowserBackend {
  async scan(): Promise<DetectedBrowser[]> {
    return [];
  }
}

class CachedBrowserService implements BrowserService {
  private readonly cachePath: string;
  private memoryCache: CacheDocument | null = null;

  constructor(
    private readonly backend: BrowserBackend,
    userDataPath: string,
    private readonly now: () => number,
  ) {
    this.cachePath = join(userDataPath, 'cache', 'browsers.json');
  }

  async list(refresh = false): Promise<DetectedBrowser[]> {
    if (!refresh) {
      const cached = await this.readCache();
      if (cached) return cached;
    }
    let browsers: DetectedBrowser[] = [];
    try {
      browsers = await this.backend.scan();
    } catch {
      browsers = [];
    }
    const document = { timestamp: this.now(), browsers };
    this.memoryCache = document;
    try {
      await mkdir(dirname(this.cachePath), { recursive: true });
      await writeFile(this.cachePath, JSON.stringify(document), 'utf8');
    } catch {
      // Cache failures must not block browser selection.
    }
    return browsers;
  }

  private async readCache(): Promise<DetectedBrowser[] | null> {
    if (this.memoryCache && this.now() - this.memoryCache.timestamp < CACHE_TTL_MS) {
      return this.memoryCache.browsers;
    }
    try {
      const parsed = JSON.parse(await readFile(this.cachePath, 'utf8')) as CacheDocument;
      if (
        !Number.isFinite(parsed.timestamp) ||
        !Array.isArray(parsed.browsers) ||
        this.now() - parsed.timestamp >= CACHE_TTL_MS
      ) {
        return null;
      }
      this.memoryCache = parsed;
      return parsed.browsers;
    } catch {
      return null;
    }
  }
}

export function createBrowserService({
  userDataPath,
  platform = process.platform,
  env = process.env,
  homePath = homedir(),
  now = Date.now,
  exists = existsSync,
  readProfiles = readChromiumProfiles,
  getIcon = async () => undefined,
}: CreateBrowserServiceOptions): BrowserService {
  const candidates =
    platform === 'win32'
      ? getWindowsBrowserCandidates(env)
      : platform === 'darwin'
        ? getMacosBrowserCandidates(homePath)
        : null;
  const backend = candidates
    ? new PlatformBrowserBackend(candidates, exists, readProfiles, getIcon)
    : new NullBrowserBackend();
  return new CachedBrowserService(backend, userDataPath, now);
}
