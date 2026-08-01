import type { AppConfig, LaunchResult } from '../../shared/types';

export type PeekEdge = 'right' | 'left' | 'top' | 'bottom';

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function inferPeekEdge(panel: Rectangle, workArea: Rectangle): PeekEdge {
  const centerX = panel.x + panel.width / 2;
  const centerY = panel.y + panel.height / 2;
  const distances: Array<[PeekEdge, number]> = [
    ['right', Math.abs(workArea.x + workArea.width - centerX)],
    ['left', Math.abs(centerX - workArea.x)],
    ['top', Math.abs(centerY - workArea.y)],
    ['bottom', Math.abs(workArea.y + workArea.height - centerY)],
  ];
  return distances.reduce((nearest, candidate) =>
    candidate[1] < nearest[1] ? candidate : nearest,
  )[0];
}

export function getPeekBounds(
  panel: Rectangle,
  workArea: Rectangle,
  edge: PeekEdge,
  thickness: number,
  length = 160,
): Rectangle {
  if (edge === 'left' || edge === 'right') {
    return {
      x: edge === 'left' ? workArea.x : workArea.x + workArea.width - thickness,
      y: clamp(panel.y, workArea.y, workArea.y + workArea.height - length),
      width: thickness,
      height: length,
    };
  }
  return {
    x: clamp(panel.x, workArea.x, workArea.x + workArea.width - length),
    y: edge === 'top' ? workArea.y : workArea.y + workArea.height - thickness,
    width: length,
    height: thickness,
  };
}

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
