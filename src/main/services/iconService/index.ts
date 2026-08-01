import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeImage } from 'electron';
import type { ActionType } from '../../../shared/types';
import { resolveFavicon } from '../faviconService';
import { getMacosBundleIcon } from './macos';
import { getNativeFileIcon } from './windows';

interface IconMetadata {
  mtimeMs: number;
}

export async function resolveCustomIcon(
  filename: string,
  userDataPath: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]+\.png$/i.test(filename)) return null;
  try {
    const image = nativeImage.createFromBuffer(await readFile(join(userDataPath, 'icons', filename)));
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}

export async function resolveActionIcon(
  type: ActionType,
  target: string,
  userDataPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  try {
    if (type === 'url') return resolveFavicon(target, userDataPath);
    if (type === 'uwp') return null;
    const key = createHash('sha256').update(`${type}|${target}`).digest('hex');
    const directory = join(userDataPath, 'cache', 'icons');
    const imagePath = join(directory, `${key}.png`);
    const metadataPath = join(directory, `${key}.json`);
    const targetStats = await stat(target);
    try {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as IconMetadata;
      if (metadata.mtimeMs === targetStats.mtimeMs) {
        const cached = nativeImage.createFromBuffer(await readFile(imagePath));
        if (!cached.isEmpty()) return cached.toDataURL();
      }
    } catch {
      // Missing or stale cache entries are regenerated.
    }
    await mkdir(directory, { recursive: true });
    const image =
      platform === 'darwin' && type === 'app'
        ? await getMacosBundleIcon(target, imagePath)
        : await getNativeFileIcon(target);
    if (!image || image.isEmpty()) return null;
    await Promise.all([
      writeFile(imagePath, image.toPNG()),
      writeFile(metadataPath, JSON.stringify({ mtimeMs: targetStats.mtimeMs }), 'utf8'),
    ]);
    return image.toDataURL();
  } catch {
    return null;
  }
}
