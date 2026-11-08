import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { manifestOf } from '../../kit/index.ts';
import { checkManifest } from '../../testing/magnum-manifest.ts';
import {
  createArchiveClient,
  type FetchLike,
  formatSize,
  searchUrl,
  streamsFromMetadata,
} from './archive.ts';
import addon from './index.ts';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const searchNotld = fixture('search-tt0063350.json');
const metaNotld = fixture('metadata-notld_201610.json');
const metaGirl = fixture('metadata-GirlFriday.json');

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A fake archive.org: records requested URLs, answers from fixtures. */
function fakeArchive(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const u = new URL(url);
    if (u.pathname === '/advancedsearch.php') {
      if (u.searchParams.get('q')?.includes('tt0063350')) return ok(searchNotld);
      return ok({ response: { numFound: 0, start: 0, docs: [] } });
    }
    const o = overrides[u.pathname];
    if (o) return o();
    if (u.pathname === '/metadata/notld_201610') return ok(metaNotld);
    if (u.pathname === '/metadata/GirlFriday') return ok(metaGirl);
    return new Response('not found', { status: 404 });
  };
  return { fetch, urls };
}

test('search URL follows the Advanced Search API', () => {
  const u = new URL(searchUrl('tt0063350'));
  assert.equal(u.origin + u.pathname, 'https://archive.org/advancedsearch.php');
  assert.equal(u.searchParams.get('output'), 'json');
  assert.equal(u.searchParams.get('rows'), '5');
  assert.deepEqual(u.searchParams.getAll('fl[]'), ['identifier', 'title']);
  const q = u.searchParams.get('q') ?? '';
  assert.ok(q.includes('external-identifier:"urn:imdb:tt0063350"'));
  assert.ok(q.includes('imdb:"tt0063350"'));
  assert.ok(q.endsWith('AND mediatype:movies'));
});

test('maps metadata files to url streams: video only, mp4 first', () => {
  const streams = streamsFromMetadata('notld_201610', 'Night of the Living Dead', metaNotld);
  assert.equal(streams.length, 2); // thumbnail, torrent, xml are skipped
  assert.deepEqual(streams[0], {
    name: 'Internet Archive',
    title: 'Night of the Living Dead\nMPEG4 · 360p · 271 MB (496×360)',
    url: 'https://archive.org/download/notld_201610/notld.mp4',
    behaviorHints: { filename: 'notld.mp4', videoSize: 284358813 },
  });
  assert.equal(streams[1]?.url, 'https://archive.org/download/notld_201610/notld.ogv');
  assert.match(streams[1]?.title ?? '', /Ogg Video · 300p · 419 MB/);
});

test('file names are URL-encoded', () => {
  const streams = streamsFromMetadata('GirlFriday', 'x', metaGirl);
  assert.equal(
    streams[0]?.url,
    "https://archive.org/download/GirlFriday/The_Saint's_Girl_Friday_1953.mp4",
  );
  assert.equal(streams[0]?.behaviorHints?.filename, "The_Saint's_Girl_Friday_1953.mp4");
  const spaced = streamsFromMetadata('id', '', { files: [{ name: 'a dir/My Film #1.mp4' }] });
  assert.equal(spaced[0]?.url, 'https://archive.org/download/id/a%20dir/My%20Film%20%231.mp4');
});

test('orders mp4 before others, then by size; flags mkv/avi as not web ready', () => {
  const meta = {
    metadata: { title: 'T', mediatype: 'movies' },
    files: [
      { name: 'a.mkv', format: 'Matroska', size: '9000000000' },
      { name: 'b.mp4', format: 'h.264', size: '100000000', height: '480' },
      { name: 'c.mp4', format: 'h.264 HD', size: '800000000', height: '1080', width: '1920' },
      { name: 'd.avi', format: 'AVI', size: '5000000000' },
      { name: 'dir/e.ogv', format: 'Ogg Video', size: '1' },
      { name: 'x.thumbs/y.mp4', format: 'Thumbnail', size: '1' },
    ],
  };
  const s = streamsFromMetadata('id', '', meta);
  assert.deepEqual(
    s.map((x) => x.behaviorHints?.filename),
    ['c.mp4', 'b.mp4', 'a.mkv', 'd.avi', 'e.ogv'],
  );
  assert.equal(s[2]?.behaviorHints?.notWebReady, true);
  assert.equal(s[0]?.behaviorHints?.notWebReady, undefined);
  assert.match(s[0]?.title ?? '', /h\.264 HD · 1080p · 763 MB \(1920×1080\)/);
  assert.equal(s[4]?.url, 'https://archive.org/download/id/dir/e.ogv');
});

test('ignores non-movie items and garbage', () => {
  assert.deepEqual(
    streamsFromMetadata('x', '', { metadata: { mediatype: 'audio' }, files: [{ name: 'a.mp4' }] }),
    [],
  );
  assert.deepEqual(streamsFromMetadata('x', '', null), []);
  assert.deepEqual(streamsFromMetadata('x', '', { files: 'nope' }), []);
  assert.deepEqual(streamsFromMetadata('x', '', {}), []);
});

test('formatSize', () => {
  assert.equal(formatSize(284358813), '271 MB');
  assert.equal(formatSize(4 * 1024 ** 3), '4.0 GB');
  assert.equal(formatSize(10), '1 MB');
});

test('client: search then metadata, end to end with a fake fetch', async () => {
  const { fetch, urls } = fakeArchive();
  const client = createArchiveClient({ fetch });
  const streams = await client.streamsFor('tt0063350');
  assert.equal(streams.length, 2);
  assert.equal(streams[0]?.name, 'Internet Archive');
  assert.equal(urls.length, 2);
  assert.ok(urls[0]?.startsWith('https://archive.org/advancedsearch.php?'));
  assert.equal(urls[1], 'https://archive.org/metadata/notld_201610');
});

test('client: unknown film gives an empty list', async () => {
  const { fetch } = fakeArchive();
  assert.deepEqual(await createArchiveClient({ fetch }).streamsFor('tt9999999'), []);
});

test('client: results are cached for the ttl, then refreshed', async () => {
  let t = 1_000;
  const { fetch, urls } = fakeArchive();
  const client = createArchiveClient({ fetch, now: () => t, ttlMs: 3_600_000 });
  await client.streamsFor('tt0063350');
  await client.streamsFor('tt0063350');
  assert.equal(urls.length, 2); // second call served from memory
  t += 3_600_001;
  await client.streamsFor('tt0063350');
  assert.equal(urls.length, 4);
});

test('client: cache is bounded', async () => {
  const { fetch } = fakeArchive();
  const client = createArchiveClient({ fetch, maxEntries: 3 });
  for (let i = 1; i <= 10; i++) await client.streamsFor(`tt000000${i}`);
  assert.equal(client.cacheSize(), 3);
});

test('client: upstream errors give empty streams, and are remembered only briefly', async () => {
  let t = 0;
  let calls = 0;
  const fetch: FetchLike = async () => {
    calls++;
    return new Response('boom', { status: 503 });
  };
  const client = createArchiveClient({ fetch, now: () => t, errorTtlMs: 60_000 });
  assert.deepEqual(await client.streamsFor('tt0063350'), []);
  assert.deepEqual(await client.streamsFor('tt0063350'), []);
  assert.equal(calls, 1);
  t += 60_001;
  await client.streamsFor('tt0063350');
  assert.equal(calls, 2);
});

test('client: network failure and invalid JSON give empty streams', async () => {
  const down = createArchiveClient({
    fetch: async () => Promise.reject(new TypeError('fetch failed')),
  });
  assert.deepEqual(await down.streamsFor('tt1'), []);
  const junk = createArchiveClient({ fetch: async () => new Response('<html>', { status: 200 }) });
  assert.deepEqual(await junk.streamsFor('tt2'), []);
});

test('client: a hung request times out and gives empty streams', async () => {
  const hang: FetchLike = (_url, init) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
  const client = createArchiveClient({ fetch: hang, timeoutMs: 50 });
  const started = Date.now();
  assert.deepEqual(await client.streamsFor('tt0063350'), []);
  assert.ok(Date.now() - started < 1500);
});

test('client: one failing item does not hide the others', async () => {
  const search = {
    response: {
      docs: [
        { identifier: 'bad', title: 'B' },
        { identifier: 'notld_201610', title: 'N' },
      ],
    },
  };
  const fetch: FetchLike = async (url) =>
    new URL(url).pathname === '/advancedsearch.php'
      ? ok(search)
      : new URL(url).pathname === '/metadata/notld_201610'
        ? ok(metaNotld)
        : new Response('x', { status: 500 });
  const streams = await createArchiveClient({ fetch }).streamsFor('tt0063350');
  assert.equal(streams.length, 2);
});

test('client: odd identifiers from search are never fetched', async () => {
  const search = {
    response: {
      docs: [
        { identifier: '../../etc', title: 'x' },
        { identifier: 'a b', title: 'y' },
      ],
    },
  };
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    return ok(search);
  };
  assert.deepEqual(await createArchiveClient({ fetch }).streamsFor('tt1'), []);
  assert.equal(urls.length, 1);
});

test('addon: movies only, manifest accepted by Magnum Opus', async () => {
  const check = checkManifest(manifestOf(addon));
  assert.ok(check.ok);
  assert.deepEqual(check.manifest.resources, ['stream']);
  assert.deepEqual(check.manifest.types, ['movie']);
  const signal = new AbortController().signal;
  const series = { raw: 'tt1:1:1', imdbId: 'tt1', season: 1, episode: 1 };
  assert.deepEqual(await addon.stream?.('series', series, { signal }), []);
});
