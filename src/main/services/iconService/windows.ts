import { app } from 'electron';

let fileIconQueue: Promise<void> = Promise.resolve();

export function getNativeFileIcon(target: string): Promise<Electron.NativeImage> {
  const task = fileIconQueue.then(() => app.getFileIcon(target, { size: 'large' }));
  fileIconQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
