import { tokenMatches } from './tokens.ts';

const ROUTE = /^\/cal\/([A-Za-z0-9_-]+)\.ics$/;

const notFound = () => new Response(null, { status: 404 });

/** The only route is `GET|HEAD /cal/<token>.ics`; everything else, including a wrong token, is a 404. */
export function createHandler(tokens: readonly string[], getIcs: () => string) {
   return (req: Request): Response => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
      const match = ROUTE.exec(new URL(req.url).pathname);
      if (!match || !tokenMatches(match[1]!, tokens)) return notFound();

      const body = getIcs();
      const headers = {
         'Content-Type': 'text/calendar; charset=utf-8',
         'Content-Length': String(Buffer.byteLength(body)),
      };
      return new Response(req.method === 'HEAD' ? null : body, { status: 200, headers });
   };
}
