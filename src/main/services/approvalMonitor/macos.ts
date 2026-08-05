import type { ApprovalMonitorScanner } from './index';

export function createMacosApprovalScanner(): ApprovalMonitorScanner {
  return {
    async scan() {
      return 0;
    },
  };
}
