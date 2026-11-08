import type { StremioId } from './types.ts';

/** An IMDb id, or for series `tt…:season:episode`. */
export const IMDB_ID = /^tt\d+(?::\d+:\d+)?$/;
/** Whatever else a custom prefix may be followed by: kept to a safe, short alphabet. */
const CUSTOM_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

const MAX_NUMBER = 100_000;

/**
 * Validates and parses an id from the URL. Returns null when it isn't acceptable:
 * - IMDb ids (`tt0063350`; series need `tt0903747:1:2`, movies must not carry season/episode);
 * - or an id that starts with one of the addon's own `idPrefixes` (other than "tt").
 */
export function parseId(
  type: string,
  raw: string,
  idPrefixes: readonly string[],
): StremioId | null {
  if (IMDB_ID.test(raw)) {
    const [imdbId, season, episode] = raw.split(':') as [string, string?, string?];
    const hasSE = season !== undefined && episode !== undefined;
    if (type === 'series' && !hasSE) return null;
    if (type === 'movie' && hasSE) return null;
    if (!hasSE) return { raw, imdbId, season: null, episode: null };
    const s = Number.parseInt(season, 10);
    const e = Number.parseInt(episode, 10);
    if (s > MAX_NUMBER || e > MAX_NUMBER) return null;
    return { raw, imdbId, season: s, episode: e };
  }
  const custom = idPrefixes.filter((p) => p !== 'tt' && p.length > 0);
  if (custom.some((p) => raw.startsWith(p)) && CUSTOM_ID.test(raw)) {
    return { raw, imdbId: null, season: null, episode: null };
  }
  return null;
}
