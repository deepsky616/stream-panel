import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { PLATFORM } from '../platform';
import { focusWithRetry } from '../services/windowFocus';

const LAUNCHER_WIDTH = 640;
const LAUNCHER_MIN_HEIGHT = 64;
const LAUNCHER_MAX_HEIGHT = 512;

let launcherWindow: BrowserWindow | null = null;

export function getLauncherWindow(): BrowserWindow | null {
  return launcherWindow;
}

export function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) return launcherWindow;
  const window = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_MIN_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  launcherWindow = window;
  window.setAlwaysOnTop(true, PLATFORM.alwaysOnTopLevel);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/launcher.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/launcher.html'));
  }

  window.on('blur', () => window.hide());
  window.on('closed', () => {
    launcherWindow = null;
  });
  return window;
}

function placeLauncher(window: BrowserWindow): void {
  const point = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(point);
  const [, currentHeight] = window.getContentSize();
  const x = Math.round(workArea.x + (workArea.width - LAUNCHER_WIDTH) / 2);
  const y = Math.round(workArea.y + workArea.height * 0.25);
  window.setBounds({ x, y, width: LAUNCHER_WIDTH, height: currentHeight }, false);
}

export async function showLauncherWindow(): Promise<boolean> {
  const window = launcherWindow;
  if (!window || window.isDestroyed()) return false;
  window.setContentSize(LAUNCHER_WIDTH, LAUNCHER_MIN_HEIGHT);
  placeLauncher(window);
  return focusWithRetry({
    attempt: () => {
      if (window.isDestroyed()) return false;
      if (PLATFORM.focusAppBeforeShow) app.focus({ steal: true });
      window.setAlwaysOnTop(true, PLATFORM.alwaysOnTopLevel);
      window.show();
      window.moveTop();
      window.webContents.focus();
      window.focus();
      return window.isFocused();
    },
    onFailure: () => undefined,
  });
}

export function hideLauncherWindow(): void {
  if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.hide();
}

export function resizeLauncherWindow(height: number): void {
  if (!launcherWindow || launcherWindow.isDestroyed()) return;
  launcherWindow.setContentSize(
    LAUNCHER_WIDTH,
    Math.max(LAUNCHER_MIN_HEIGHT, Math.min(LAUNCHER_MAX_HEIGHT, height)),
  );
}

export function setLauncherEnabled(enabled: boolean): void {
  if (enabled) {
    createLauncherWindow();
    return;
  }
  if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.destroy();
  launcherWindow = null;
}
