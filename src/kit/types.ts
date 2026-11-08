// Types for the addon kit: the subset of the Stremio addon protocol that Magnum Opus uses.
// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/README.md

export type MediaType = 'movie' | 'series';
export type Resource = 'stream' | 'subtitles';

/** A parsed Stremio id. `imdbId` is null for ids that come from a custom `idPrefixes` entry. */
export interface StremioId {
  /** The id exactly as requested, e.g. `tt0063350` or `tt0903747:1:2`. */
  raw: string;
  imdbId: string | null;
  /** Series only. */
  season: number | null;
  episode: number | null;
}

/** One source. Give `url` (direct link) or `infoHash` (+ `fileIdx`) for a torrent. */
export interface Stream {
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  /** Short label shown first, e.g. "Internet Archive". */
  name?: string;
  /** Longer text (several lines allowed); Magnum Opus reads quality tags out of it. */
  title?: string;
  description?: string;
  behaviorHints?: {
    filename?: string;
    videoSize?: number;
    notWebReady?: boolean;
    [key: string]: unknown;
  };
}

export interface Subtitle {
  id: string;
  url: string;
  /** ISO 639-2 code (e.g. "eng") or a language name. */
  lang: string;
}

/** Passed to handlers. Abort `signal` is fired when the request times out or the client leaves. */
export interface HandlerContext {
  signal: AbortSignal;
}

export type StreamHandler = (
  type: MediaType,
  id: StremioId,
  ctx: HandlerContext,
) => Promise<Stream[]> | Stream[];

export type SubtitlesHandler = (
  type: MediaType,
  id: StremioId,
  ctx: HandlerContext,
) => Promise<Subtitle[]> | Subtitle[];

export interface AddonDefinition {
  /** URL path segment and manifest id: lowercase letters, digits and dashes, e.g. "my-addon". */
  id: string;
  version: string;
  name: string;
  description: string;
  types: MediaType[];
  resources: Resource[];
  /** Extra id prefixes this addon accepts besides IMDb ids (default: IMDb `tt` ids only). */
  idPrefixes?: string[];
  /** Browser/proxy cache lifetime for stream and subtitles answers. Default 300 s. */
  cacheSeconds?: number;
  stream?: StreamHandler;
  subtitles?: SubtitlesHandler;
}

export interface Addon extends AddonDefinition {
  idPrefixes: string[];
  cacheSeconds: number;
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description: string;
  types: MediaType[];
  resources: Resource[];
  idPrefixes: string[];
  catalogs: never[];
}
