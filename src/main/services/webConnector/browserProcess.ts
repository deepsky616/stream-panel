import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { posix, win32 } from 'node:path';
import type { EducationOfficeCode, WebConnectorBrowserId } from '../../../shared/types';

export type ManagedBrowserTransportKind = 'pipe' | 'port';

export interface ManagedBrowserLaunch {
  executable: string;
  args: readonly string[];
  options: SpawnOptions;
  transport: ManagedBrowserTransportKind;
}

export interface BuildManagedBrowserLaunchOptions {
  browserId: WebConnectorBrowserId;
  executable: string;
  profilePath: string;
  transport: ManagedBrowserTransportKind;
}

export interface SpawnManagedBrowserDependencies {
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  waitForExit?: (child: ChildProcess, timeoutMs: number) => Promise<boolean>;
}

function pathApi(platform: 'win32' | 'darwin'): typeof win32 | typeof posix {
  return platform === 'win32' ? win32 : posix;
}

export function resolveManagedProfilePath(
  userDataPath: string,
  officeCode: EducationOfficeCode,
  browserId: WebConnectorBrowserId,
  platform: 'win32' | 'darwin' = process.platform === 'win32' ? 'win32' : 'darwin',
): string {
  const api = pathApi(platform);
  if (!api.isAbsolute(userDataPath)) {
    throw new TypeError('업무용 브라우저 자료 폴더는 절대 경로여야 합니다. 앱 설정 폴더를 확인해 주세요.');
  }
  const root = api.resolve(userDataPath, 'web-browsers');
  const profilePath = api.resolve(root, officeCode, browserId);
  if (!profilePath.startsWith(`${root}${api.sep}`)) {
    throw new TypeError('업무용 브라우저 자료 폴더가 허용된 위치를 벗어났습니다. 앱을 다시 시작해 주세요.');
  }
  return profilePath;
}

function executableMatchesBrowser(
  browserId: WebConnectorBrowserId,
  executable: string,
): boolean {
  const normalized = executable.replaceAll('\\', '/').toLowerCase();
  return browserId === 'edge'
    ? normalized.endsWith('/msedge.exe')
    : normalized.endsWith('/chrome.exe');
}

export function buildManagedBrowserLaunch({
  browserId,
  executable,
  profilePath,
  transport,
}: BuildManagedBrowserLaunchOptions): ManagedBrowserLaunch {
  if (!executableMatchesBrowser(browserId, executable)) {
    throw new TypeError('선택한 업무용 브라우저와 실행 파일이 다릅니다. 브라우저 설치를 확인해 주세요.');
  }
  const args = [
    `--user-data-dir=${profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    transport === 'pipe' ? '--remote-debugging-pipe' : '--remote-debugging-port=0',
  ];
  return {
    executable,
    args,
    options: {
      detached: false,
      stdio: transport === 'pipe'
        ? ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']
        : 'ignore',
      windowsHide: false,
    },
    transport,
  };
}

async function defaultWaitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise<boolean>((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

export class OwnedBrowserProcess {
  constructor(
    private readonly child: ChildProcess,
    readonly launch: ManagedBrowserLaunch,
    private readonly waitForExit: (child: ChildProcess, timeoutMs: number) => Promise<boolean>,
  ) {}

  get pid(): number | undefined {
    return this.child.pid;
  }

  get exited(): boolean {
    return this.child.exitCode !== null;
  }

  get inputPipe(): NodeJS.WritableStream | null {
    return this.launch.transport === 'pipe'
      ? (this.child.stdio[3] as NodeJS.WritableStream | null)
      : null;
  }

  get outputPipe(): NodeJS.ReadableStream | null {
    return this.launch.transport === 'pipe'
      ? (this.child.stdio[4] as NodeJS.ReadableStream | null)
      : null;
  }

  async close(requestGraceful?: () => Promise<void>, timeoutMs = 2_000): Promise<void> {
    if (this.exited) return;
    try {
      await requestGraceful?.();
    } catch {
      // A failed graceful request still permits stopping this owned child.
    }
    if (await this.waitForExit(this.child, timeoutMs)) return;
    if (!this.exited) this.child.kill();
  }
}

export function spawnManagedBrowser(
  launch: ManagedBrowserLaunch,
  {
    spawnProcess = (command, args, options) => spawn(command, [...args], options),
    waitForExit = defaultWaitForExit,
  }: SpawnManagedBrowserDependencies = {},
): OwnedBrowserProcess {
  const child = spawnProcess(launch.executable, launch.args, launch.options);
  return new OwnedBrowserProcess(child, launch, waitForExit);
}
