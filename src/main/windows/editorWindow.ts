import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipcChannels';

let editorWindow: BrowserWindow | null = null;

export interface EditorOpenOptions {
  path?: string[];
  slot?: number;
}

export function getEditorWindow(): BrowserWindow | null {
  return editorWindow;
}

export function openEditorWindow(options: EditorOpenOptions = {}): BrowserWindow {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.show();
    editorWindow.focus();
    if (options.path || options.slot !== undefined) {
      editorWindow.webContents.send(IPC_CHANNELS.EDITOR_FOCUS_SLOT, options);
    }
    return editorWindow;
  }

  const window = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 840,
    minHeight: 560,
    frame: true,
    transparent: false,
    resizable: true,
    show: false,
    backgroundColor: '#16161a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  editorWindow = window;
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/editor.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/editor.html'));
  }
  window.once('ready-to-show', () => {
    window.show();
    if (options.path || options.slot !== undefined) {
      window.webContents.send(IPC_CHANNELS.EDITOR_FOCUS_SLOT, options);
    }
  });
  window.on('closed', () => {
    editorWindow = null;
  });
  return window;
}
