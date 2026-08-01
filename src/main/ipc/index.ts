import type { ConfigStore } from '../store';
import { registerConfigHandlers } from './configHandlers';
import { registerLaunchHandlers } from './launchHandlers';
import { registerDeckHandlers } from './deckHandlers';
import { registerPickerHandlers } from './pickerHandlers';
import { registerWindowHandlers } from './windowHandlers';

export function registerIpcHandlers(configStore: ConfigStore): void {
  registerConfigHandlers(configStore);
  registerDeckHandlers(configStore);
  registerLaunchHandlers(configStore);
  registerPickerHandlers();
  registerWindowHandlers(configStore);
}
