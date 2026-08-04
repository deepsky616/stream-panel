import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
  buildManagedBrowserLaunch,
  resolveManagedProfilePath,
  spawnManagedBrowser,
} from '../src/main/services/webConnector/browserProcess';
import { resolveWindowsManagedBrowserExecutable } from '../src/main/services/webConnector/windows';
import { isMacosManagedBrowserAutomationSupported } from '../src/main/services/webConnector/macos';

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;
  pid = 4242;
  stdio = [null, null, null, null, null] as ChildProcess['stdio'];
  kill = vi.fn(() => true);
}

describe('managed browser process', () => {
  it('builds a profile path below the injected user data directory', () => {
    expect(resolveManagedProfilePath('C:\\StreamPanel', 'sen', 'edge', 'win32')).toBe(
      'C:\\StreamPanel\\web-browsers\\sen\\edge',
    );
    expect(resolveManagedProfilePath('/Users/test/Library/App', 'goe', 'chrome', 'darwin')).toBe(
      '/Users/test/Library/App/web-browsers/goe/chrome',
    );
    expect(() => resolveManagedProfilePath('relative', 'sen', 'edge', 'win32')).toThrow(/절대 경로/);
  });

  it('resolves only known Edge and Chrome installation locations', () => {
    const env = {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    };
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const chrome = 'C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

    expect(resolveWindowsManagedBrowserExecutable('edge', { env, exists: (path) => path === edge }))
      .toBe(edge);
    expect(resolveWindowsManagedBrowserExecutable('chrome', { env, exists: (path) => path === chrome }))
      .toBe(chrome);
    expect(resolveWindowsManagedBrowserExecutable('edge', { env, exists: () => false })).toBeNull();
  });

  it('uses fixed safe arguments with pipe first and random-port fallback', () => {
    const profile = 'C:\\StreamPanel\\web-browsers\\sen\\edge';
    const executable = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const pipe = buildManagedBrowserLaunch({
      browserId: 'edge',
      executable,
      profilePath: profile,
      transport: 'pipe',
    });
    const port = buildManagedBrowserLaunch({
      browserId: 'edge',
      executable,
      profilePath: profile,
      transport: 'port',
    });

    expect(pipe).toEqual({
      executable,
      args: [`--user-data-dir=${profile}`, '--new-window', '--remote-debugging-pipe'],
      options: {
        detached: false,
        stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
        windowsHide: false,
      },
      transport: 'pipe',
    });
    expect(port.args).toEqual([
      `--user-data-dir=${profile}`,
      '--new-window',
      '--remote-debugging-port=0',
    ]);
    expect(port.options).toMatchObject({ detached: false, stdio: 'ignore', windowsHide: false });
    const unsafeFixedPort = `--remote-debugging-port=${9_222}`;
    expect([...pipe.args, ...port.args]).not.toContain(unsafeFixedPort);
    expect([...pipe.args, ...port.args].join(' ')).not.toMatch(/profile-directory|--remote-allow-origins/);
    expect(pipe.options.shell).not.toBe(true);
    expect(port.options.shell).not.toBe(true);
  });

  it('rejects a browser executable whose filename does not match the selected browser', () => {
    expect(() => buildManagedBrowserLaunch({
      browserId: 'edge',
      executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      profilePath: 'C:\\StreamPanel\\web-browsers\\sen\\edge',
      transport: 'pipe',
    })).toThrow(/브라우저/);
  });

  it('closes only the child returned by its injected spawn boundary', async () => {
    const child = new FakeChildProcess();
    let captured: { command: string; args: readonly string[]; options: SpawnOptions } | undefined;
    const launch = buildManagedBrowserLaunch({
      browserId: 'chrome',
      executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      profilePath: 'C:\\StreamPanel\\web-browsers\\goe\\chrome',
      transport: 'port',
    });
    const owned = spawnManagedBrowser(launch, {
      spawnProcess(command, args, options) {
        captured = { command, args, options };
        return child as unknown as ChildProcess;
      },
      waitForExit: async () => false,
    });

    expect(captured).toEqual({
      command: launch.executable,
      args: launch.args,
      options: launch.options,
    });
    expect(owned.pid).toBe(4242);
    await owned.close();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledWith();
  });

  it('keeps managed browser automation disabled on macOS', () => {
    expect(isMacosManagedBrowserAutomationSupported()).toBe(false);
  });
});
