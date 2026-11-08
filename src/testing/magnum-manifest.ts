// A copy of the manifest validation in Magnum Opus (apps/server/src/addons/manifest.ts,
// checkManifest), trimmed to what the tests need, so this repo stays standalone. If Magnum Opus
// changes what it accepts, update this copy.

type MediaType = 'movie' | 'series';
type Resource = 'stream' | 'subtitles';

export interface ParsedManifest {
  name: string;
  description: string | null;
  resources: Resource[];
  types: MediaType[];
  subtitleTypes: MediaType[];
}
export type ManifestCheck = { ok: true; manifest: ParsedManifest } | { ok: false; message: string };

const MEDIA_TYPES: MediaType[] = ['movie', 'series'];

type ResourceCheck =
  | { status: 'missing' }
  | { status: 'no_types' }
  | { status: 'no_imdb' }
  | { status: 'ok'; types: MediaType[] };

const imdbPrefix = (p: unknown) =>
  typeof p === 'string' && ('tt'.startsWith(p) || p.startsWith('tt'));

function checkResource(m: Record<string, unknown>, name: Resource): ResourceCheck {
  const topTypes = Array.isArray(m.types) ? m.types.filter((t) => typeof t === 'string') : [];
  const topPrefixes = Array.isArray(m.idPrefixes) ? m.idPrefixes : null;
  let declared: string[] | null = null;
  let prefixes: unknown[] | null = topPrefixes;
  for (const r of m.resources as unknown[]) {
    if (r === name) declared = topTypes;
    else if (r && typeof r === 'object' && (r as { name?: unknown }).name === name) {
      const res = r as { types?: unknown; idPrefixes?: unknown };
      declared = Array.isArray(res.types) ? (res.types as string[]) : topTypes;
      if (Array.isArray(res.idPrefixes)) prefixes = res.idPrefixes;
    }
  }
  if (!declared) return { status: 'missing' };
  const types = MEDIA_TYPES.filter((t) => declared?.includes(t));
  if (types.length === 0) return { status: 'no_types' };
  if (prefixes && !prefixes.some(imdbPrefix)) return { status: 'no_imdb' };
  return { status: 'ok', types };
}

export function checkManifest(raw: unknown): ManifestCheck {
  if (!raw || typeof raw !== 'object')
    return { ok: false, message: "That isn't an addon manifest." };
  const m = raw as Record<string, unknown>;
  const name = typeof m.name === 'string' ? m.name.trim().slice(0, 100) : '';
  if (!name || typeof m.id !== 'string' || !Array.isArray(m.resources)) {
    return { ok: false, message: "That isn't an addon manifest (no id, name or resources)." };
  }
  const stream = checkResource(m, 'stream');
  const subtitles = checkResource(m, 'subtitles');
  if (stream.status !== 'ok' && subtitles.status !== 'ok') {
    return { ok: false, message: "This addon doesn't provide usable streams or subtitles." };
  }
  const resources: Resource[] = [];
  if (stream.status === 'ok') resources.push('stream');
  if (subtitles.status === 'ok') resources.push('subtitles');
  const description =
    typeof m.description === 'string' && m.description.trim()
      ? m.description.trim().slice(0, 500)
      : null;
  return {
    ok: true,
    manifest: {
      name,
      description,
      resources,
      types: stream.status === 'ok' ? stream.types : [],
      subtitleTypes: subtitles.status === 'ok' ? subtitles.types : [],
    },
  };
}
