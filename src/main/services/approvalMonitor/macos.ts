import type { ApprovalMonitorScanner } from './index';

export function createMacosApprovalScanner(): ApprovalMonitorScanner {
  return {
    async scan() {
      throw new Error('결재 대기 알림은 윈도우에서만 사용할 수 있습니다. 윈도우에서 다시 시도해 주세요.');
    },
  };
}
