import type { ConfigStore } from '../store';
import { registerConfigHandlers } from './configHandlers';
import { registerLaunchHandlers } from './launchHandlers';
import { registerWindowHandlers } from './windowHandlers';

export function registerIpcHandlers(configStore: ConfigStore): void {
  registerConfigHandlers(configStore);
  registerLaunchHandlers(configStore);
  registerWindowHandlers(configStore);
}
