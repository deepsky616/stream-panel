import { randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  WebConnectorBrowserId,
  WebConnectorStatus,
  WebWorkflowSpec,
} from '../../../shared/types';

export interface WebConnectorCommand {
  commandId: string;
  workflowId: WebWorkflowSpec['id'];
  browserId: WebConnectorBrowserId;
  target: string;
  origin: string;
  createdAt: number;
  expiresAt: number;
}

export interface WebConnectorResult {
  ok: boolean;
  message: string;
}

export interface WebConnectorBrokerOptions {
  now?: () => number;
  id?: () => string;
  commandTtlMs?: number;
  connectedWindowMs?: number;
  claimLeaseMs?: number;
  onResult?: (command: WebConnectorCommand, result: WebConnectorResult) => void;
  onExpired?: (command: WebConnectorCommand) => void;
}

interface InternalCommand extends WebConnectorCommand {
  claimedAt?: number;
}

interface BrowserState {
  paired: boolean;
  extensionVersion?: string;
  lastSeenAt?: number;
}

function publicCommand(command: InternalCommand): WebConnectorCommand {
  return {
    commandId: command.commandId,
    workflowId: command.workflowId,
    browserId: command.browserId,
    target: command.target,
    origin: command.origin,
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
  };
}

export type WebConnectorEnqueueResult =
  | { queued: true; commandId: string }
  | { queued: false; message: string };

export class WebConnectorBroker {
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly commandTtlMs: number;
  private readonly connectedWindowMs: number;
  private readonly claimLeaseMs: number;
  private readonly onResult: NonNullable<WebConnectorBrokerOptions['onResult']>;
  private readonly onExpired: NonNullable<WebConnectorBrokerOptions['onExpired']>;
  private readonly commands = new Map<string, InternalCommand>();
  private readonly browsers = new Map<WebConnectorBrowserId, BrowserState>([
    ['edge', { paired: false }],
    ['chrome', { paired: false }],
  ]);

  constructor({
    now = Date.now,
    id = randomUUID,
    commandTtlMs = 60_000,
    connectedWindowMs = 5_000,
    claimLeaseMs = 5_000,
    onResult = () => undefined,
    onExpired = () => undefined,
  }: WebConnectorBrokerOptions = {}) {
    this.now = now;
    this.id = id;
    this.commandTtlMs = commandTtlMs;
    this.connectedWindowMs = connectedWindowMs;
    this.claimLeaseMs = claimLeaseMs;
    this.onResult = onResult;
    this.onExpired = onExpired;
  }

  markPaired(browserId: WebConnectorBrowserId, extensionVersion: string): void {
    this.browsers.set(browserId, {
      paired: true,
      extensionVersion,
      lastSeenAt: this.now(),
    });
  }

  restorePaired(browserId: WebConnectorBrowserId, extensionVersion?: string): void {
    this.browsers.set(browserId, {
      paired: true,
      ...(extensionVersion ? { extensionVersion } : {}),
    });
  }

  markSeen(browserId: WebConnectorBrowserId, extensionVersion?: string): void {
    const current = this.browsers.get(browserId) ?? { paired: false };
    this.browsers.set(browserId, {
      ...current,
      paired: true,
      ...(extensionVersion ? { extensionVersion } : {}),
      lastSeenAt: this.now(),
    });
  }

  enqueue(spec: WebWorkflowSpec, target: string): WebConnectorEnqueueResult {
    this.cleanupExpired();
    if (!this.browsers.get(spec.browserId)?.paired) {
      const browserName = spec.browserId === 'edge' ? '엣지' : '크롬';
      return {
        queued: false,
        message: `${browserName} 확장 기능이 연결되지 않았습니다. 설정의 웹 업무 연결에서 연결 시험을 해 주세요.`,
      };
    }
    const createdAt = this.now();
    const commandId = this.id();
    const url = new URL(target);
    this.commands.set(commandId, {
      commandId,
      workflowId: spec.id,
      browserId: spec.browserId,
      target: url.href,
      origin: url.origin,
      createdAt,
      expiresAt: createdAt + this.commandTtlMs,
    });
    return { queued: true, commandId };
  }

  claim(browserId: WebConnectorBrowserId, origin: string): WebConnectorCommand | null {
    this.markSeen(browserId);
    this.cleanupExpired();
    let normalizedOrigin: string;
    try {
      normalizedOrigin = new URL(origin).origin;
    } catch {
      return null;
    }
    const now = this.now();
    for (const command of this.commands.values()) {
      if (
        command.browserId !== browserId ||
        command.origin !== normalizedOrigin ||
        (command.claimedAt !== undefined && now - command.claimedAt <= this.claimLeaseMs)
      ) {
        continue;
      }
      command.claimedAt = now;
      return publicCommand(command);
    }
    return null;
  }

  complete(
    browserId: WebConnectorBrowserId,
    commandId: string,
    result: WebConnectorResult,
  ): boolean {
    this.markSeen(browserId);
    this.cleanupExpired();
    const command = this.commands.get(commandId);
    if (!command || command.browserId !== browserId) return false;
    this.commands.delete(commandId);
    this.onResult(publicCommand(command), result);
    return true;
  }

  getStatus(browserId: WebConnectorBrowserId): WebConnectorStatus {
    this.cleanupExpired();
    const state = this.browsers.get(browserId) ?? { paired: false };
    const connected =
      state.lastSeenAt !== undefined && this.now() - state.lastSeenAt <= this.connectedWindowMs;
    return {
      browserId,
      paired: state.paired,
      connected,
      ...(state.extensionVersion ? { extensionVersion: state.extensionVersion } : {}),
      ...(state.lastSeenAt !== undefined ? { lastSeenAt: state.lastSeenAt } : {}),
    };
  }

  getStatuses(): WebConnectorStatus[] {
    return [this.getStatus('edge'), this.getStatus('chrome')];
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [commandId, command] of this.commands) {
      if (command.expiresAt >= now) continue;
      this.commands.delete(commandId);
      this.onExpired(publicCommand(command));
    }
  }
}

export function isAuthorizedWebConnectorToken(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
