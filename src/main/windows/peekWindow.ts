import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { AppConfig } from '../../shared/types';
import { PLATFORM } from '../platform';
import { getPeekBounds, inferPeekEdge, type PeekEdge, type Rectangle } from '../services/visibility';

let peekWindow: BrowserWindow | null = null;
let shouldBeVisible = false;
let activeEdge: PeekEdge = 'right';

export function getPeekWindow(): BrowserWindow | null {
  return peekWindow;
}

export function getActivePeekEdge(): PeekEdge {
  return activeEdge;
}

function createPeekWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 6,
    height: 160,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
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
  peekWindow = window;
  window.setAlwaysOnTop(true, PLATFORM.alwaysOnTopLevel);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/peek.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/peek.html'));
  }
  window.once('ready-to-show', () => {
    if (shouldBeVisible && !window.isDestroyed()) window.showInactive();
  });
  window.on('closed', () => {
    peekWindow = null;
  });
  return window;
}

export function showPeekWindow(config: AppConfig, panelBounds: Rectangle): void {
  if (!config.behavior.edgePeek) {
    hidePeekWindow();
    return;
  }
  const point = {
    x: Math.round(panelBounds.x + panelBounds.width / 2),
    y: Math.round(panelBounds.y + panelBounds.height / 2),
  };
  const workArea = screen.getDisplayNearestPoint(point).workArea;
  activeEdge =
    config.behavior.peekEdge === 'auto'
      ? inferPeekEdge(panelBounds, workArea)
      : config.behavior.peekEdge;
  const bounds = getPeekBounds(
    panelBounds,
    workArea,
    activeEdge,
    config.behavior.peekThickness,
  );
  shouldBeVisible = true;
  const window = peekWindow && !peekWindow.isDestroyed() ? peekWindow : createPeekWindow();
  window.setBounds(bounds, false);
  window.setAlwaysOnTop(true, PLATFORM.alwaysOnTopLevel);
  if (!window.webContents.isLoading()) window.showInactive();
}

export function hidePeekWindow(): void {
  shouldBeVisible = false;
  if (peekWindow && !peekWindow.isDestroyed()) peekWindow.hide();
}

export function destroyPeekWindow(): void {
  shouldBeVisible = false;
  if (peekWindow && !peekWindow.isDestroyed()) peekWindow.destroy();
  peekWindow = null;
}
