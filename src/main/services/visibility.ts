import type { AppConfig, LaunchResult } from '../../shared/types';

export interface AutoHideContext {
  keepOpen: boolean | undefined;
  editorOpen: boolean;
}

export interface VisibilityDependencies {
  hidePanel: () => void;
  setTimer: (handler: () => void, delay: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

export interface VisibilityService {
  afterLaunch(config: AppConfig, result: LaunchResult, context: AutoHideContext): void;
  cancelPendingHide(): void;
}

export function shouldAutoHideAfterLaunch(
  config: AppConfig,
  result: LaunchResult,
  { keepOpen, editorOpen }: AutoHideContext,
): boolean {
  if (!result.ok || editorOpen || keepOpen === true) return false;
  if (keepOpen === false) return true;
  return config.behavior.hideAfterLaunch;
}

export function createVisibilityService(dependencies: VisibilityDependencies): VisibilityService {
  let pendingTimer: unknown = null;

  const cancelPendingHide = (): void => {
    if (pendingTimer === null) return;
    dependencies.clearTimer(pendingTimer);
    pendingTimer = null;
  };

  return {
    afterLaunch(config, result, context) {
      cancelPendingHide();
      if (!shouldAutoHideAfterLaunch(config, result, context)) return;
      pendingTimer = dependencies.setTimer(
        dependencies.hidePanel,
        config.behavior.hideAfterLaunchDelayMs,
      );
    },
    cancelPendingHide,
  };
}
