import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { safeUpdaterErrorMessage, updaterFailureCode } from './releaseLookup';

export async function recordUpdaterFailure(
  stage: 'automatic-check' | 'fallback-check' | 'download' | 'install',
  error: unknown,
): Promise<string> {
  const code = updaterFailureCode(error);
  try {
    const directory = join(app.getPath('userData'), 'updater', 'diagnostics');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(join(directory, 'events.jsonl'), `${JSON.stringify({
      at: Date.now(),
      stage,
      code,
      message: safeUpdaterErrorMessage(error),
    })}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // An unavailable diagnostics directory must not hide the update result.
  }
  return code;
}
