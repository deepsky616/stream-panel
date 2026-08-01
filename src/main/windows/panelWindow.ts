import { join } from 'node:path';
import { app, BrowserWindow, screen } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import type { ConfigStore } from '../store';
import { getPageCount } from '../../shared/layout';
import type { AppConfig } from '../../shared/types';
import { PLATFORM, shouldStartHidden } from '../platform';
import {
  getActivePeekEdge,
  hidePeekWindow,
  showPeekWindow,
} from './peekWindow';

export const TITLEBAR_H = 34;
export const FOOTER_H = 26;

let panelWindow: BrowserWindow | null = null;
let moveTimer: ReturnType<typeof setTimeout> | undefined;
let slideTimer: ReturnType<typeof setTimeout> | undefined;
let panelAlwaysOnTop = true;
let panelReady = false;
let panelIdle = false;
let panelConfigStore: ConfigStore | null = null;

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
  if (!panelIdle) panelWindow.setOpacity(config.window.opacity);
  if (panelReady && !panelWindow.isVisible()) showPeekWindow(config, panelWindow.getBounds());
}

export function createPanelWindow(configStore: ConfigStore): BrowserWindow {
  panelConfigStore = configStore;
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
    panelReady = true;
    const hiddenByLogin = shouldStartHidden(process.platform, {
      argv: process.argv,
      getWasOpenedAsHidden: () => app.getLoginItemSettings().wasOpenedAsHidden,
    });
    if (!config.window.hideOnLaunch && !hiddenByLogin) showPanel();
    else showPeekWindow(configStore.get(), window.getBounds());
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
      hidePanel();
    }
  });
  window.on('closed', () => {
    panelWindow = null;
    panelConfigStore = null;
    panelReady = false;
  });
  return window;
}

function animatePanelFromEdge(window: BrowserWindow): void {
  clearTimeout(slideTimer);
  const finalBounds = window.getBounds();
  const { workArea } = screen.getDisplayNearestPoint({
    x: finalBounds.x + Math.round(finalBounds.width / 2),
    y: finalBounds.y + Math.round(finalBounds.height / 2),
  });
  const start = { ...finalBounds };
  switch (getActivePeekEdge()) {
    case 'left':
      start.x = workArea.x - finalBounds.width;
      break;
    case 'top':
      start.y = workArea.y - finalBounds.height;
      break;
    case 'bottom':
      start.y = workArea.y + workArea.height;
      break;
    default:
      start.x = workArea.x + workArea.width;
      break;
  }
  window.setBounds(start, false);
  const startedAt = Date.now();
  const duration = 120;
  const step = (): void => {
    if (window.isDestroyed()) return;
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    window.setBounds(
      {
        x: Math.round(start.x + (finalBounds.x - start.x) * eased),
        y: Math.round(start.y + (finalBounds.y - start.y) * eased),
        width: finalBounds.width,
        height: finalBounds.height,
      },
      false,
    );
    if (progress < 1) slideTimer = setTimeout(step, 16);
  };
  step();
}

export function showPanel(fromPeek = false): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  hidePeekWindow();
  setPanelIdle(false);
  if (PLATFORM.focusAppBeforeShow) app.focus({ steal: true });
  panelWindow.setAlwaysOnTop(panelAlwaysOnTop, PLATFORM.alwaysOnTopLevel);
  if (fromPeek) animatePanelFromEdge(panelWindow);
  panelWindow.show();
  panelWindow.moveTop();
  panelWindow.focus();
  panelWindow.webContents.send(IPC_CHANNELS.PANEL_VISIBILITY, true);
}

export function hidePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  clearTimeout(slideTimer);
  setPanelIdle(false);
  const bounds = panelWindow.getBounds();
  panelWindow.hide();
  panelWindow.webContents.send(IPC_CHANNELS.PANEL_VISIBILITY, false);
  if (!(app as QuitAwareApp).isQuitting && panelConfigStore) {
    showPeekWindow(panelConfigStore.get(), bounds);
  }
}

export function setPanelIdle(idle: boolean): void {
  if (!panelWindow || panelWindow.isDestroyed() || !panelConfigStore) return;
  const config = panelConfigStore.get();
  panelIdle = idle && config.behavior.idleFade && panelWindow.isVisible();
  panelWindow.setOpacity(panelIdle ? config.behavior.idleOpacity : config.window.opacity);
  panelWindow.setIgnoreMouseEvents(panelIdle, panelIdle ? { forward: true } : undefined);
}

export function togglePanel(): void {
  if (!panelWindow || panelWindow.isDestroyed()) return;
  if (panelWindow.isVisible()) hidePanel();
  else showPanel();
}
