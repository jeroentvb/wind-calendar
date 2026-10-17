import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/config.ts';
import { Feed } from '../src/scheduler.ts';

const config = parseConfig(`
conditions: { minWindKn: 15, minDurationHours: 2, minTempC: 5 }
maxDaysAhead: 3
models: [[{ id: ecmwf_ifs025 }]]
spots:
  - { name: A, lat: 52, lon: 4, directions: [W] }
`);

const DAY0 = Date.UTC(2026, 9, 17) / 1000;

/** Single-model Open-Meteo body: 24 hours, 20 kn from the west between 10:00 and 14:00 UTC. */
function body(windKn = 20) {
   const times = Array.from({ length: 24 }, (_, i) => DAY0 + i * 3600);
   const wind = times.map((_, i) => (i >= 10 && i < 14 ? windKn : 5));
   return {
      hourly: {
         time: times,
         wind_speed_10m: wind,
         wind_gusts_10m: wind.map((w) => w + 6),
         wind_direction_10m: times.map(() => 270),
         temperature_2m: times.map(() => 15),
         weather_code: times.map(() => 3),
         cape: times.map(() => 0),
      },
      daily: { time: [DAY0], sunrise: [DAY0 + 6 * 3600], sunset: [DAY0 + 17 * 3600] },
   };
}

const ok = (b: unknown) => (async () => Response.json(b)) as unknown as typeof fetch;
const failing = (async () => {
   throw new Error('network down');
}) as unknown as typeof fetch;

let dir: string;
beforeEach(async () => {
   dir = await mkdtemp(join(tmpdir(), 'wind-cal-'));
});
afterEach(async () => {
   await rm(dir, { recursive: true, force: true });
});

const base = { now: () => DAY0, sleep: async () => {}, log: () => {} };
const eventCount = (ics: string) => (ics.match(/BEGIN:VEVENT/g) ?? []).length;

test('refresh builds events from fetched data', async () => {
   const feed = new Feed(config, { ...base, fetchImpl: ok(body()) });
   expect(eventCount(feed.ics)).toBe(0);
   await feed.refresh();
   expect(eventCount(feed.ics)).toBe(1);
   expect(feed.ics).toContain('DTSTART:20261017T100000Z');
});

test('a failed fetch keeps serving the last successful forecast', async () => {
   let fetchImpl = ok(body());
   const feed = new Feed(config, {
      ...base,
      fetchImpl: ((...a: Parameters<typeof fetch>) => fetchImpl(...a)) as typeof fetch,
   });
   await feed.refresh();
   fetchImpl = failing;
   await feed.refresh();
   expect(eventCount(feed.ics)).toBe(1);
});

test('retries before giving up', async () => {
   let calls = 0;
   const flaky = (async () => {
      calls++;
      if (calls < 3) throw new Error('blip');
      return Response.json(body());
   }) as unknown as typeof fetch;
   const feed = new Feed(config, { ...base, fetchImpl: flaky });
   await feed.refresh();
   expect(calls).toBe(3);
   expect(eventCount(feed.ics)).toBe(1);
});

test('events disappear when the forecast stops qualifying', async () => {
   let b = body(20);
   const feed = new Feed(config, { ...base, fetchImpl: (async () => Response.json(b)) as unknown as typeof fetch });
   await feed.refresh();
   b = body(10);
   await feed.refresh();
   expect(eventCount(feed.ics)).toBe(0);
});

test('last-good data survives a restart with a failing network', async () => {
   const statePath = join(dir, 'data', 'state.json');
   const first = new Feed(config, { ...base, statePath, fetchImpl: ok(body()) });
   await first.refresh();

   const second = new Feed(config, { ...base, statePath, fetchImpl: failing });
   await second.init();
   await second.refresh();
   expect(eventCount(second.ics)).toBe(1);
});

test("stored data is ignored when the spot's location or models change", async () => {
   const statePath = join(dir, 'state.json');
   await new Feed(config, { ...base, statePath, fetchImpl: ok(body()) }).refresh();
   const moved = { ...config, spots: [{ ...config.spots[0]!, lat: 51 }] };
   const feed = new Feed(moved, { ...base, statePath, fetchImpl: failing });
   await feed.init();
   expect(eventCount(feed.ics)).toBe(0);
});

test('events beyond maxDaysAhead are left out', async () => {
   const cfg = { ...config, outlookDays: 0 };
   const feed = new Feed(cfg, { ...base, now: () => DAY0 - 3 * 86400, fetchImpl: ok(body()) });
   await feed.refresh();
   expect(eventCount(feed.ics)).toBe(0);
});

test('days after maxDaysAhead get uncertain outlook events', async () => {
   let days: string | null = null as string | null;
   const fetchImpl = (async (url: string) => {
      days = new URL(url).searchParams.get('forecast_days');
      return Response.json(body());
   }) as unknown as typeof fetch;
   const feed = new Feed(config, { ...base, now: () => DAY0 - 3 * 86400, fetchImpl });
   await feed.refresh();
   expect(days).toBe(String(3 + 4 + 1));
   expect(eventCount(feed.ics)).toBe(1);
   expect(feed.ics.replace(/\r\n /g, '')).toContain('SUMMARY:🔮 A 20-26kn W');
   expect(feed.ics).toContain('STATUS:TENTATIVE');
});

test('each spot fetches and blends its own models', async () => {
   const cfg = parseConfig(`
conditions: { minWindKn: 15, minDurationHours: 2, minTempC: 5 }
models: [[{ id: ecmwf_ifs }]]
spots:
  - { name: A, lat: 52, lon: 4, directions: [E] } # never qualifies, so B gets the event
  - { name: B, lat: 36, lon: -5, directions: [W], models: [[{ id: gfs_global, name: GFS }]] }
`);
   const requested: Record<string, string | null> = {};
   const fetchImpl = (async (url: string) => {
      const u = new URL(url);
      requested[u.searchParams.get('latitude')!] = u.searchParams.get('models');
      return Response.json(body());
   }) as unknown as typeof fetch;
   const feed = new Feed(cfg, { ...base, fetchImpl });
   await feed.refresh();
   expect(requested).toEqual({ '52': 'ecmwf_ifs', '36': 'gfs_global' });
   const ics = feed.ics.replace(/\r\n /g, '');
   expect(ics).toContain('Models: GFS\\n');
   expect(ics).not.toContain('ecmwf_ifs');
});
