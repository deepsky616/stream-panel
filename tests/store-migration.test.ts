import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../src/shared/defaults';
import { mergeConfigPatch, recoverConfigText } from '../src/main/store';

const defaults = createDefaultConfig(
  { downloads: '/Users/test/Downloads', documents: '/Users/test/Documents' },
  (() => {
    let index = 0;
    return () => `id-${index++}`;
  })(),
  'darwin',
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
    expect(result.config.version).toBe(4);
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

  it('fills fields added to a legacy version-one config without deleting its items', () => {
    const legacy = structuredClone(defaults) as unknown as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.platform;
    delete legacy.behavior;
    delete legacy.keyboard;
    delete legacy.educationOfficeCode;
    delete legacy.webConnection;
    legacy.hotkey = 'Control+Alt+D';

    const result = recoverConfigText(JSON.stringify(legacy), defaults);

    expect(result.config.root).toHaveLength(3);
    expect(result.config.version).toBe(4);
    expect(result.config.platform).toBe('darwin');
    expect(result.config.behavior).toMatchObject({ hideAfterLaunch: true, edgePeek: true });
    expect(result.config.keyboard).toMatchObject({
      hintKeys: expect.any(String),
      globalNumberHotkeys: true,
      globalNumberModifier: 'Control+Alt',
      quickLauncher: true,
      quickLauncherHotkey: 'CommandOrControl+Alt+Space',
    });
    expect(result.config.keyboard.hintKeys).toHaveLength(40);
    expect(result.config.hotkey).toBe('CommandOrControl+Alt+D');
    expect(result.config.educationOfficeCode).toBe('goe');
    expect(result.config.webConnection).toEqual({
      autoConnectAfterPortalLogin: true,
      autoConnectTarget: 'both',
      sessionKeepAlive: { neis: true, edufine: true },
    });
    expect(result.config.approvalMonitor).toMatchObject({
      sources: {
        neis: { enabled: true, browserId: 'edge' },
        edufine: { enabled: true, browserId: 'edge' },
      },
    });
  });

  it('repairs a stale version-two NEIS leave office while upgrading the config', () => {
    const legacy = structuredClone(defaults);
    legacy.version = 2;
    legacy.educationOfficeCode = 'sen';
    legacy.root = [{
      id: 'leave',
      kind: 'action',
      type: 'url',
      label: '나이스 복무',
      target: 'https://goe.neis.go.kr/',
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'goe' },
    }];

    const result = recoverConfigText(JSON.stringify(legacy), defaults);

    expect(result.config.version).toBe(4);
    expect(result.config.root[0]).toMatchObject({
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', officeCode: 'sen' },
    });
  });

  it('preserves a current-version choice to disable an approval source', () => {
    const current = structuredClone(defaults);
    current.approvalMonitor.sources.neis.enabled = false;
    const result = recoverConfigText(JSON.stringify(current), defaults);
    expect(result.config.approvalMonitor.sources.neis.enabled).toBe(false);
    expect(result.config.approvalMonitor.sources.edufine.enabled).toBe(true);
  });

  it('adds the purchase history generator directly after an existing Edufine purchase key', () => {
    const current = structuredClone(defaults);
    current.version = 3;
    current.platform = 'win32';
    current.root = [
      {
        id: 'draft',
        kind: 'action',
        type: 'url',
        label: '에듀파인 기안',
        target: 'https://klef.goe.go.kr/',
        args: [],
        icon: { kind: 'emoji', value: '✍️' },
        color: '#5B8CFF',
        position: 0,
        webWorkflow: { id: 'edufine-draft', browserId: 'edge', officeCode: 'goe' },
      },
      {
        id: 'purchase',
        kind: 'action',
        type: 'url',
        label: '에듀파인 품의',
        target: 'https://klef.goe.go.kr/',
        args: [],
        icon: { kind: 'emoji', value: '🧾' },
        color: '#5B8CFF',
        position: 1,
        webWorkflow: { id: 'edufine-purchase', browserId: 'edge', officeCode: 'goe' },
      },
      {
        id: 'next',
        kind: 'action',
        type: 'url',
        label: '다음 키',
        target: 'https://example.com/',
        args: [],
        icon: { kind: 'auto' },
        color: '#5B8CFF',
        position: 2,
      },
    ];

    const result = recoverConfigText(JSON.stringify(current), defaults);

    expect(result.config.root.map(({ label, position }) => ({ label, position }))).toEqual([
      { label: '에듀파인 기안', position: 0 },
      { label: '에듀파인 품의', position: 1 },
      { label: '에듀파인 품의내역 생성기', position: 2 },
      { label: '다음 키', position: 3 },
    ]);
    expect(result.config.root[2]).toMatchObject({
      type: 'url',
      target: 'https://deepsky616.github.io/school-quote-review/',
      icon: { kind: 'emoji', value: '📊' },
    });
  });

  it('does not duplicate an existing purchase history generator link', () => {
    const current = structuredClone(defaults);
    current.version = 3;
    current.platform = 'win32';
    current.root.push({
      id: 'generator',
      kind: 'action',
      type: 'url',
      label: '에듀파인 품의내역 생성기',
      target: 'https://deepsky616.github.io/school-quote-review/',
      args: [],
      icon: { kind: 'emoji', value: '📊' },
      color: '#5B8CFF',
      position: 3,
    });

    const result = recoverConfigText(JSON.stringify(current), defaults);

    expect(result.config.root.filter((item) => (
      item.kind === 'action'
      && item.target === 'https://deepsky616.github.io/school-quote-review/'
    ))).toHaveLength(1);
  });

  it('preserves an allowed office and replaces an invalid office with Gyeonggi', () => {
    const seoul = recoverConfigText(
      JSON.stringify({ ...defaults, educationOfficeCode: 'sen' }),
      defaults,
    );
    const invalid = recoverConfigText(
      JSON.stringify({ ...defaults, educationOfficeCode: 'wrong' }),
      defaults,
    );

    expect(seoul.config.educationOfficeCode).toBe('sen');
    expect(invalid.config.educationOfficeCode).toBe('goe');
  });

  it('preserves a config that was created on the other supported platform', () => {
    const foreign = { ...defaults, platform: 'win32' as const };
    const result = recoverConfigText(JSON.stringify(foreign), defaults);

    expect(result.config.platform).toBe('win32');
    expect(result.config.root).toEqual(foreign.root);
  });
});

describe('platform defaults', () => {
  it('uses portable accelerators and disables automatic updates on macOS', () => {
    const config = createDefaultConfig(
      { downloads: '/Users/test/Downloads', documents: '/Users/test/Documents' },
      () => 'fixed-id',
      'darwin',
    );

    expect(config.platform).toBe('darwin');
    expect(config.hotkey).toBe('CommandOrControl+Alt+D');
    expect(config.keyboard).toMatchObject({
      globalNumberHotkeys: true,
      globalNumberModifier: 'Control+Alt',
      quickLauncher: true,
      quickLauncherHotkey: 'CommandOrControl+Alt+Space',
    });
    expect(config.behavior).toMatchObject({
      hideAfterLaunch: true,
      edgePeek: true,
      peekEdge: 'auto',
      idleFade: false,
    });
    expect(config.autoUpdate).toBe(false);
    expect(config.educationOfficeCode).toBe('goe');
  });

  it('enables automatic updates on Windows', () => {
    const config = createDefaultConfig(
      { downloads: 'C:/Users/test/Downloads', documents: 'C:/Users/test/Documents' },
      () => 'fixed-id',
      'win32',
    );

    expect(config.platform).toBe('win32');
    expect(config.keyboard).toMatchObject({
      globalNumberHotkeys: true,
      globalNumberModifier: 'Alt+Shift',
      quickLauncher: true,
      quickLauncherHotkey: 'CommandOrControl+Alt+Space',
    });
    expect(config.autoUpdate).toBe(true);
    expect(config.educationOfficeCode).toBe('goe');
    expect(config.root.at(-1)).toMatchObject({
      label: '에듀파인 품의내역 생성기',
      type: 'url',
      target: 'https://deepsky616.github.io/school-quote-review/',
      position: 3,
    });
  });

  it('retargets every stored web workflow when the central education office changes', () => {
    const config = createDefaultConfig(
      { downloads: 'C:/Users/test/Downloads', documents: 'C:/Users/test/Documents' },
      () => 'fixed-id',
      'win32',
    );
    config.root = [{
      id: 'leave',
      kind: 'action',
      type: 'url',
      label: '나이스 복무',
      target: 'https://goe.neis.go.kr/',
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'goe' },
    }];

    const updated = mergeConfigPatch(config, { educationOfficeCode: 'sen' });

    expect(updated.educationOfficeCode).toBe('sen');
    expect(updated.root[0]).toMatchObject({
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', officeCode: 'sen' },
    });
  });

  it('repairs a stale key when the same central education office is selected again', () => {
    const config = createDefaultConfig(
      { downloads: 'C:/Users/test/Downloads', documents: 'C:/Users/test/Documents' },
      () => 'fixed-id',
      'win32',
    );
    config.educationOfficeCode = 'sen';
    config.root = [{
      id: 'stale-leave',
      kind: 'action',
      type: 'url',
      label: '나이스 복무',
      target: 'https://goe.neis.go.kr/',
      args: [],
      icon: { kind: 'auto' },
      color: '#5B8CFF',
      position: 0,
      webWorkflow: { id: 'neis-leave', browserId: 'edge', officeCode: 'goe' },
    }];

    const updated = mergeConfigPatch(config, { educationOfficeCode: 'sen' });

    expect(updated.root[0]).toMatchObject({
      target: 'https://sen.neis.go.kr/',
      webWorkflow: { id: 'neis-leave', officeCode: 'sen' },
    });
  });
});
