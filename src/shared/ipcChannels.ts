export const IPC_CHANNELS = {
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_RESET: 'config:reset',
  DECK_UPSERT: 'deck:upsert',
  DECK_REMOVE: 'deck:remove',
  DECK_MOVE: 'deck:move',
  DECK_DUPLICATE: 'deck:duplicate',
  BUTTON_LAUNCH: 'button:launch',
  PICKER_FOLDER: 'picker:folder',
  PICKER_FILE: 'picker:file',
  PICKER_EXECUTABLE: 'picker:executable',
  PICKER_IMAGE: 'picker:image',
  ICON_IMPORT_PATH: 'icon:importPath',
  APPS_LIST: 'apps:list',
  BROWSERS_LIST: 'browsers:list',
  ICON_RESOLVE: 'icon:resolve',
  DROP_CLASSIFY: 'drop:classify',
  WINDOW_HIDE: 'window:hide',
  WINDOW_SHOW: 'window:show',
  WINDOW_RELAYOUT: 'window:relayout',
  WINDOW_SET_IDLE: 'window:set-idle',
  EDITOR_OPEN: 'editor:open',
  HOTKEY_VALIDATE: 'hotkey:validate',
  UPDATE_CHECK: 'update:check',
  APP_INFO: 'app:info',
  SHELL_REVEAL: 'shell:reveal',
  CONFIG_CHANGED: 'config:changed',
  UPDATE_STATUS: 'update:status',
  PANEL_VISIBILITY: 'panel:visibility',
  EDITOR_FOCUS_SLOT: 'editor:focus-slot',
  TOAST: 'toast',
} as const;

export type RendererEvent =
  | 'config:changed'
  | 'update:status'
  | 'panel:visibility'
  | 'editor:focus-slot'
  | 'toast';

export const RENDERER_EVENTS = new Set<RendererEvent>([
  IPC_CHANNELS.CONFIG_CHANGED,
  IPC_CHANNELS.UPDATE_STATUS,
  IPC_CHANNELS.PANEL_VISIBILITY,
  IPC_CHANNELS.EDITOR_FOCUS_SLOT,
  IPC_CHANNELS.TOAST,
]);
