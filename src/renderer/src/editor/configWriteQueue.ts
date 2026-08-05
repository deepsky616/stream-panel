import type { AppConfig } from '../../../shared/types';

export type ConfigPatchFactory = (current: AppConfig) => Partial<AppConfig>;

export interface ConfigWriteQueue {
  enqueue(createPatch: ConfigPatchFactory): Promise<AppConfig>;
  updateBase(config: AppConfig): void;
}

export function createConfigWriteQueue({
  initial,
  write,
}: {
  initial: AppConfig;
  write: (patch: Partial<AppConfig>) => Promise<AppConfig>;
}): ConfigWriteQueue {
  let latest = initial;
  let pending = 0;
  let tail = Promise.resolve(initial);
  return {
    enqueue(createPatch) {
      pending += 1;
      const run = tail.then((current) => write(createPatch(current)));
      tail = run.then(
        (saved) => {
          latest = saved;
          return saved;
        },
        () => latest,
      );
      void run.finally(() => { pending -= 1; }).catch(() => undefined);
      return run;
    },
    updateBase(config) {
      latest = config;
      if (pending === 0) tail = Promise.resolve(config);
    },
  };
}
