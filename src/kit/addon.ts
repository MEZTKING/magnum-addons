import type { Addon, AddonDefinition, Manifest } from './types.ts';

const ADDON_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TYPES = ['movie', 'series'];

/**
 * Checks an addon definition and fills defaults. Throws on mistakes at start-up, so a broken
 * addon is noticed immediately rather than when Magnum Opus asks it for something.
 */
export function defineAddon(def: AddonDefinition): Addon {
  if (!ADDON_ID.test(def.id)) {
    throw new Error(`Addon id "${def.id}" must be lowercase letters, digits and dashes`);
  }
  if (def.types.length === 0 || def.types.some((t) => !TYPES.includes(t))) {
    throw new Error(`Addon "${def.id}": types must be "movie" and/or "series"`);
  }
  if (def.resources.length === 0) throw new Error(`Addon "${def.id}": no resources`);
  for (const r of def.resources) {
    if (r !== 'stream' && r !== 'subtitles') {
      throw new Error(`Addon "${def.id}": unknown resource "${r}"`);
    }
    if (typeof def[r] !== 'function') {
      throw new Error(`Addon "${def.id}": resource "${r}" is declared but has no ${r}() handler`);
    }
  }
  return {
    ...def,
    idPrefixes: def.idPrefixes?.length ? def.idPrefixes : ['tt'],
    cacheSeconds: def.cacheSeconds ?? 300,
  };
}

export function manifestOf(addon: Addon): Manifest {
  return {
    id: addon.id,
    version: addon.version,
    name: addon.name,
    description: addon.description,
    types: addon.types,
    resources: addon.resources,
    idPrefixes: addon.idPrefixes,
    catalogs: [],
  };
}
