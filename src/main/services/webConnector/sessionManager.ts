import type {
  EducationOfficeCode,
  WebConnectorBrowserId,
  WebWorkflowId,
} from '../../../shared/types';

export interface ManagedBrowserSession {
  readonly officeCode: EducationOfficeCode;
  readonly browserId: WebConnectorBrowserId;
  isAlive(): boolean;
  close(): Promise<void>;
}

export interface ManagedWorkflowRequest {
  officeCode: EducationOfficeCode;
  browserId: WebConnectorBrowserId;
  workflowId: WebWorkflowId;
}

export interface ManagedBrowserSessionManagerDependencies<
  Session extends ManagedBrowserSession,
  Result,
> {
  createSession(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): Promise<Session>;
  executeWorkflow(session: Session, request: ManagedWorkflowRequest): Promise<Result>;
}

interface SessionEntry<Session extends ManagedBrowserSession> {
  session?: Session;
  tail: Promise<void>;
}

function sessionKey(
  officeCode: EducationOfficeCode,
  browserId: WebConnectorBrowserId,
): string {
  return `${officeCode}:${browserId}`;
}

export class ManagedBrowserSessionManager<
  Session extends ManagedBrowserSession,
  Result,
> {
  private readonly entries = new Map<string, SessionEntry<Session>>();

  constructor(
    private readonly dependencies: ManagedBrowserSessionManagerDependencies<Session, Result>,
  ) {}

  prepare(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): Promise<Session> {
    return this.enqueue(officeCode, browserId, (entry) => this.ensureSession(
      entry,
      officeCode,
      browserId,
    ));
  }

  run(request: ManagedWorkflowRequest): Promise<Result> {
    return this.enqueue(request.officeCode, request.browserId, async (entry) => {
      const session = await this.ensureSession(
        entry,
        request.officeCode,
        request.browserId,
      );
      return this.dependencies.executeWorkflow(session, request);
    });
  }

  getSession(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): Session | undefined {
    return this.entries.get(sessionKey(officeCode, browserId))?.session;
  }

  listSessions(): readonly Session[] {
    return [...this.entries.values()].flatMap((entry) => entry.session ? [entry.session] : []);
  }

  async closeOtherOffices(officeCode: EducationOfficeCode): Promise<void> {
    const keys = [...this.entries.entries()]
      .filter(([, entry]) => entry.session?.officeCode !== officeCode)
      .map(([key]) => key);
    await Promise.all(keys.map((key) => this.closeEntry(key)));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((key) => this.closeEntry(key)));
  }

  private async ensureSession(
    entry: SessionEntry<Session>,
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
  ): Promise<Session> {
    if (entry.session?.isAlive()) return entry.session;
    if (entry.session) {
      await entry.session.close();
      entry.session = undefined;
    }
    const created = await this.dependencies.createSession(officeCode, browserId);
    entry.session = created;
    return created;
  }

  private enqueue<Value>(
    officeCode: EducationOfficeCode,
    browserId: WebConnectorBrowserId,
    operation: (entry: SessionEntry<Session>) => Promise<Value>,
  ): Promise<Value> {
    const key = sessionKey(officeCode, browserId);
    const entry = this.entries.get(key) ?? { tail: Promise.resolve() };
    this.entries.set(key, entry);
    const result = entry.tail.then(
      () => operation(entry),
      () => operation(entry),
    );
    entry.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async closeEntry(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    await entry.tail;
    if (entry.session) await entry.session.close();
    this.entries.delete(key);
  }
}
