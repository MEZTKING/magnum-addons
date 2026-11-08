# magnum-addons

My own custom addons for [Magnum Opus](https://github.com/MEZTKING/magnum-opus), the friends-only
streaming hub. Magnum Opus talks to addons using the Stremio addon protocol; this repo hosts
several addons on one small Node server and includes a tiny kit for writing more.

- **`src/kit/`**: `defineAddon(...)` and `serve(...)`, built on `node:http`, no runtime dependencies.
- **`src/addons/internet-archive/`**: a working example. Public-domain films from archive.org, found by IMDb id.
- **`src/addons/_template/`**: a commented copy-me template for new addons.
- **`src/server.ts`**: starts a server with every addon found in `src/addons/`.

Each addon lives under its own path: `https://<host>/<addon-id>/manifest.json`,
`/<addon-id>/stream/movie/tt….json`, `/<addon-id>/stream/series/tt…:S:E.json`, optionally
`/<addon-id>/subtitles/…`. `/` lists the addons and `/health` answers `{"ok":true}`.

## Run it locally

Needs Node 22.18 or newer (it runs the TypeScript directly, no build step) and pnpm 10.

```sh
pnpm install
pnpm start          # http://localhost:7000  (PORT=… to change; pnpm dev restarts on edits)
```

Open <http://localhost:7000/> to see the addons and their manifest URLs.
`BASE_PATH=/addons` serves everything under that prefix (for a proxy that does not strip it).

## Run it on the Magnum Opus server

On the same VPS as Magnum Opus, in a clone of this repo:

```sh
git clone <this repo> magnum-addons && cd magnum-addons
docker compose up -d --build
```

`docker-compose.yml` publishes port 7000 on `127.0.0.1` only. Put it behind your reverse proxy
so it has a public https address.

### Caddy

Either a subdomain:

```caddy
addons.example.com {
    reverse_proxy 127.0.0.1:7000
}
```

or a path on your existing site (Caddy strips the prefix):

```caddy
example.com {
    handle_path /addons/* {
        reverse_proxy 127.0.0.1:7000
    }
    # … the rest of your Magnum Opus config
}
```

If Magnum Opus itself runs in Docker and Caddy is a container too, point `reverse_proxy` at
the addons container instead, with both on the same compose network, for example
`reverse_proxy addons:7000`.

To update later: `git pull && docker compose up -d --build`.

## Add an addon to Magnum Opus

In Magnum Opus: **Manage addons**, paste the manifest URL, for example

```
https://addons.example.com/internet-archive/manifest.json
```

(or `https://example.com/addons/internet-archive/manifest.json` with the path setup).

**Use the public address.** In production Magnum Opus refuses addon URLs that point at
private or loopback addresses (`localhost`, `127.0.0.1`, `192.168.x.x`, Docker service names
like `http://addons:7000`) as an SSRF guard. So the URL must be your real domain, even though
the addon runs on the same machine. Plain `http://localhost:7000/...` only works on a
development copy of Magnum Opus.

Magnum Opus waits about 8 seconds for an addon. The kit's per-request timeout is 7 s, and the
Internet Archive addon uses 3.5 s per archive.org call and answers with an empty list on any error.

## Write a new addon

1. `cp -r src/addons/_template src/addons/my-addon`
2. Edit `src/addons/my-addon/index.ts`: set `id` (lowercase letters, digits, dashes; it becomes
   the URL path), `name`, `description`, and fill in `stream()` and/or `subtitles()`.
3. `pnpm start`. It is picked up automatically (folders starting with `_` are skipped).
4. Add a test next to it. `src/addons/internet-archive/archive.test.ts` shows testing with a
   fake `fetch` and fixtures.

```ts
import { defineAddon } from '../../kit/index.ts';

export default defineAddon({
  id: 'my-addon',
  version: '0.1.0',
  name: 'My addon',
  description: 'What it provides',
  types: ['movie', 'series'],
  resources: ['stream'],
  async stream(type, id, { signal }) {
    // id.imdbId, and for series id.season / id.episode
    return [{ name: 'My source', title: 'Title\nMP4 · 1080p · 1.4 GB', url: 'https://…' }];
  },
});
```

A stream has either `url` (a direct link) or `infoHash` (+ `fileIdx`, resolved by Magnum Opus
through Real-Debrid), plus `name` (short label) and `title`/`description` (Magnum Opus reads
quality, codec and size out of this text). The kit validates `type` and `id` before your function
runs (IMDb ids `tt…`, series `tt…:season:episode`, or your own `idPrefixes`), adds CORS and
cache headers, and times requests out. `signal` is aborted on timeout: pass it to `fetch()`.

## Internet Archive addon

Movies only. For an IMDb id it queries the archive.org Advanced Search API for items tagged with
that id, then the metadata API for each item's files, and returns the video files (mp4 first,
then by size; also ogv, webm, mkv, avi if present) as direct `url` streams named "Internet
Archive". Results are cached in memory for an hour (bounded to 500 titles). Errors and timeouts
give an empty stream list, never an HTTP error. Note that it only has what archive.org has
tagged with an IMDb id; many films will return nothing, and items are sometimes mislabeled
by their uploaders.

## Development

```sh
pnpm test        # node:test
pnpm lint        # Biome
pnpm format      # Biome, writes fixes
pnpm typecheck   # tsc --noEmit
```

The tests don't touch the network. The fixtures in `src/addons/internet-archive/fixtures/` are
trimmed real responses from archive.org (captured 2026-11-08). `src/testing/magnum-manifest.ts`
is a copy of Magnum Opus's manifest validation, so the tests check that our manifests would be
accepted; update it if Magnum Opus changes what it accepts.

## Rules and legal note

- **No secrets in code.** Read API keys and tokens from the environment (`process.env`), pass
  them through `docker-compose.yml` or an untracked `.env`. This repo is private, but keep it clean.
- **Don't scrape sites that forbid it.** Check terms of service and `robots.txt`; prefer official APIs.
- **Keep sources legal.** Public domain, Creative Commons, or content you have the right to
  share. You are responsible for what your addons provide.
