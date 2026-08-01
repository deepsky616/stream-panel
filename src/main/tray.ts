import { join } from 'node:path';
import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { getPanelWindow, togglePanel } from './windows/panelWindow';
import { openEditorWindow } from './windows/editorWindow';
import { PLATFORM } from './platform';

type QuitAwareApp = typeof app & { isQuitting?: boolean };

let tray: Tray | null = null;
let updateVersion: string | null = null;

function fallbackTrayImage() {
  return nativeImage.createFromDataURL(
    'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22%3E%3Crect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%235b8cff%22/%3E%3Cpath d=%22M4 4h3v3H4zm5 0h3v3H9zM4 9h3v3H4zm5 0h3v3H9z%22 fill=%22white%22/%3E%3C/svg%3E',
  );
}

export function createTray(): Tray {
  if (tray) return tray;
  const assetPath = app.isPackaged
    ? join(process.resourcesPath, 'resources', PLATFORM.trayAsset)
    : join(app.getAppPath(), 'resources', PLATFORM.trayAsset);
  const asset = nativeImage.createFromPath(assetPath);
  const trayImage = asset.isEmpty() ? fallbackTrayImage() : asset;
  if (process.platform === 'darwin') trayImage.setTemplateImage(true);
  tray = new Tray(trayImage);
  tray.setToolTip(`Stream Panel v${app.getVersion()}`);

  const showMenu = () => {
    if (!tray) return;
    const visible = getPanelWindow()?.isVisible() ?? false;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: visible ? '패널 숨기기' : '패널 표시', click: () => togglePanel() },
        { label: '편집기 열기', click: () => openEditorWindow() },
        { label: '설정...', click: () => openEditorWindow({ settings: true }) },
        {
          label: process.platform === 'darwin' ? '릴리즈 페이지 열기' : '업데이트 확인',
          click: () => {
            if (process.platform === 'darwin') {
              void shell.openExternal('https://github.com/deepsky616/stream-panel/releases');
            } else {
              openEditorWindow({ settings: true });
            }
          },
        },
        { type: 'separator' },
        {
          label: '종료',
          click: () => {
            (app as QuitAwareApp).isQuitting = true;
            app.quit();
          },
        },
      ]),
    );
  };
  showMenu();
  tray.on('click', () => {
    togglePanel();
    showMenu();
  });
  tray.on('right-click', showMenu);
  return tray;
}

export function setTrayUpdateVersion(version: string): void {
  updateVersion = version;
  tray?.setToolTip(`Stream Panel v${app.getVersion()} · 다시 시작하면 v${version} 적용`);
}

export function getTrayUpdateVersion(): string | null {
  return updateVersion;
}
