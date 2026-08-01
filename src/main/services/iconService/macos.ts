import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import { nativeImage } from 'electron';

export function parseMacIconMetadata(output: string): string[] {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const value = parsed as Record<string, unknown>;
    const direct = typeof value.CFBundleIconFile === 'string' ? [value.CFBundleIconFile] : [];
    const icons = value.CFBundleIcons;
    if (!icons || typeof icons !== 'object' || Array.isArray(icons)) return direct;
    const primary = (icons as Record<string, unknown>).CFBundlePrimaryIcon;
    if (!primary || typeof primary !== 'object' || Array.isArray(primary)) return direct;
    const files = (primary as Record<string, unknown>).CFBundleIconFiles;
    if (!Array.isArray(files)) return direct;
    return [
      ...direct,
      ...files.filter((file): file is string => typeof file === 'string').reverse(),
    ];
  } catch {
    return [];
  }
}

function readIconNames(bundlePath: string): Promise<string[]> {
  const plistPath = posix.join(bundlePath, 'Contents', 'Info.plist');
  return new Promise((resolve) => {
    execFile(
      'plutil',
      ['-convert', 'json', '-o', '-', plistPath],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? [] : parseMacIconMetadata(stdout)),
    );
  });
}

function convertIcon(iconPath: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'sips',
      ['-z', '144', '144', '-s', 'format', 'png', iconPath, '--out', outputPath],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 512 * 1024 },
      (error) => resolve(!error),
    );
  });
}

export async function getMacosBundleIcon(
  bundlePath: string,
  outputPath: string,
): Promise<Electron.NativeImage | null> {
  try {
    const names = await readIconNames(bundlePath);
    for (const name of names) {
      const filename = posix.extname(name) ? name : `${name}.icns`;
      const iconPath = posix.join(bundlePath, 'Contents', 'Resources', filename);
      if (!(await convertIcon(iconPath, outputPath))) continue;
      const image = nativeImage.createFromPath(outputPath);
      if (!image.isEmpty()) return image;
    }
    return null;
  } catch {
    return null;
  }
}
