import { describe, expect, it } from 'vitest';
import { scanWindowsSystemApprovalCount } from '../src/main/services/webConnector/windows';

describe('Windows connected system approval summary', () => {
  it('reads the existing authenticated system tab without navigation, reload, click, or target creation', async () => {
    const commands: Array<{ method: string; params: Record<string, unknown>; sessionId?: string }> = [];
    const protocol = {
      isClosed: false,
      async send(method: string, params: Record<string, unknown>, sessionId?: string) {
        commands.push({ method, params, sessionId });
        if (method === 'Target.getTargets') return { targetInfos: [{
          targetId: 'neis-main',
          type: 'page',
          url: 'https://goe.neis.go.kr/jsp/main.jsp',
        }] };
        if (method === 'Target.attachToTarget') return { sessionId: 'neis-session' };
        if (method === 'Runtime.evaluate') {
          const expression = String(params.expression ?? '');
          if (expression.includes("relation:'nexacro'")) {
            return { result: { value: { candidates: [{
              system: 'neis',
              value: 2,
              itemLabel: '미결/협조함',
              relation: 'inline',
              confidence: 100,
              controlContext: 'global approval badge',
            }] } } };
          }
          if (expression.includes('window.name=')) {
            return { result: { value: 'stream-panel-neis' } };
          }
          return { result: { value: {
            href: 'https://goe.neis.go.kr/jsp/main.jsp',
            origin: 'https://goe.neis.go.kr',
            readyState: 'complete',
            loginVisible: false,
            neisReady: true,
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
      systemTargetIds: { neis: 'neis-main' },
      connectionTargetIds: { neis: 'neis-main' },
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

    await expect(scanWindowsSystemApprovalCount(session as never, 'neis')).resolves.toBe(2);

    expect(commands.some(({ method }) => method === 'Target.createTarget')).toBe(false);
    expect(commands.some(({ method }) => method === 'Page.reload')).toBe(false);
    expect(commands.some(({ method }) => method === 'Page.navigate')).toBe(false);
    expect(commands.filter(({ method }) => method === 'Runtime.evaluate').every(({ params }) => (
      !String(params.expression ?? '').includes('.click(')
    ))).toBe(true);
  });
});
