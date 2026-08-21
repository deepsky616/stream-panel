import { describe, expect, it } from 'vitest';
import type {
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebWorkflowId,
} from '../src/shared/types';
import {
  ManagedBrowserSessionManager,
  type ManagedBrowserSession,
  type ManagedWorkflowRequest,
} from '../src/main/services/webConnector/sessionManager';

interface FakeSession extends ManagedBrowserSession {
  id: number;
  alive: boolean;
  closeCount: number;
}

function request(
  officeCode: EducationOfficeCode,
  browserId: WebConnectorBrowserId,
  workflowId: WebWorkflowId = 'neis-leave',
): ManagedWorkflowRequest {
  return { officeCode, browserId, workflowId };
}

describe('managed browser session manager', () => {
  it('does not create a browser for an existing-session-only operation', async () => {
    let creations = 0;
    const manager = new ManagedBrowserSessionManager<FakeSession, string>({
      createSession: async (officeCode, browserId) => {
        creations += 1;
        const session: FakeSession = {
          id: creations,
          officeCode,
          browserId,
          alive: true,
          closeCount: 0,
          isAlive() { return this.alive; },
          async close() { this.closeCount += 1; this.alive = false; },
        };
        return session;
      },
      executeWorkflow: async () => 'done',
    });

    await expect(manager.useExisting('goe', 'edge', async () => 5)).resolves.toBeUndefined();
    expect(creations).toBe(0);

    await manager.prepare('goe', 'edge');
    await expect(manager.useExisting('goe', 'edge', async (session) => session.id)).resolves.toBe(1);
    expect(creations).toBe(1);
  });

  it('does not replace a closed browser for an existing-session-only operation', async () => {
    const sessions: FakeSession[] = [];
    const manager = new ManagedBrowserSessionManager<FakeSession, string>({
      createSession: async (officeCode, browserId) => {
        const session: FakeSession = {
          id: sessions.length + 1,
          officeCode,
          browserId,
          alive: true,
          closeCount: 0,
          isAlive() { return this.alive; },
          async close() { this.closeCount += 1; this.alive = false; },
        };
        sessions.push(session);
        return session;
      },
      executeWorkflow: async () => 'done',
    });

    const prepared = await manager.prepare('goe', 'edge');
    prepared.alive = false;
    await expect(manager.useExisting('goe', 'edge', async () => 'unexpected')).resolves.toBeUndefined();
    expect(sessions).toHaveLength(1);
  });

  it('runs a read-only session operation in the same queue as workflow execution', async () => {
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const events: string[] = [];
    const manager = new ManagedBrowserSessionManager<FakeSession, string>({
      createSession: async (officeCode, browserId) => {
        const session: FakeSession = {
          id: 1,
          officeCode,
          browserId,
          alive: true,
          closeCount: 0,
          isAlive() { return this.alive; },
          async close() { this.closeCount += 1; this.alive = false; },
        };
        return session;
      },
      executeWorkflow: async () => {
        events.push('workflow:start');
        events.push('workflow:finish');
        return 'done';
      },
    });

    const read = manager.use('goe', 'edge', async (session) => {
      events.push(`read:start:${session.id}`);
      await readGate;
      events.push(`read:finish:${session.id}`);
      return 5;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const workflow = manager.run(request('goe', 'edge'));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual(['read:start:1']);
    releaseRead();
    await expect(read).resolves.toBe(5);
    await expect(workflow).resolves.toBe('done');
    expect(events).toEqual([
      'read:start:1',
      'read:finish:1',
      'workflow:start',
      'workflow:finish',
    ]);
  });

  it('reuses one live session and serializes workflows for the same office and browser', async () => {
    let nextId = 1;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const events: string[] = [];
    const manager = new ManagedBrowserSessionManager<FakeSession, string>({
      createSession: async (officeCode, browserId) => {
        const session: FakeSession = {
          id: nextId++,
          officeCode,
          browserId,
          alive: true,
          closeCount: 0,
          isAlive: () => session.alive,
          close: async () => { session.closeCount += 1; session.alive = false; },
        };
        return session;
      },
      executeWorkflow: async (session, workflowRequest) => {
        events.push(`start:${session.id}:${workflowRequest.workflowId}`);
        if (workflowRequest.workflowId === 'neis-leave') await firstGate;
        events.push(`finish:${session.id}:${workflowRequest.workflowId}`);
        return `${session.id}:${workflowRequest.workflowId}`;
      },
    });

    const first = manager.run(request('goe', 'edge', 'neis-leave'));
    const second = manager.run(request('goe', 'edge', 'neis-trip'));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual(['start:1:neis-leave']);
    releaseFirst();
    await expect(first).resolves.toBe('1:neis-leave');
    await expect(second).resolves.toBe('1:neis-trip');
    expect(events).toEqual([
      'start:1:neis-leave',
      'finish:1:neis-leave',
      'start:1:neis-trip',
      'finish:1:neis-trip',
    ]);
  });

  it('replaces a closed session once before the next workflow starts', async () => {
    const sessions: FakeSession[] = [];
    const manager = new ManagedBrowserSessionManager<FakeSession, number>({
      createSession: async (officeCode, browserId) => {
        const session: FakeSession = {
          id: sessions.length + 1,
          officeCode,
          browserId,
          alive: true,
          closeCount: 0,
          isAlive() { return this.alive; },
          async close() { this.closeCount += 1; this.alive = false; },
        };
        sessions.push(session);
        return session;
      },
      executeWorkflow: async (session) => session.id,
    });

    await expect(manager.run(request('goe', 'chrome'))).resolves.toBe(1);
    sessions[0].alive = false;
    await expect(manager.run(request('goe', 'chrome'))).resolves.toBe(2);

    expect(sessions).toHaveLength(2);
    expect(sessions[0].closeCount).toBe(1);
  });

  it('keeps browser and office sessions separate and closes only sessions it created', async () => {
    const sessions: FakeSession[] = [];
    const manager = new ManagedBrowserSessionManager<FakeSession, number>({
      createSession: async (officeCode, browserId) => {
        const session: FakeSession = {
          id: sessions.length + 1,
          officeCode,
          browserId,
          alive: true,
          closeCount: 0,
          isAlive() { return this.alive; },
          async close() { this.closeCount += 1; this.alive = false; },
        };
        sessions.push(session);
        return session;
      },
      executeWorkflow: async (session) => session.id,
    });

    await manager.run(request('goe', 'edge'));
    await manager.run(request('goe', 'chrome'));
    await manager.run(request('sen', 'edge'));
    await manager.closeOtherOffices('sen');

    expect(sessions.map(({ officeCode, browserId, closeCount }) => ({
      officeCode,
      browserId,
      closeCount,
    }))).toEqual([
      { officeCode: 'goe', browserId: 'edge', closeCount: 1 },
      { officeCode: 'goe', browserId: 'chrome', closeCount: 1 },
      { officeCode: 'sen', browserId: 'edge', closeCount: 0 },
    ]);

    await manager.closeAll();
    expect(sessions.map(({ closeCount }) => closeCount)).toEqual([1, 1, 1]);
  });
});
