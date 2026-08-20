import { describe, expect, it } from 'vitest';
import { scanWindowsPortalApprovalCount } from '../src/main/services/webConnector/windows';

describe('Windows portal approval summary', () => {
  it('refreshes one persistent background portal tab and reuses its two-system snapshot', async () => {
    const commands: Array<{
      method: string;
      params: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    const targets = [
      {
        targetId: 'portal-main',
        type: 'page',
        url: 'https://goe.eduptl.kr/bpm_man_mn00_001.do',
      },
    ];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') return { targetInfos: targets };
        if (method === 'Target.createTarget') {
          targets.push({
            targetId: 'portal-monitor',
            type: 'page',
            url: String(params.url),
          });
          return { targetId: 'portal-monitor' };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: `${String(params.targetId)}-session` };
        }
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes('right-adjacent')) {
            return { result: { value: { candidates: [
              {
                system: 'neis',
                value: 0,
                panelLabel: '승인사항',
                itemLabel: '미결/협조함',
                relation: 'right-adjacent',
                controlContext: 'approval badge',
              },
              {
                system: 'edufine',
                value: 1,
                panelLabel: '전자결재 현황',
                itemLabel: '결재(긴급)',
                relation: 'right-adjacent',
                controlContext: 'approval badge',
              },
            ] } } };
          }
          return { result: { value: {
            href: 'https://goe.eduptl.kr/bpm_man_mn00_001.do',
            origin: 'https://goe.eduptl.kr',
            readyState: 'complete',
            loginVisible: false,
          } } };
        }
        if (method === 'Page.getFrameTree') {
          return { frameTree: { frame: { id: 'main-frame' } } };
        }
        return {};
      },
      close() { this.isClosed = true; },
    };
    const session = {
      officeCode: 'goe' as const,
      browserId: 'edge' as const,
      portalTargetId: 'portal-main',
      connection: {
        protocol,
        transportKind: 'pipe' as const,
        process: { exited: false },
      },
      maintenancePauseDepth: 0,
      cdpOperationTail: Promise.resolve(),
      workflowState: 'IDLE' as const,
      isAlive: () => true,
      close: async () => undefined,
    };

    await expect(scanWindowsPortalApprovalCount(session as never, 'neis')).resolves.toBe(0);
    await expect(scanWindowsPortalApprovalCount(session as never, 'edufine')).resolves.toBe(1);

    expect(commands.filter(({ method }) => method === 'Target.createTarget')).toEqual([{
      method: 'Target.createTarget',
      params: { url: 'https://goe.eduptl.kr/', background: true },
      sessionId: undefined,
    }]);
    expect(commands.filter(({ method }) => method === 'Page.reload')).toEqual([{
      method: 'Page.reload',
      params: { ignoreCache: true },
      sessionId: 'portal-monitor-session',
    }]);
    expect(session).toMatchObject({ approvalPortalTargetId: 'portal-monitor' });
  });
});
