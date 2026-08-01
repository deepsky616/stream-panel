import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import { recoverConfigText } from '../src/main/store';

const defaults = createDefaultConfig(
  { downloads: '/Users/test/Downloads', documents: '/Users/test/Documents' },
  (() => {
    let index = 0;
    return () => `id-${index++}`;
  })(),
);

describe('store migration', () => {
  it('creates defaults when no config exists', () => {
    const result = recoverConfigText(undefined, defaults);
    expect(result.recovered).toBe(false);
    expect(result.config.root.map(({ label }) => label)).toEqual(['구글', '다운로드', '문서']);
  });

  it('backs up and resets an unknown future version', () => {
    const future = JSON.stringify({ ...defaults, version: 99 });
    const result = recoverConfigText(future, defaults);
    expect(result).toMatchObject({ recovered: true, reason: 'future-version', backupText: future });
    expect(result.config.version).toBe(1);
  });

  it('backs up and resets malformed json', () => {
    const result = recoverConfigText('{broken', defaults);
    expect(result).toMatchObject({
      recovered: true,
      reason: 'corrupt-json',
      backupText: '{broken',
    });
  });

  it('normalizes damaged positions recursively', () => {
    const damaged = structuredClone(defaults);
    damaged.root[1].position = 0;
    const result = recoverConfigText(JSON.stringify(damaged), defaults);
    expect(result.recovered).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.config.root.map(({ position }) => position)).toEqual([0, 1, 2]);
  });
});
