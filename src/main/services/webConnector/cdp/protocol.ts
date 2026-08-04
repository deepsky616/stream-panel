import type { WebConnectorBrowserId } from '../../../../shared/types';
import type { CdpTransport } from './transport';

export type AllowedCdpMethod =
  | 'Browser.getVersion'
  | 'Browser.close'
  | 'Target.getTargets'
  | 'Target.createTarget'
  | 'Target.attachToTarget'
  | 'Target.activateTarget'
  | 'Target.setDiscoverTargets'
  | 'Page.enable'
  | 'Page.navigate'
  | 'Page.bringToFront'
  | 'Runtime.evaluate'
  | 'Input.dispatchMouseEvent';

const ALLOWED_METHODS = new Set<AllowedCdpMethod>([
  'Browser.getVersion',
  'Browser.close',
  'Target.getTargets',
  'Target.createTarget',
  'Target.attachToTarget',
  'Target.activateTarget',
  'Target.setDiscoverTargets',
  'Page.enable',
  'Page.navigate',
  'Page.bringToFront',
  'Runtime.evaluate',
  'Input.dispatchMouseEvent',
]);

export interface CdpBrowserVersion {
  protocolVersion: string;
  product: string;
  revision: string;
  userAgent: string;
  jsVersion: string;
}

export class ManagedBrowserIdentityError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedBrowserIdentityError';
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface CdpEvent {
  method: string;
  params?: unknown;
  sessionId?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류';
}

export class CdpProtocol {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventListeners = new Set<(event: CdpEvent) => void>();
  private readonly removeMessageListener: () => void;
  private readonly removeCloseListener: () => void;
  private closed = false;

  constructor(private readonly transport: CdpTransport) {
    this.removeMessageListener = transport.onMessage((message) => this.receive(message));
    this.removeCloseListener = transport.onClose((reason) => {
      this.closed = true;
      this.failAll(
        reason ?? new Error('업무용 브라우저 제어 통로가 닫혔습니다. 브라우저를 다시 열어 주세요.'),
      );
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send<T = unknown>(
    method: AllowedCdpMethod,
    params: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = 5_000,
  ): Promise<T> {
    if (!ALLOWED_METHODS.has(method)) {
      throw new TypeError('허용되지 않은 브라우저 제어 명령입니다. 앱을 다시 시작해 주세요.');
    }
    if (this.closed) {
      return Promise.reject(new Error('업무용 브라우저 제어 통로가 닫혔습니다. 다시 연결해 주세요.'));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('업무용 브라우저 응답 시간이 지났습니다. 브라우저를 닫고 다시 시도해 주세요.'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.transport.send(JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`업무용 브라우저에 명령을 보내지 못했습니다. 다시 연결해 주세요: ${errorMessage(error)}`));
      }
    });
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.removeMessageListener();
    this.removeCloseListener();
    this.failAll(new Error('업무용 브라우저 제어 통로를 닫았습니다.'));
    this.transport.close();
  }

  private receive(message: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.failAll(new Error('업무용 브라우저 응답 형식이 올바르지 않습니다. 브라우저를 다시 열어 주세요.'));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const record = parsed as Record<string, unknown>;
    if (typeof record.id === 'number') {
      const request = this.pending.get(record.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(record.id);
      if (record.error && typeof record.error === 'object') {
        const detail = (record.error as Record<string, unknown>).message;
        request.reject(new Error(
          `업무용 브라우저가 명령을 거부했습니다. 화면을 직접 확인해 주세요: ${typeof detail === 'string' ? detail : '원인을 확인할 수 없습니다.'}`,
        ));
      } else {
        request.resolve(record.result);
      }
      return;
    }
    if (typeof record.method === 'string') {
      const event: CdpEvent = {
        method: record.method,
        ...(record.params !== undefined ? { params: record.params } : {}),
        ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
      };
      for (const listener of this.eventListeners) listener(event);
    }
  }

  private failAll(reason: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(reason);
    }
    this.pending.clear();
  }
}

export function validateManagedBrowserIdentity(
  browserId: WebConnectorBrowserId,
  value: unknown,
): asserts value is CdpBrowserVersion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManagedBrowserIdentityError('업무용 브라우저 종류를 확인하지 못했습니다. 브라우저를 다시 설치해 주세요.');
  }
  const version = value as Record<string, unknown>;
  if (
    typeof version.product !== 'string' ||
    typeof version.userAgent !== 'string' ||
    typeof version.protocolVersion !== 'string'
  ) {
    throw new ManagedBrowserIdentityError('업무용 브라우저 버전 응답이 올바르지 않습니다. 브라우저를 업데이트해 주세요.');
  }
  const isEdge = /(?:^|\s)Edg\/[0-9.]+(?:\s|$)/.test(version.userAgent) ||
    /^Edg\/[0-9.]+$/.test(version.product);
  const isChrome = /^Chrome\/[0-9.]+$/.test(version.product) && !isEdge;
  if (browserId === 'edge' && !isEdge) {
    throw new ManagedBrowserIdentityError('연결된 브라우저가 엣지가 아닙니다. 설정에서 업무용 엣지를 다시 열어 주세요.');
  }
  if (browserId === 'chrome' && !isChrome) {
    throw new ManagedBrowserIdentityError('연결된 브라우저가 크롬이 아닙니다. 설정에서 업무용 크롬을 다시 열어 주세요.');
  }
}
