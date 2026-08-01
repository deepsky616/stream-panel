import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeImage, net } from 'electron';

const MAX_ICON_BYTES = 512 * 1024;

async function fetchImage(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await net.fetch(url, { redirect: 'follow', signal: controller.signal });
    const contentType = response.headers.get('content-type') ?? '';
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (!response.ok || !contentType.startsWith('image/') || contentLength > MAX_ICON_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= MAX_ICON_BYTES ? buffer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveFavicon(target: string, userDataPath: string): Promise<string | null> {
  try {
    const host = new URL(target).hostname;
    if (!host) return null;
    const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, '_');
    const directory = join(userDataPath, 'cache', 'favicons');
    const cachePath = join(directory, `${safeHost}.png`);
    try {
      const cached = nativeImage.createFromBuffer(await readFile(cachePath));
      if (!cached.isEmpty()) return cached.toDataURL();
    } catch {
      // A cache miss is expected on first use.
    }
    const sources = [
      `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    ];
    for (const source of sources) {
      const buffer = await fetchImage(source);
      if (!buffer) continue;
      const image = nativeImage.createFromBuffer(buffer);
      if (image.isEmpty()) continue;
      await mkdir(directory, { recursive: true });
      await writeFile(cachePath, image.toPNG());
      return image.toDataURL();
    }
    return null;
  } catch {
    return null;
  }
}
