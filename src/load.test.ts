import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { manifestOf } from './kit/index.ts';
import { loadAddons } from './load.ts';
import { checkManifest } from './testing/magnum-manifest.ts';

test('loads the addons in src/addons, skipping _template', async () => {
  const addons = await loadAddons(fileURLToPath(new URL('./addons', import.meta.url)));
  const ids = addons.map((a) => a.id);
  assert.ok(ids.includes('internet-archive'));
  assert.ok(!ids.includes('template'));
  for (const a of addons) assert.ok(checkManifest(manifestOf(a)).ok, a.id);
});

test('the template is a valid addon that returns no streams', async () => {
  const { default: template } = await import('./addons/_template/index.ts');
  assert.ok(checkManifest(manifestOf(template)).ok);
  const id = { raw: 'tt1', imdbId: 'tt1', season: null, episode: null };
  assert.deepEqual(
    await template.stream?.('movie', id, { signal: new AbortController().signal }),
    [],
  );
});
