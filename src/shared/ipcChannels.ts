export const IPC_CHANNELS = {
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_RESET: 'config:reset',
  DECK_UPSERT: 'deck:upsert',
  DECK_REMOVE: 'deck:remove',
  DECK_MOVE: 'deck:move',
  DECK_DUPLICATE: 'deck:duplicate',
  BUTTON_LAUNCH: 'button:launch',
  MULTI_ACTION_CANCEL: 'multi-action:cancel',
  PICKER_FOLDER: 'picker:folder',
  PICKER_FILE: 'picker:file',
  PICKER_EXECUTABLE: 'picker:executable',
  PICKER_IMAGE: 'picker:image',
  ICON_IMPORT_PATH: 'icon:importPath',
  APPS_LIST: 'apps:list',
  BROWSERS_LIST: 'browsers:list',
  WEB_CONNECTOR_STATUS: 'web-connector:status',
  WEB_CONNECTOR_TEST: 'web-connector:test',
  WEB_CONNECTOR_OPEN_SETUP: 'web-connector:open-setup',
  WEB_CONNECTOR_OPEN_APPROVAL: 'web-connector:open-approval',
  WEB_APPROVAL_STATUS: 'web-approval:status',
  WEB_APPROVAL_CHECK: 'web-approval:check',
  ICON_RESOLVE: 'icon:resolve',
  DROP_CLASSIFY: 'drop:classify',
  WINDOW_HIDE: 'window:hide',
  WINDOW_SHOW: 'window:show',
  WINDOW_RELAYOUT: 'window:relayout',
  WINDOW_SET_IDLE: 'window:set-idle',
  EDITOR_OPEN: 'editor:open',
  HOTKEY_VALIDATE: 'hotkey:validate',
  LAUNCHER_QUERY: 'launcher:query',
  LAUNCHER_RUN: 'launcher:run',
  LAUNCHER_CLOSE: 'launcher:close',
  LAUNCHER_RESIZE: 'launcher:resize',
  UPDATE_CHECK: 'update:check',
  APP_INFO: 'app:info',
  SHELL_REVEAL: 'shell:reveal',
  CONFIG_CHANGED: 'config:changed',
  UPDATE_STATUS: 'update:status',
  PANEL_VISIBILITY: 'panel:visibility',
  EDITOR_FOCUS_SLOT: 'editor:focus-slot',
  TOAST: 'toast',
  MULTI_ACTION_PROGRESS: 'multi-action:progress',
  WEB_CONNECTOR_CHANGED: 'web-connector:changed',
  WEB_APPROVAL_CHANGED: 'web-approval:changed',
} as const;

export type RendererEvent =
  | 'config:changed'
  | 'update:status'
  | 'panel:visibility'
  | 'editor:focus-slot'
  | 'toast'
  | 'multi-action:progress'
  | 'web-connector:changed'
  | 'web-approval:changed';

export const RENDERER_EVENTS = new Set<RendererEvent>([
  IPC_CHANNELS.CONFIG_CHANGED,
  IPC_CHANNELS.UPDATE_STATUS,
  IPC_CHANNELS.PANEL_VISIBILITY,
  IPC_CHANNELS.EDITOR_FOCUS_SLOT,
  IPC_CHANNELS.TOAST,
  IPC_CHANNELS.MULTI_ACTION_PROGRESS,
  IPC_CHANNELS.WEB_CONNECTOR_CHANGED,
  IPC_CHANNELS.WEB_APPROVAL_CHANGED,
]);
