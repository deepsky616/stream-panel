export function resolveWindowsConnectorBrowserExecutable(
  browserPath: string,
  exists: (path: string) => boolean,
): string | null {
  return exists(browserPath) ? browserPath : null;
}
