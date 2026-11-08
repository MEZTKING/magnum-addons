// HOW TO ADD AN ADDON
//
// 1. Copy this folder:      cp -r src/addons/_template src/addons/my-addon
//    (folders starting with "_" are skipped by the server; yours must not start with one)
// 2. Edit src/addons/my-addon/index.ts: change `id` (lowercase letters, digits, dashes; it
//    becomes the URL path), name, description, and fill in stream() / subtitles().
// 3. Restart (`pnpm start`). The server finds every src/addons/<folder>/index.ts and serves
//    it at /<id>/manifest.json. Nothing to register by hand.
// 4. Add a test next to it (see src/addons/internet-archive/*.test.ts for a fake-fetch example).
// 5. In Magnum Opus: Manage addons, paste https://<your-host>/<id>/manifest.json.
//
// What Magnum Opus asks for:
//   GET /<id>/stream/movie/tt0063350.json        -> { "streams": [ ... ] }
//   GET /<id>/stream/series/tt0903747:1:2.json   -> series ids are tt…:season:episode
//   GET /<id>/subtitles/<type>/<id>.json         -> { "subtitles": [ ... ] }  (optional)
// The kit has already validated `type` and `id` by the time your function runs, and gives
// you `id.imdbId`, `id.season` and `id.episode` parsed. Return [] when you have nothing.
//
// RULES
// - Don't hardcode secrets (API keys, tokens). Read them from the environment:
//     const key = process.env.MY_ADDON_API_KEY;
//   and pass them in through docker-compose.yml / a .env file that is never committed.
// - Don't scrape sites that forbid it (check their terms and robots.txt). Prefer official APIs.
// - Keep sources legal: public domain, Creative Commons, or content you have the right to
//   share. You are responsible for what your addons provide.
// - Be a good client: use timeouts, cache results, never let an upstream error become a 500
//   (return []).

import { defineAddon } from '../../kit/index.ts';

export default defineAddon({
  id: 'template', // URL path + manifest id. Change it.
  version: '0.1.0',
  name: 'Template',
  description: 'Copy me. Returns no streams.',
  types: ['movie', 'series'], // what you can answer
  resources: ['stream'], // add 'subtitles' and a subtitles() function below if you provide them
  // idPrefixes: ['myprefix:'], // only if you use ids other than IMDb ones

  // Called for GET /<id>/stream/<type>/<id>.json
  // `id.imdbId` is e.g. "tt0063350"; for series `id.season` / `id.episode` are numbers.
  // `signal` aborts when the request times out: pass it to fetch().
  async stream(_type, _id, { signal: _signal }) {
    // Example of a direct-URL stream:
    // return [{ name: 'My source', title: 'Movie title\nMP4 · 1080p · 1.4 GB', url: 'https://…' }];
    // Example of a torrent stream (Magnum Opus resolves it through Real-Debrid):
    // return [{ name: 'My source', infoHash: '0123…40 hex chars…', fileIdx: 0 }];
    return [];
  },

  // async subtitles(_type, _id, { signal }) {
  //   return [{ id: 'sub-1', lang: 'eng', url: 'https://…/file.vtt' }];
  // },
});
