import { fileURLToPath } from 'node:url';
import { serve } from './kit/index.ts';
import { loadAddons } from './load.ts';

const port = Number(process.env.PORT ?? 7000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT "${process.env.PORT}"`);
  process.exit(1);
}
const basePath = process.env.BASE_PATH;

const addons = await loadAddons(fileURLToPath(new URL('./addons', import.meta.url)));
const running = await serve(addons, { port, basePath });

console.log(
  `magnum-addons listening on :${running.port}${basePath ? ` (base path ${basePath})` : ''}`,
);
for (const a of addons) console.log(`  ${a.name}: /${a.id}/manifest.json`);

const stop = () => {
  running.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
