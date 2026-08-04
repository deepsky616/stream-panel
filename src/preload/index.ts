import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC_CHANNELS, RENDERER_EVENTS, type RendererEvent } from '../shared/ipcChannels';
import type { ActionType, AppConfig, DeckItem } from '../shared/types';

const api = {
  config: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_GET),
    set: (patch: Partial<AppConfig>) => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SET, patch),
    reset: () => ipcRenderer.invoke(IPC_CHANNELS.CONFIG_RESET),
  },
  deck: {
    upsert: (input: { path: string[]; item: DeckItem }) =>
      ipcRenderer.invoke(IPC_CHANNELS.DECK_UPSERT, input),
    remove: (input: { path: string[]; id: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.DECK_REMOVE, input),
    move: (input: {
      from: { path: string[]; id: string };
      to: { path: string[]; position: number };
    }) => ipcRenderer.invoke(IPC_CHANNELS.DECK_MOVE, input),
    duplicate: (input: { path: string[]; id: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.DECK_DUPLICATE, input),
  },
  button: {
    launch: (input: { path: string[]; id: string; keepOpen?: boolean }) =>
      ipcRenderer.invoke(IPC_CHANNELS.BUTTON_LAUNCH, input),
  },
  multiAction: {
    cancel: (input: { itemId: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.MULTI_ACTION_CANCEL, input),
  },
  picker: {
    folder: () => ipcRenderer.invoke(IPC_CHANNELS.PICKER_FOLDER),
    file: () => ipcRenderer.invoke(IPC_CHANNELS.PICKER_FILE),
    executable: () => ipcRenderer.invoke(IPC_CHANNELS.PICKER_EXECUTABLE),
    image: () => ipcRenderer.invoke(IPC_CHANNELS.PICKER_IMAGE),
  },
  icon: {
    resolve: (input: { type: ActionType; target: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.ICON_RESOLVE, input),
    importPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.ICON_IMPORT_PATH, path),
  },
  apps: {
    list: (input: { refresh?: boolean } = {}) => ipcRenderer.invoke(IPC_CHANNELS.APPS_LIST, input),
  },
  browsers: {
    list: (input: { refresh?: boolean } = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.BROWSERS_LIST, input),
  },
  webConnector: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.WEB_CONNECTOR_STATUS, {}),
    test: (input: { browserId: 'chrome' | 'edge' }) =>
      ipcRenderer.invoke(IPC_CHANNELS.WEB_CONNECTOR_TEST, input),
    openSetup: (input: {
      browserId: 'chrome' | 'edge';
      target: 'pair' | 'folder' | 'extensions';
    }) => ipcRenderer.invoke(IPC_CHANNELS.WEB_CONNECTOR_OPEN_SETUP, input),
  },
  drop: {
    classify: (input: { paths: string[]; text?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.DROP_CLASSIFY, input),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  window: {
    hide: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_HIDE),
    show: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SHOW),
    relayout: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_RELAYOUT),
    setIdle: (idle: boolean) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_IDLE, idle),
  },
  editor: {
    open: (input: { path?: string[]; slot?: number } = {}) =>
      ipcRenderer.invoke(IPC_CHANNELS.EDITOR_OPEN, input),
  },
  hotkey: {
    validate: (input: { accelerator: string; itemId?: string }) =>
      ipcRenderer.invoke(IPC_CHANNELS.HOTKEY_VALIDATE, input),
  },
  launcher: {
    query: (input: { text: string }) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_QUERY, input),
    run: (input: { id: string }) => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_RUN, input),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_CLOSE),
    resize: (input: { height: number }) =>
      ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_RESIZE, input),
  },
  update: {
    check: () => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CHECK),
  },
  app: {
    info: () => ipcRenderer.invoke(IPC_CHANNELS.APP_INFO),
  },
  shell: {
    reveal: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_REVEAL, path),
  },
  on: (channel: RendererEvent, callback: (payload: unknown) => void) => {
    if (!RENDERER_EVENTS.has(channel)) throw new TypeError('허용되지 않은 이벤트 채널입니다.');
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('api', Object.freeze(api));
