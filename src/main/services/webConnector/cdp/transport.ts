import type { ManagedBrowserLaunch } from '../browserProcess';
import {
  buildManagedBrowserLaunch,
  spawnManagedBrowser,
  type OwnedBrowserProcess,
} from '../browserProcess';
import type { WebConnectorBrowserId } from '../../../../shared/types';
import { createPipeTransport } from './pipeTransport';
import {
  buildLoopbackWebSocketUrl,
  openWebSocketTransport,
  waitForDevToolsActivePort,
} from './portTransport';
import {
  CdpProtocol,
  ManagedBrowserIdentityError,
  validateManagedBrowserIdentity,
} from './protocol';

export type CdpTransportMessageListener = (message: string) => void;

export interface CdpTransport {
  send(message: string): void;
  onMessage(listener: CdpTransportMessageListener): () => void;
  onClose(listener: (reason?: Error) => void): () => void;
  close(): void;
}

export interface ManagedBrowserProcessHandle {
  readonly launch: ManagedBrowserLaunch;
  readonly pid: number | undefined;
  readonly exited: boolean;
  readonly inputPipe: NodeJS.WritableStream | null;
  readonly outputPipe: NodeJS.ReadableStream | null;
  close(requestGraceful?: () => Promise<void>, timeoutMs?: number): Promise<void>;
}

export interface ManagedBrowserConnectOptions {
  browserId: WebConnectorBrowserId;
  executable: string;
  profilePath: string;
  handshakeTimeoutMs?: number;
}

export interface ManagedBrowserConnectDependencies {
  spawnBrowser?: (launch: ManagedBrowserLaunch) => ManagedBrowserProcessHandle;
  connectPipe?: (process: ManagedBrowserProcessHandle, timeoutMs: number) => Promise<CdpTransport>;
  connectPort?: (
    process: ManagedBrowserProcessHandle,
    profilePath: string,
    timeoutMs: number,
  ) => Promise<CdpTransport>;
}

export interface ManagedBrowserConnection {
  process: ManagedBrowserProcessHandle;
  protocol: CdpProtocol;
  transportKind: 'pipe' | 'port';
}

async function defaultConnectPipe(process: ManagedBrowserProcessHandle): Promise<CdpTransport> {
  if (!process.inputPipe || !process.outputPipe) {
    throw new Error('업무용 브라우저 파이프를 만들지 못했습니다.');
  }
  return createPipeTransport(process.inputPipe, process.outputPipe);
}

async function defaultConnectPort(
  _process: ManagedBrowserProcessHandle,
  profilePath: string,
  timeoutMs: number,
): Promise<CdpTransport> {
  const activePort = await waitForDevToolsActivePort(profilePath, timeoutMs);
  return openWebSocketTransport(buildLoopbackWebSocketUrl(activePort), { timeoutMs });
}

async function handshake(
  browserId: WebConnectorBrowserId,
  transport: CdpTransport,
  timeoutMs: number,
): Promise<CdpProtocol> {
  const protocol = new CdpProtocol(transport);
  try {
    const version = await protocol.send('Browser.getVersion', {}, undefined, timeoutMs);
    validateManagedBrowserIdentity(browserId, version);
    return protocol;
  } catch (error) {
    protocol.close();
    throw error;
  }
}

export async function connectManagedBrowser(
  {
    browserId,
    executable,
    profilePath,
    handshakeTimeoutMs = 5_000,
  }: ManagedBrowserConnectOptions,
  {
    spawnBrowser = (launch) => spawnManagedBrowser(launch) as OwnedBrowserProcess,
    connectPipe = defaultConnectPipe,
    connectPort = defaultConnectPort,
  }: ManagedBrowserConnectDependencies = {},
): Promise<ManagedBrowserConnection> {
  const pipeProcess = spawnBrowser(buildManagedBrowserLaunch({
    browserId,
    executable,
    profilePath,
    transport: 'pipe',
  }));
  try {
    const transport = await connectPipe(pipeProcess, handshakeTimeoutMs);
    const protocol = await handshake(browserId, transport, handshakeTimeoutMs);
    return { process: pipeProcess, protocol, transportKind: 'pipe' };
  } catch (error) {
    await pipeProcess.close();
    if (error instanceof ManagedBrowserIdentityError) throw error;
  }

  const portProcess = spawnBrowser(buildManagedBrowserLaunch({
    browserId,
    executable,
    profilePath,
    transport: 'port',
  }));
  try {
    const transport = await connectPort(portProcess, profilePath, handshakeTimeoutMs);
    const protocol = await handshake(browserId, transport, handshakeTimeoutMs);
    return { process: portProcess, protocol, transportKind: 'port' };
  } catch (error) {
    await portProcess.close();
    if (error instanceof ManagedBrowserIdentityError) throw error;
    throw new Error(
      '업무용 브라우저 제어 통로를 열지 못했습니다. 브라우저 설치와 보안 정책을 확인해 주세요. 파이프와 무작위 포트 연결이 모두 실패했습니다.',
    );
  }
}
