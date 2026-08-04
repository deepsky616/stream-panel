import type {
  WebConnectorBrowserId,
  WebConnectorStatus,
} from '../../../shared/types';
import type { ManagedWorkflowRequest } from './sessionManager';

export function isMacosManagedBrowserAutomationSupported(): false {
  return false;
}

export interface MacosWebAutomation {
  getStatuses(): WebConnectorStatus[];
  prepare(browserId: WebConnectorBrowserId): Promise<{ ok: false; message: string }>;
  run(request: ManagedWorkflowRequest): Promise<{ ok: false; message: string }>;
  closeAll(): Promise<void>;
}

export interface CreateMacosWebAutomationOptions {
  onPlatformCall?: () => void;
}

const MACOS_UNSUPPORTED_MESSAGE =
  '나이스와 에듀파인 자동 이동은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 실행해 주세요.';

export function createMacosWebAutomation(
  options: CreateMacosWebAutomationOptions = {},
): MacosWebAutomation {
  void options;
  return {
    getStatuses: () => [
      { browserId: 'edge', paired: false, connected: false },
      { browserId: 'chrome', paired: false, connected: false },
    ],
    prepare: async () => ({ ok: false, message: MACOS_UNSUPPORTED_MESSAGE }),
    run: async () => ({ ok: false, message: MACOS_UNSUPPORTED_MESSAGE }),
    closeAll: async () => undefined,
  };
}
