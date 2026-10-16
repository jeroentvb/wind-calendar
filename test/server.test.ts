import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHandler } from '../src/server.ts';
import { loadTokens, tokenMatches } from '../src/tokens.ts';

const T1 = 'a'.repeat(20) + 'B_-'.repeat(10);
const T2 = 'Z9'.repeat(25);
const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';

describe('tokens', () => {
   test('loads primary and secondary token', () => {
      expect(loadTokens({ WIND_CAL_TOKEN: T1, WIND_CAL_TOKEN_2: T2 })).toEqual([T1, T2]);
   });

   test('requires a token of at least 256 bits', () => {
      expect(() => loadTokens({})).toThrow(/required/);
      expect(() => loadTokens({ WIND_CAL_TOKEN: 'short' })).toThrow(/43/);
      expect(() => loadTokens({ WIND_CAL_TOKEN: 'x'.repeat(42) + '+' })).toThrow(/43/);
   });

   test('tokenMatches', () => {
      expect(tokenMatches(T1, [T1, T2])).toBe(true);
      expect(tokenMatches(T2, [T1, T2])).toBe(true);
      expect(tokenMatches(T1 + 'x', [T1, T2])).toBe(false);
      expect(tokenMatches('', [T1])).toBe(false);
   });
});

describe('HTTP', () => {
   let server: ReturnType<typeof Bun.serve>;
   let base: string;
   beforeAll(() => {
      server = Bun.serve({ port: 0, fetch: createHandler([T1, T2], () => ICS) });
      base = `http://127.0.0.1:${server.port}`;
   });
   afterAll(() => server.stop(true));

   const req = (path: string, method = 'GET') => fetch(base + path, { method });

   test('GET with the right token returns the calendar', async () => {
      const res = await req(`/cal/${T1}.ics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
      expect(await res.text()).toBe(ICS);
   });

   test('second token works too', async () => {
      expect((await req(`/cal/${T2}.ics`)).status).toBe(200);
   });

   test('HEAD returns headers without a body', async () => {
      const res = await req(`/cal/${T1}.ics`, 'HEAD');
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
   });

   test.each([
      ['wrong token', `/cal/${'q'.repeat(43)}.ics`],
      ['token prefix', `/cal/${T1.slice(0, -1)}.ics`],
      ['root', '/'],
      ['no extension', `/cal/${T1}`],
      ['extra segment', `/cal/${T1}.ics/x`],
      ['health', '/health'],
   ])('404 for %s', async (_, path) => {
      const res = await req(path);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
   });

   test.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('404 for %s', async (method) => {
      expect((await req(`/cal/${T1}.ics`, method)).status).toBe(404);
   });
});
