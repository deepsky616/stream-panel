import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeckItem } from '../../shared/types';

function collectReferencedIcons(items: readonly DeckItem[], result = new Set<string>()): Set<string> {
  for (const item of items) {
    if (item.icon.kind === 'file') result.add(item.icon.path);
    if (item.kind === 'folder') collectReferencedIcons(item.children, result);
  }
  return result;
}

export async function cleanupOrphanIcons(items: readonly DeckItem[], userDataPath: string): Promise<void> {
  const directory = join(userDataPath, 'icons');
  const referenced = collectReferencedIcons(items);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.isFile() &&
          !entry.isSymbolicLink() &&
          entry.name.toLowerCase().endsWith('.png') &&
          !referenced.has(entry.name)
        ) {
          await unlink(join(directory, entry.name));
        }
      }),
    );
  } catch {
    // An absent icon directory is normal before the first import.
  }
}
