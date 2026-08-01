import type { ConfigStore } from '../store';
import { registerConfigHandlers } from './configHandlers';
import { registerWindowHandlers } from './windowHandlers';

export function registerIpcHandlers(configStore: ConfigStore): void {
  registerConfigHandlers(configStore);
  registerWindowHandlers(configStore);
}
