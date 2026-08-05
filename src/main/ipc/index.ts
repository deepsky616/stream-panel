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
import { registerWebConnectorHandlers } from './webConnectorHandlers';
import type { WebConnectorService } from '../services/webConnector';
import { registerMultiActionHandlers } from './multiActionHandlers';
import { registerApprovalMonitorHandlers } from './approvalMonitorHandlers';
import type { ApprovalMonitorService } from '../services/approvalMonitor';

export function registerIpcHandlers(
  configStore: ConfigStore,
  webConnectorService: WebConnectorService | null,
  approvalMonitorService: ApprovalMonitorService | null = null,
): void {
  registerConfigHandlers(configStore);
  registerDeckHandlers(configStore);
  registerLaunchHandlers(configStore);
  registerMultiActionHandlers();
  registerPickerHandlers();
  registerDropHandlers();
  registerAppHandlers();
  registerBrowserHandlers();
  if (webConnectorService) registerWebConnectorHandlers(webConnectorService);
  if (approvalMonitorService) registerApprovalMonitorHandlers(approvalMonitorService);
  registerIconHandlers();
  registerWindowHandlers(configStore);
  registerLauncherHandlers(configStore);
}
