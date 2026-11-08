import type { Stream } from '../../kit/index.ts';

// Finds public-domain / freely hosted films on archive.org by IMDb id.
//
// 1. Advanced Search API: items whose `imdb` field (or `external-identifier`) holds the IMDb id.
//    The task spec suggested `external-identifier:"urn:imdb:ttNNN"` alone; checked live on
//    2026-11-08 it returns nothing for tt0063350 or tt0032599, while `imdb:ttNNN` finds them
//    (notld_201610, GirlFriday). Both fields are queried, so items that use either are found.
// 2. Metadata API: lists an item's files; we keep the playable video ones.

export const ARCHIVE_ORIGIN = 'https://archive.org';
const SEARCH_ROWS = 5;
const MAX_STREAMS = 20;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface ArchiveClientOptions {
  fetch?: FetchLike;
  /** Per upstream request. Magnum Opus gives an addon about 8 s in total. */
  timeoutMs?: number;
  /** How long a result is remembered. Default 1 hour. */
  ttlMs?: number;
  /** How long a failure is remembered, so a down archive.org isn't hammered. Default 1 min. */
  errorTtlMs?: number;
  /** Most entries kept in memory (oldest dropped first). Default 500. */
  maxEntries?: number;
  now?: () => number;
}

interface SearchDoc {
  identifier?: unknown;
  title?: unknown;
}
interface MetadataFile {
  name?: unknown;
  format?: unknown;
  size?: unknown;
  height?: unknown;
  width?: unknown;
}

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mkv', 'avi', 'ogv', 'webm']);
/** Formats browsers can't play natively; flagged so players can pick another source first. */
const NOT_WEB_READY = new Set(['mkv', 'avi']);

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function searchUrl(imdbId: string): string {
  const q = `(imdb:"${imdbId}" OR external-identifier:"urn:imdb:${imdbId}") AND mediatype:movies`;
  const params = new URLSearchParams({ q, output: 'json', rows: String(SEARCH_ROWS) });
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  return `${ARCHIVE_ORIGIN}/advancedsearch.php?${params}`;
}

export const metadataUrl = (identifier: string) =>
  `${ARCHIVE_ORIGIN}/metadata/${encodeURIComponent(identifier)}`;

export const downloadUrl = (identifier: string, fileName: string) =>
  `${ARCHIVE_ORIGIN}/download/${encodeURIComponent(identifier)}/${fileName
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

/** Maps one metadata response to streams (exported for tests). */
export function streamsFromMetadata(
  identifier: string,
  fallbackTitle: string,
  meta: unknown,
): Stream[] {
  if (!meta || typeof meta !== 'object') return [];
  const m = meta as { files?: unknown; metadata?: { title?: unknown; mediatype?: unknown } };
  if (m.metadata && m.metadata.mediatype !== undefined && m.metadata.mediatype !== 'movies')
    return [];
  if (!Array.isArray(m.files)) return [];
  const title = str(m.metadata?.title) || fallbackTitle || identifier;

  const out: { stream: Stream; ext: string; size: number }[] = [];
  for (const f of m.files as MetadataFile[]) {
    const name = str(f?.name);
    if (!name || name.includes('.thumbs/')) continue;
    const ext = extOf(name);
    if (!VIDEO_EXT.has(ext)) continue;
    const size = num(f.size) ?? 0;
    const height = num(f.height);
    const width = num(f.width);
    const details = [
      str(f.format) || ext.toUpperCase(),
      height ? `${height}p` : null,
      size ? formatSize(size) : null,
    ].filter(Boolean);
    const hints: NonNullable<Stream['behaviorHints']> = { filename: name.split('/').pop() };
    if (size) hints.videoSize = size;
    if (NOT_WEB_READY.has(ext)) hints.notWebReady = true;
    out.push({
      ext,
      size,
      stream: {
        name: 'Internet Archive',
        title: `${title}\n${details.join(' · ')}${width && height ? ` (${width}×${height})` : ''}`,
        url: downloadUrl(identifier, name),
        behaviorHints: hints,
      },
    });
  }
  const isMp4 = (e: string) => e === 'mp4' || e === 'm4v';
  out.sort((a, b) => Number(isMp4(b.ext)) - Number(isMp4(a.ext)) || b.size - a.size);
  return out.map((o) => o.stream);
}

export function createArchiveClient(opts: ArchiveClientOptions = {}) {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opts.timeoutMs ?? 3_500;
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  const errorTtlMs = opts.errorTtlMs ?? 60 * 1000;
  const maxEntries = opts.maxEntries ?? 500;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { expires: number; streams: Stream[] }>();

  async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    // A plain timer (not AbortSignal.timeout, whose timer is unref'd) that is cleared when done.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('archive.org timed out')), timeoutMs);
    try {
      const res = await doFetch(url, {
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
      });
      if (!res.ok) throw new Error(`archive.org answered ${res.status}`);
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > MAX_METADATA_BYTES) throw new Error('archive.org response too large');
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function lookup(imdbId: string, signal?: AbortSignal): Promise<Stream[]> {
    const search = (await getJson(searchUrl(imdbId), signal)) as {
      response?: { docs?: SearchDoc[] };
    };
    const docs = Array.isArray(search?.response?.docs) ? search.response.docs : [];
    const items = docs
      .map((d) => ({ identifier: str(d?.identifier), title: str(d?.title) }))
      .filter((d) => IDENTIFIER.test(d.identifier));
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const meta = await getJson(metadataUrl(item.identifier), signal);
          return streamsFromMetadata(item.identifier, item.title, meta);
        } catch {
          return []; // one broken item shouldn't hide the others
        }
      }),
    );
    // Streams keep the item order from the search, each item's own sort inside.
    // Overall: mp4 first, then bigger files first.
    const all = results.flat();
    const rank = (s: Stream) => (/\.(mp4|m4v)$/i.test(s.behaviorHints?.filename ?? '') ? 0 : 1);
    return all
      .map((s, i) => ({ s, i }))
      .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
      .map((x) => x.s)
      .slice(0, MAX_STREAMS);
  }

  /** Streams for an IMDb movie id. Never throws: errors give an empty list. */
  async function streamsFor(imdbId: string, signal?: AbortSignal): Promise<Stream[]> {
    const hit = cache.get(imdbId);
    if (hit && hit.expires > now()) {
      cache.delete(imdbId); // re-insert below so recently used entries survive eviction
      cache.set(imdbId, hit);
      return hit.streams;
    }
    let streams: Stream[];
    let ttl = ttlMs;
    try {
      streams = await lookup(imdbId, signal);
    } catch {
      streams = [];
      ttl = errorTtlMs;
      if (signal?.aborted) return streams; // our caller gave up: don't cache a non-answer
    }
    cache.delete(imdbId);
    cache.set(imdbId, { expires: now() + ttl, streams });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return streams;
  }

  return { streamsFor, cacheSize: () => cache.size };
}
