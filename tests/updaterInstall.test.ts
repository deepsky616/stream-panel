import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  const send = vi.fn();
  const setTrayUpdateVersion = vi.fn();
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    autoRunAppAfterInstall: false,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    removeAllListeners: vi.fn(() => listeners.clear()),
  };
  const app = {
    isPackaged: true,
    getVersion: vi.fn(() => '1.5.50'),
    getPath: vi.fn(() => 'C:\\StreamPanelTest'),
    once: vi.fn(),
  };
  return {
    app,
    autoUpdater,
    listeners,
    send,
    setTrayUpdateVersion,
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
});

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: mocks.send } }],
  },
}));

vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }));

vi.mock('../src/main/tray', () => ({
  setTrayUpdateVersion: mocks.setTrayUpdateVersion,
}));

import { createWindowsUpdater } from '../src/main/services/updater/windows';

function configStore() {
  return {
    get: () => ({ autoUpdate: false }),
    onDidChange: () => () => undefined,
  };
}

describe('Windows updater restart installation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners.clear();
    mocks.app.isPackaged = true;
    mocks.autoUpdater.autoDownload = false;
    mocks.autoUpdater.autoInstallOnAppQuit = false;
    mocks.autoUpdater.autoRunAppAfterInstall = false;
  });

  it('restarts through electron-updater only after a download is ready', async () => {
    const updater = createWindowsUpdater(configStore() as never);

    await expect(updater.restartAndInstall()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('아직 준비되지 않았습니다'),
    });
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    mocks.emit('update-downloaded', { version: 'v1.5.51' });
    expect(mocks.setTrayUpdateVersion).toHaveBeenCalledWith('1.5.51');
    expect(mocks.send).toHaveBeenCalledWith('update:status', expect.objectContaining({
      state: 'downloaded',
      version: '1.5.51',
    }));

    await expect(updater.restartAndInstall()).resolves.toEqual({
      ok: true,
      version: '1.5.51',
      message: 'v1.5.51 업데이트를 적용하기 위해 Stream Panel을 다시 시작합니다.',
    });
    expect(mocks.autoUpdater.autoDownload).toBe(true);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(mocks.autoUpdater.autoRunAppAfterInstall).toBe(true);
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(mocks.send).toHaveBeenCalledWith('update:status', expect.objectContaining({
      state: 'installing',
      version: '1.5.51',
    }));

    await updater.restartAndInstall();
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('returns the cached ready state when update check is pressed again', async () => {
    const updater = createWindowsUpdater(configStore() as never);
    mocks.emit('update-downloaded', { version: '1.5.51' });

    await expect(updater.check()).resolves.toEqual({
      status: 'v1.5.51 업데이트 준비가 완료되었습니다. 재시작하여 적용해 주세요.',
      version: '1.5.51',
      readyToInstall: true,
    });
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('shows the startup update guidance only once after a download is ready', () => {
    createWindowsUpdater(configStore() as never);

    mocks.emit('update-downloaded', { version: 'v1.5.51' });
    mocks.emit('update-downloaded', { version: '1.5.51' });

    const notices = mocks.send.mock.calls.filter(([channel]) => channel === 'toast');
    expect(notices).toEqual([[
      'toast',
      {
        level: 'info',
        message: "Stream Panel v1.5.51 업데이트 준비가 완료되었습니다. 설정 → 정보에서 '재시작하여 업데이트 적용'을 눌러 주세요.",
      },
    ]]);
  });
});
