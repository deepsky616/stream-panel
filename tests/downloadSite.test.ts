import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('download mirror generator', () => {
  it('publishes the installer and all electron-updater metadata together', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stream-panel-download-site-'));
    const input = join(root, 'input');
    const output = join(root, 'output');
    const installer = join(input, 'StreamPanel-9.8.7-Setup.exe');
    try {
      await mkdir(input, { recursive: true });
      await writeFile(installer, 'installer');
      await writeFile(`${installer}.blockmap`, 'blockmap');
      await writeFile(join(input, 'latest.yml'), 'version: 9.8.7\n');

      await execFileAsync(process.execPath, [
        resolve('scripts/generate-download-site.mjs'),
        installer,
        output,
      ]);

      await expect(readFile(join(output, 'StreamPanel-9.8.7-Setup.exe'), 'utf8'))
        .resolves.toBe('installer');
      await expect(readFile(join(output, 'StreamPanel-9.8.7-Setup.exe.blockmap'), 'utf8'))
        .resolves.toBe('blockmap');
      await expect(readFile(join(output, 'latest.yml'), 'utf8'))
        .resolves.toBe('version: 9.8.7\n');
      await expect(readFile(join(output, 'version.json'), 'utf8'))
        .resolves.toContain('"version": "9.8.7"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
