// Run inside the container by Docker's HEALTHCHECK; not exposed over HTTP.
import { loadTokens } from './tokens.ts';

const port = Number(process.env.PORT ?? 3005);

try {
   const [token] = loadTokens();
   const res = await fetch(`http://127.0.0.1:${port}/cal/${token}.ics`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
   });
   process.exit(res.status === 200 ? 0 : 1);
} catch {
   process.exit(1);
}
