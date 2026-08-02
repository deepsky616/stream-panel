export interface WindowFocusDependencies {
  attempt: () => boolean;
  wait?: (delayMs: number) => Promise<void>;
  onFailure: () => void;
}

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function focusWithRetry({
  attempt,
  wait = waitFor,
  onFailure,
}: WindowFocusDependencies): Promise<boolean> {
  if (attempt()) return true;
  await wait(100);
  if (attempt()) return true;
  onFailure();
  return false;
}
