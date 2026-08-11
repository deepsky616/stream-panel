import { describe, expect, it } from 'vitest';
import type { WebConnectorDiagnosticInput } from '../src/main/services/webConnector/diagnostics';
import {
  createDiagnosticEntry,
  createWebConnectorDiagnostics,
} from '../src/main/services/webConnector/diagnostics';

describe('web connector diagnostics', () => {
  it('keeps only fixed workflow metadata and a hostname', () => {
    const input = {
      at: 1_800_000_000_000,
      browserId: 'edge',
      officeCode: 'goe',
      workflowId: 'neis-leave',
      stepId: 'open-leave-form',
      sequence: 4,
      outcome: 'failed',
      durationMs: 1_250,
      currentUrl: 'https://goe.neis.go.kr/path/to/form?token=very-secret',
      cookie: 'SESSION=very-secret',
      screenText: '교직원 개인정보가 있는 화면',
    } as unknown as WebConnectorDiagnosticInput;

    const entry = createDiagnosticEntry(input);
    const serialized = JSON.stringify(entry);

    expect(entry).toEqual({
      at: 1_800_000_000_000,
      browserId: 'edge',
      officeCode: 'goe',
      workflowId: 'neis-leave',
      stepId: 'open-leave-form',
      sequence: 4,
      outcome: 'failed',
      durationMs: 1_250,
      host: 'goe.neis.go.kr',
    });
    expect(serialized).not.toMatch(/very-secret|SESSION|path\/to|개인정보|currentUrl|cookie|screenText/);
  });

  it('omits malformed addresses instead of logging their original text', () => {
    const entry = createDiagnosticEntry({
      at: 1,
      browserId: 'chrome',
      officeCode: 'sen',
      stepId: 'prepare-browser',
      sequence: 1,
      outcome: 'failed',
      durationMs: 10,
      currentUrl: 'not-a-url secret-value',
    });

    expect(entry).not.toHaveProperty('host');
    expect(JSON.stringify(entry)).not.toContain('secret-value');
  });

  it('records the system for portal connection stages without storing the full address', () => {
    const entry = createDiagnosticEntry({
      at: 1_800_000_000_000,
      browserId: 'edge',
      officeCode: 'goe',
      system: 'edufine',
      stepId: 'connection-authenticated',
      sequence: 0,
      outcome: 'success',
      durationMs: 320,
      currentUrl: 'https://klef.goe.go.kr/private/path?token=secret',
    });

    expect(entry).toMatchObject({
      system: 'edufine',
      stepId: 'connection-authenticated',
      host: 'klef.goe.go.kr',
    });
    expect(JSON.stringify(entry)).not.toMatch(/private\/path|token|secret/);
  });

  it('writes a JSON line only inside the sanitized diagnostics directory', async () => {
    const directories: Array<{ path: string; mode?: number; recursive?: boolean }> = [];
    const writes: Array<{ path: string; text: string }> = [];
    const diagnostics = createWebConnectorDiagnostics({
      userDataPath: 'C:\\StreamPanel',
      platform: 'win32',
      makeDirectory: async (path, options) => { directories.push({ path, ...options }); },
      appendText: async (path, text) => { writes.push({ path, text }); },
    });

    await diagnostics.record({
      at: 1_800_000_000_000,
      browserId: 'edge',
      officeCode: 'goe',
      workflowId: 'edufine-draft',
      stepId: 'open-editor',
      sequence: 3,
      outcome: 'success',
      durationMs: 500,
      currentUrl: 'https://klef.goe.go.kr/draft?id=secret',
    });

    expect(diagnostics.directory).toBe('C:\\StreamPanel\\web-connector\\diagnostics');
    expect(directories).toEqual([{
      path: 'C:\\StreamPanel\\web-connector\\diagnostics',
      recursive: true,
      mode: 0o700,
    }]);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(
      'C:\\StreamPanel\\web-connector\\diagnostics\\events.jsonl',
    );
    expect(writes[0].text.endsWith('\n')).toBe(true);
    expect(writes[0].text).not.toContain('id=secret');
  });
});
