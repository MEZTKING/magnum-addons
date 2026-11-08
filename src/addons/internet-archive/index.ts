import { defineAddon } from '../../kit/index.ts';
import { createArchiveClient } from './archive.ts';

const archive = createArchiveClient();

// Public-domain and freely hosted films from archive.org, found by IMDb id. Movies only.
export default defineAddon({
  id: 'internet-archive',
  version: '0.1.0',
  name: 'Internet Archive',
  description: 'Public-domain films hosted by archive.org, matched by IMDb id.',
  types: ['movie'],
  resources: ['stream'],
  // Free films rarely change; let Magnum Opus and proxies reuse an answer for an hour.
  cacheSeconds: 3600,
  async stream(type, id, { signal }) {
    if (type !== 'movie' || !id.imdbId) return [];
    return archive.streamsFor(id.imdbId, signal);
  },
});
