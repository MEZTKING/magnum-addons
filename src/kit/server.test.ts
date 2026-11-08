import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { checkManifest } from '../testing/magnum-manifest.ts';
import { defineAddon } from './addon.ts';
import { type Running, serve } from './server.ts';
import type { Stream } from './types.ts';

const calls: string[] = [];
const echo = defineAddon({
  id: 'echo',
  version: '1.2.3',
  name: 'Echo <b>',
  description: 'Echoes ids',
  types: ['movie', 'series'],
  resources: ['stream', 'subtitles'],
  cacheSeconds: 120,
  stream(type, id): Stream[] {
    calls.push(`${type}:${id.raw}`);
    return [
      {
        name: 'Echo',
        url: `https://example.com/${id.imdbId}/${id.season ?? 0}/${id.episode ?? 0}`,
      },
    ];
  },
  subtitles: () => [{ id: 's', lang: 'eng', url: 'https://example.com/s.vtt' }],
});
const slow = defineAddon({
  id: 'slow',
  version: '1.0.0',
  name: 'Slow',
  description: 'Never answers',
  types: ['movie'],
  resources: ['stream'],
  stream: (_t, _i, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener('abort', () => reject(new Error('aborted'))),
    ),
});
const broken = defineAddon({
  id: 'broken',
  version: '1.0.0',
  name: 'Broken',
  description: 'Throws',
  types: ['movie'],
  resources: ['stream'],
  stream: () => {
    throw new Error('secret internals');
  },
});
const custom = defineAddon({
  id: 'custom',
  version: '1.0.0',
  name: 'Custom',
  description: 'Own ids',
  types: ['movie'],
  resources: ['stream'],
  idPrefixes: ['tt', 'my:'],
  stream: (_t, id) => [{ name: id.raw, url: 'https://example.com/x' }],
});

interface Body {
  streams: { name: string; url: string }[];
  error?: string;
  idPrefixes?: unknown;
}
const body = async (res: Response) => (await res.json()) as Body;

const logs: string[] = [];
let srv: Running;
let base: string;

before(async () => {
  srv = await serve([echo, slow, broken, custom], {
    port: 0,
    host: '127.0.0.1',
    requestTimeoutMs: 150,
    log: (l) => logs.push(l),
  });
  base = `http://127.0.0.1:${srv.port}`;
});
after(() => srv.close());

describe('manifest', () => {
  test('shape is accepted by Magnum Opus validation', async () => {
    const res = await fetch(`${base}/echo/manifest.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
    const m = (await res.json()) as Body;
    assert.deepEqual(m, {
      id: 'echo',
      version: '1.2.3',
      name: 'Echo <b>',
      description: 'Echoes ids',
      types: ['movie', 'series'],
      resources: ['stream', 'subtitles'],
      idPrefixes: ['tt'],
      catalogs: [],
    });
    const check = checkManifest(m);
    assert.ok(check.ok);
    assert.deepEqual(check.manifest.resources, ['stream', 'subtitles']);
    assert.deepEqual(check.manifest.types, ['movie', 'series']);
    assert.deepEqual(check.manifest.subtitleTypes, ['movie', 'series']);
  });

  test('custom idPrefixes still include tt, so Magnum accepts it', async () => {
    const m = await body(await fetch(`${base}/custom/manifest.json`));
    assert.deepEqual(m.idPrefixes, ['tt', 'my:']);
    assert.ok(checkManifest(m).ok);
  });

  test('is cacheable', async () => {
    const res = await fetch(`${base}/echo/manifest.json`);
    assert.match(res.headers.get('cache-control') ?? '', /max-age=300/);
  });
});

describe('cors', () => {
  test('every response carries it, including errors', async () => {
    for (const path of [
      '/',
      '/health',
      '/echo/manifest.json',
      '/nope',
      '/echo/stream/movie/bad.json',
    ]) {
      const res = await fetch(base + path);
      assert.equal(res.headers.get('access-control-allow-origin'), '*', path);
    }
  });

  test('preflight', async () => {
    const res = await fetch(`${base}/echo/stream/movie/tt1.json`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /GET/);
  });
});

describe('streams', () => {
  test('movie', async () => {
    const res = await fetch(`${base}/echo/stream/movie/tt0063350.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /public, max-age=120/);
    assert.deepEqual(await res.json(), {
      streams: [{ name: 'Echo', url: 'https://example.com/tt0063350/0/0' }],
    });
  });

  test('series id is parsed, also when percent-encoded as Magnum Opus sends it', async () => {
    for (const id of ['tt0903747:5:14', 'tt0903747%3A5%3A14']) {
      const b = await body(await fetch(`${base}/echo/stream/series/${id}.json`));
      assert.equal(b.streams[0]?.url, 'https://example.com/tt0903747/5/14', id);
    }
  });

  test('subtitles', async () => {
    const body = await (await fetch(`${base}/echo/subtitles/movie/tt1.json`)).json();
    assert.deepEqual(body, {
      subtitles: [{ id: 's', lang: 'eng', url: 'https://example.com/s.vtt' }],
    });
  });

  test('custom prefix ids', async () => {
    const res = await fetch(`${base}/custom/stream/movie/my:abc.json`);
    assert.equal(res.status, 200);
    assert.equal((await body(res)).streams[0]?.name, 'my:abc');
  });

  test('HEAD has no body', async () => {
    const res = await fetch(`${base}/echo/stream/movie/tt1.json`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
  });
});

describe('validation', () => {
  const cases: [string, number][] = [
    ['/echo/stream/movie/notanid.json', 400],
    ['/echo/stream/movie/tt1:1:2.json', 400],
    ['/echo/stream/series/tt1.json', 400],
    ['/echo/stream/series/tt1:a:b.json', 400],
    ['/echo/stream/movie/..%2F..%2Fetc%2Fpasswd.json', 400],
    ['/echo/stream/movie/%E0%A4%A.json', 400],
    ['/echo/stream/movie/my:abc.json', 400], // prefix not declared by this addon
    ['/echo/stream/tv/tt1.json', 400], // unknown type
    ['/slow/stream/series/tt1:1:1.json', 404], // addon doesn't serve series
  ];
  for (const [path, status] of cases) {
    test(`${path} -> ${status}`, async () => {
      const res = await fetch(base + path);
      assert.equal(res.status, status);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.ok((await body(res)).error);
    });
  }
});

describe('404 and methods', () => {
  for (const path of [
    '/nope',
    '/nope/manifest.json',
    '/echo',
    '/echo/',
    '/echo/catalog/movie/top.json',
    '/echo/stream/movie/tt1', // missing .json
    '/echo/stream/movie/tt1.json/extra',
    '/broken/subtitles/movie/tt1.json', // resource not offered
  ]) {
    test(path, async () => {
      assert.equal((await fetch(base + path)).status, 404);
    });
  }

  test('POST is refused', async () => {
    const res = await fetch(`${base}/echo/manifest.json`, { method: 'POST' });
    assert.equal(res.status, 405);
  });
});

describe('failures', () => {
  test('a handler that never answers gets 504 after the request timeout', async () => {
    const started = Date.now();
    const res = await fetch(`${base}/slow/stream/movie/tt1.json`);
    assert.equal(res.status, 504);
    assert.ok(Date.now() - started < 2000);
  });

  test('a throwing handler gives 500 without leaking the message', async () => {
    const res = await fetch(`${base}/broken/stream/movie/tt1.json`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Addon error' });
    assert.ok(logs.some((l) => l.includes('secret internals'))); // logged server-side only
  });
});

describe('index and health', () => {
  test('health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, addons: 4 });
  });

  test('index lists addons with manifest URLs, escaped', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
    const html = await res.text();
    assert.ok(html.includes(`${base}/echo/manifest.json`));
    assert.ok(html.includes(`${base}/custom/manifest.json`));
    assert.ok(html.includes('Echo &#60;b&#62;'));
    assert.ok(!html.includes('Echo <b>'));
  });

  test('requests are logged without query strings', async () => {
    await fetch(`${base}/health?token=hunter2`);
    assert.ok(logs.some((l) => l.startsWith('GET /health 200')));
    assert.ok(!logs.some((l) => l.includes('hunter2')));
  });
});

describe('base path and definitions', () => {
  test('BASE_PATH prefix', async () => {
    const s = await serve([echo], {
      port: 0,
      host: '127.0.0.1',
      basePath: '/addons/',
      log: () => {},
    });
    try {
      const b = `http://127.0.0.1:${s.port}`;
      assert.equal((await fetch(`${b}/addons/echo/manifest.json`)).status, 200);
      assert.equal((await fetch(`${b}/addons/health`)).status, 200);
      assert.equal((await fetch(`${b}/echo/manifest.json`)).status, 404);
      const html = await (await fetch(`${b}/addons/`)).text();
      assert.ok(html.includes(`${b}/addons/echo/manifest.json`));
    } finally {
      await s.close();
    }
  });

  test('defineAddon rejects mistakes', () => {
    const ok = { version: '1', name: 'x', description: 'x', types: ['movie' as const] };
    assert.throws(
      () => defineAddon({ ...ok, id: 'Bad Id', resources: ['stream'], stream: () => [] }),
      /id/,
    );
    assert.throws(
      () => defineAddon({ ...ok, id: 'a', resources: ['stream'] }),
      /no stream\(\) handler/,
    );
    assert.throws(() => defineAddon({ ...ok, id: 'a', resources: [] }), /no resources/);
    assert.throws(
      () => defineAddon({ ...ok, id: 'a', types: [], resources: ['stream'], stream: () => [] }),
      /types/,
    );
  });

  test('duplicate ids are refused', async () => {
    await assert.rejects(serve([echo, echo], { port: 0 }), /Duplicate/);
  });
});
