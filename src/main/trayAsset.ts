import { join } from 'node:path';

export interface TrayAssetPathsInput {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  assetName: string;
}

export function resolveTrayAssetPaths(input: TrayAssetPathsInput): string[] {
  if (input.isPackaged) {
    return [
      join(input.resourcesPath, 'resources', input.assetName),
      join(input.appPath, 'resources', input.assetName),
    ];
  }
  return [join(input.appPath, 'resources', input.assetName)];
}
