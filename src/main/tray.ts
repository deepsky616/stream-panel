import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { getPanelWindow, togglePanel } from './windows/panelWindow';
import { openEditorWindow } from './windows/editorWindow';
import { PLATFORM } from './platform';
import { resolveTrayAssetPaths } from './trayAsset';

type QuitAwareApp = typeof app & { isQuitting?: boolean };

let tray: Tray | null = null;
let updateVersion: string | null = null;

function fallbackTrayImage() {
  return nativeImage.createFromDataURL(
    'data:image/png;base64,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',
  );
}

function loadTrayImage() {
  const assetPaths = resolveTrayAssetPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    assetName: PLATFORM.trayAsset,
  });
  for (const assetPath of assetPaths) {
    const image = nativeImage.createFromPath(assetPath);
    if (!image.isEmpty()) return image;
  }
  return fallbackTrayImage();
}

export function createTray(): Tray {
  if (tray) return tray;
  const trayImage = loadTrayImage();
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

export function destroyTray(): void {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

export function setTrayUpdateVersion(version: string): void {
  updateVersion = version;
  tray?.setToolTip(`Stream Panel v${app.getVersion()} · 다시 시작하면 v${version} 적용`);
}

export function getTrayUpdateVersion(): string | null {
  return updateVersion;
}
