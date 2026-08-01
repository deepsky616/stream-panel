import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ConfigStore } from '../store';
import { getPageCount } from '../../shared/layout';
import type { AppConfig } from '../../shared/types';
import { PLATFORM, shouldStartHidden } from '../platform';

export const TITLEBAR_H = 34;
export const FOOTER_H = 26;

let panelWindow: BrowserWindow | null = null;
let moveTimer: ReturnType<typeof setTimeout> | undefined;
let panelAlwaysOnTop = true;

type QuitAwareApp = typeof app & { isQuitting?: boolean };

export function getPanelWindow(): BrowserWindow | null {
  return panelWindow;
}

export function calculatePanelSize(
  config: AppConfig,
  showFooter = getPageCount(config.root, config.grid, false) > 1,
): { width: number; height: number } {
  const { cols, rows, buttonSize, gap } = config.grid;
  return {
    width: cols * buttonSize + (cols + 1) * gap,
    height: TITLEBAR_H + rows * buttonSize + (rows + 1) * gap + (showFooter ? FOOTER_H : 0),
  };
}

function isPointOnScreen(x: number, y: number): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    return (
      x >= workArea.x &&
      y >= workArea.y &&
      x < workArea.x + workArea.width &&
      y < workArea.y + workArea.height
    );
  });
}

function fallbackPosition(width: number): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
  };
}

export function applyPanelLayout(config: AppConfig, forceFooter?: boolean): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  const size = calculatePanelSize(config, forceFooter);
  panelWindow.setContentSize(size.width, size.height);
  const saved = config.window;
  const position =
    saved.x !== null && saved.y !== null && isPointOnScreen(saved.x, saved.y)
      ? { x: saved.x, y: saved.y }
      : fallbackPosition(size.width);
  panelWindow.setPosition(position.x, position.y, false);
  panelAlwaysOnTop = config.window.alwaysOnTop;
  panelWindow.setAlwaysOnTop(panelAlwaysOnTop, PLATFORM.alwaysOnTopLevel);
  panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWindow.setOpacity(config.window.opacity);
}

export function createPanelWindow(configStore: ConfigStore): BrowserWindow {
  const config = configStore.get();
  const size = calculatePanelSize(config);
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  panelWindow = window;
  applyPanelLayout(config);

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  window.once('ready-to-show', () => {
    const hiddenByLogin = shouldStartHidden(process.platform, {
      argv: process.argv,
      getWasOpenedAsHidden: () => app.getLoginItemSettings().wasOpenedAsHidden,
    });
    if (!config.window.hideOnLaunch && !hiddenByLogin) window.show();
  });
  window.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!window.isDestroyed()) {
        const [x, y] = window.getPosition();
        const current = configStore.get();
        configStore.patch({ window: { ...current.window, x, y } });
      }
    }, 500);
  });
  window.on('close', (event) => {
    if (!(app as QuitAwareApp).isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => {
    panelWindow = null;
  });
  return window;
}

export function showPanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  if (PLATFORM.focusAppBeforeShow) app.focus({ steal: true });
  panelWindow.setAlwaysOnTop(panelAlwaysOnTop, PLATFORM.alwaysOnTopLevel);
  panelWindow.show();
  panelWindow.moveTop();
  panelWindow.focus();
  panelWindow.webContents.send(IPC_CHANNELS.PANEL_VISIBILITY, true);
}

export function hidePanel(): void {
  panelWindow?.hide();
  panelWindow?.webContents.send(IPC_CHANNELS.PANEL_VISIBILITY, false);
}

export function togglePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  if (panelWindow.isVisible()) hidePanel();
  else showPanel();
}
