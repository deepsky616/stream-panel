export type SupportedPlatform = 'win32' | 'darwin';

export function resolveSupportedPlatform(
  platform: NodeJS.Platform = process.platform,
): SupportedPlatform | null {
  switch (platform) {
    case 'win32':
    case 'darwin':
      return platform;
    default:
      return null;
  }
}
