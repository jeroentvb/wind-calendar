import { loadConfig } from './config.ts';
import { Feed } from './scheduler.ts';
import { createHandler } from './server.ts';
import { loadTokens } from './tokens.ts';

const configPath = process.env.CONFIG_PATH ?? './config.yml';
const statePath = process.env.STATE_PATH ?? './data/state.json';
const port = Number(process.env.PORT ?? 3005);

try {
   const tokens = loadTokens();
   const config = await loadConfig(configPath);
   const feed = new Feed(config, { statePath });
   await feed.init();
   feed.start();

   Bun.serve({ port, hostname: '0.0.0.0', fetch: createHandler(tokens, () => feed.ics) });
   console.log(
      `wind-calendar listening on :${port}, ${config.spots.length} spots, refresh every ${config.fetchIntervalMinutes} min`,
   );
} catch (err) {
   console.error((err as Error).message);
   process.exit(1);
}
