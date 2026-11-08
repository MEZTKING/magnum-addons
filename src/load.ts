import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Addon } from './kit/index.ts';

/**
 * Loads every `<dir>/<folder>/index.ts` whose default export is an addon made with
 * defineAddon(). Folders starting with "_" or "." (like `_template`) are skipped.
 */
export async function loadAddons(dir: string): Promise<Addon[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  const addons: Addon[] = [];
  for (const folder of folders) {
    const mod = (await import(pathToFileURL(join(dir, folder, 'index.ts')).href)) as {
      default?: Addon;
    };
    if (!mod.default?.id)
      throw new Error(`${folder}/index.ts must export default defineAddon(...)`);
    addons.push(mod.default);
  }
  return addons;
}
