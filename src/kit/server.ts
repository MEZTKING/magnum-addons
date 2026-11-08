import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { manifestOf } from './addon.ts';
import { parseId } from './ids.ts';
import type { Addon, MediaType } from './types.ts';

export interface ServeOptions {
  /** Port to listen on. 0 picks a free one. Default 7000. */
  port?: number;
  /** Interface to bind. Default all (0.0.0.0). */
  host?: string;
  /** Path prefix the app is mounted under when a proxy does not strip it, e.g. "/addons". */
  basePath?: string;
  /** Per-request deadline for addon handlers. Default 7000 ms (Magnum Opus waits 8 s). */
  requestTimeoutMs?: number;
  /** One line per request (method, path without query, status, ms). Default: stdout. */
  log?: (line: string) => void;
}

const DEFAULT_TIMEOUT_MS = 7_000;
const MEDIA_TYPES = new Set<string>(['movie', 'series']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function normalizeBasePath(p: string | undefined): string {
  const trimmed = (p ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

/** Builds (but does not start) the HTTP server. Mostly useful for tests; apps call serve(). */
export function createServer(addons: Addon[], opts: ServeOptions = {}) {
  const ids = new Set<string>();
  for (const a of addons) {
    if (ids.has(a.id)) throw new Error(`Duplicate addon id "${a.id}"`);
    ids.add(a.id);
  }
  const byId = new Map(addons.map((a) => [a.id, a]));
  const basePath = normalizeBasePath(opts.basePath);
  const timeoutMs = opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = opts.log ?? ((line: string) => console.log(line));

  function send(
    res: ServerResponse,
    req: IncomingMessage,
    status: number,
    body: string,
    contentType: string,
    cache: string,
  ) {
    res.writeHead(status, {
      ...CORS,
      'Content-Type': contentType,
      'Cache-Control': cache,
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const json = (
    res: ServerResponse,
    req: IncomingMessage,
    status: number,
    data: unknown,
    cache: string,
  ) => send(res, req, status, JSON.stringify(data), 'application/json; charset=utf-8', cache);
  const fail = (res: ServerResponse, req: IncomingMessage, status: number, message: string) =>
    json(res, req, status, { error: message }, 'no-store');

  function indexPage(req: IncomingMessage): string {
    const host = req.headers.host ?? 'localhost';
    const fwd = req.headers['x-forwarded-proto'];
    const proto = fwd === 'https' || fwd === 'http' ? fwd : 'http';
    const origin = `${proto}://${host}${basePath}`;
    const items = addons
      .map((a) => {
        const url = `${origin}/${a.id}/manifest.json`;
        return `<li><strong>${escapeHtml(a.name)}</strong> <small>v${escapeHtml(a.version)}</small><br>${escapeHtml(a.description)}<br><code>${escapeHtml(url)}</code></li>`;
      })
      .join('\n');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Magnum addons</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}li{margin:1rem 0}code{word-break:break-all}</style>
</head><body>
<h1>Magnum addons</h1>
<p>Paste a manifest URL into Magnum Opus (Manage addons).</p>
<ul>
${items || '<li>No addons loaded.</li>'}
</ul>
</body></html>
`;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return fail(res, req, 405, 'Method not allowed');
    }

    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      return fail(res, req, 400, 'Bad request');
    }
    if (basePath) {
      if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) {
        return fail(res, req, 404, 'Not found');
      }
      pathname = pathname.slice(basePath.length) || '/';
    }

    if (pathname === '/health') {
      return json(res, req, 200, { ok: true, addons: addons.length }, 'no-store');
    }
    if (pathname === '/') {
      return send(res, req, 200, indexPage(req), 'text/html; charset=utf-8', 'no-store');
    }

    const parts = pathname.split('/').slice(1);
    const addon = byId.get(parts[0] ?? '');
    if (!addon) return fail(res, req, 404, 'Not found');

    // /<addon>/manifest.json
    if (parts.length === 2 && parts[1] === 'manifest.json') {
      return json(res, req, 200, manifestOf(addon), 'public, max-age=300');
    }

    // /<addon>/<resource>/<type>/<id>.json
    if (parts.length === 4 && parts[3]?.endsWith('.json')) {
      const [, resource, type, file] = parts as [string, string, string, string];
      if (resource !== 'stream' && resource !== 'subtitles')
        return fail(res, req, 404, 'Not found');
      const handler = addon[resource];
      if (!addon.resources.includes(resource) || !handler) return fail(res, req, 404, 'Not found');
      if (!MEDIA_TYPES.has(type)) return fail(res, req, 400, 'Invalid type');
      if (!addon.types.includes(type as MediaType)) return fail(res, req, 404, 'Not found');
      let rawId: string;
      try {
        rawId = decodeURIComponent(file.slice(0, -'.json'.length));
      } catch {
        return fail(res, req, 400, 'Invalid id');
      }
      const id = parseId(type, rawId, addon.idPrefixes);
      if (!id) return fail(res, req, 400, 'Invalid id');

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('timeout'));
      }, timeoutMs);
      res.once('close', () => controller.abort());
      try {
        const result = await Promise.race([
          Promise.resolve(handler(type as MediaType, id, { signal: controller.signal })),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error('timeout')), {
              once: true,
            });
          }),
        ]);
        const cache = `public, max-age=${addon.cacheSeconds}`;
        return json(
          res,
          req,
          200,
          resource === 'stream' ? { streams: result } : { subtitles: result },
          cache,
        );
      } catch (err) {
        if (res.writableEnded || res.destroyed) return;
        if (!timedOut)
          log(`error ${addon.id}/${resource}: ${err instanceof Error ? err.message : String(err)}`);
        return fail(res, req, timedOut ? 504 : 500, timedOut ? 'Addon timed out' : 'Addon error');
      } finally {
        clearTimeout(timer);
      }
    }
    return fail(res, req, 404, 'Not found');
  }

  return createHttpServer((req, res) => {
    const started = Date.now();
    res.once('finish', () => {
      // Path only: query strings can carry user config or secrets.
      const path = (req.url ?? '').split('?')[0];
      log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`);
    });
    handle(req, res).catch((err) => {
      log(`error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) fail(res, req, 500, 'Internal error');
      else res.destroy();
    });
  });
}

export interface Running {
  port: number;
  close(): Promise<void>;
}

/** Hosts one or more addons on a single HTTP server, each under `/<addon-id>/`. */
export async function serve(addons: Addon[], opts: ServeOptions = {}): Promise<Running> {
  const server = createServer(addons, opts);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 7000, opts.host, () => {
      server.off('error', reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
