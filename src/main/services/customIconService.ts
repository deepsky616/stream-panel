import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { nativeImage } from 'electron';

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.ico', '.bmp', '.webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function isSupportedImagePath(path: string): boolean {
  return ALLOWED_IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function importCustomIcon(sourcePath: string, userDataPath: string): Promise<string | null> {
  try {
    if (!isSupportedImagePath(sourcePath)) return null;
    const file = await stat(sourcePath);
    if (!file.isFile() || file.size > MAX_IMAGE_BYTES) return null;
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const side = Math.min(width, height);
    const cropped = image.crop({
      x: Math.floor((width - side) / 2),
      y: Math.floor((height - side) / 2),
      width: side,
      height: side,
    });
    const resized = cropped.resize({ width: 144, height: 144, quality: 'best' });
    const iconsPath = join(userDataPath, 'icons');
    await mkdir(iconsPath, { recursive: true });
    const filename = `${crypto.randomUUID()}.png`;
    await writeFile(join(iconsPath, filename), resized.toPNG());
    return filename;
  } catch {
    return null;
  }
}
