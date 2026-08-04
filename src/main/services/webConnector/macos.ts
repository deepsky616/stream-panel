export function isMacosManagedBrowserAutomationSupported(): false {
  return false;
}

export async function resolveMacosConnectorBrowserExecutable(
  bundlePath: string,
  exists: (path: string) => boolean,
  resolveBundleExecutable: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const executable = await resolveBundleExecutable(bundlePath);
  return executable && exists(executable) ? executable : null;
}
