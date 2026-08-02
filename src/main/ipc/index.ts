import type { ConfigStore } from '../store';
import { registerConfigHandlers } from './configHandlers';
import { registerLaunchHandlers } from './launchHandlers';
import { registerDeckHandlers } from './deckHandlers';
import { registerPickerHandlers } from './pickerHandlers';
import { registerDropHandlers } from './dropHandlers';
import { registerAppHandlers } from './appHandlers';
import { registerIconHandlers } from './iconHandlers';
import { registerWindowHandlers } from './windowHandlers';
import { registerLauncherHandlers } from './launcherHandlers';
import { registerBrowserHandlers } from './browserHandlers';

export function registerIpcHandlers(configStore: ConfigStore): void {
  registerConfigHandlers(configStore);
  registerDeckHandlers(configStore);
  registerLaunchHandlers(configStore);
  registerPickerHandlers();
  registerDropHandlers();
  registerAppHandlers();
  registerBrowserHandlers();
  registerIconHandlers();
  registerWindowHandlers(configStore);
  registerLauncherHandlers(configStore);
}
