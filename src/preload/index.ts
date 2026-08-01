import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('api', Object.freeze({}));
