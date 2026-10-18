import { expect, test } from 'bun:test';
import type { SpotConfig } from '../src/config.ts';
import { parseRunResponse, type ModelSeries, type SpotForecast } from '../src/openmeteo.ts';
import { RunCache } from '../src/runs.ts';
import { spot } from './helpers.ts';

const H = 3600;
const NOW = Date.UTC(2026, 9, 18, 12, 20) / 1000;
const at = (hour: number) => Date.UTC(2026, 9, 18, hour) / 1000;

test('parses a recorded multi-location single-runs response', async () => {
   const json = await Bun.file(new URL('fixtures/openmeteo-run-multi.json', import.meta.url)).json();
   const [a, b] = parseRunResponse(json, 2);
   expect(a!.times[0]).toBe(at(6));
   const wed = a!.times.indexOf(Date.UTC(2026, 9, 21, 5) / 1000);
   expect(a!.series.wind[wed]).toBe(16.4);
   expect(a!.series.dir[wed]).not.toBeNull();
   expect(b!.series.wind.length).toBe(b!.times.length);
   expect(() => parseRunResponse(json, 3)).toThrow(/3/);
});

/** A run as the single-runs API returns it: `hours` hourly values from its start, wind = `wind`. */
function runBody(init: number, hours: number, wind: number, locations: number) {
   const times = Array.from({ length: hours + 1 }, (_, i) => init + i * H);
   const one = {
      hourly: {
         time: times,
         wind_speed_10m: times.map(() => wind),
         wind_gusts_10m: times.map(() => wind + 5),
         wind_direction_10m: times.map(() => 200),
         temperature_2m: times.map(() => 12),
         weather_code: times.map(() => 3),
         cape: times.map(() => 0),
      },
   };
   return locations === 1 ? one : Array.from({ length: locations }, () => one);
}

/**
 * Fake single-runs API. `runs` maps a run start to [horizon in hours, wind]; other runs answer 400.
 * Records every request as `probe|full run-hour`.
 */
function api(runs: Record<number, [number, number]>, calls: string[] = []) {
   const fetchImpl = (async (input: string) => {
      const u = new URL(input);
      const init = Date.parse(u.searchParams.get('run')! + 'Z') / 1000;
      const probe = u.searchParams.get('forecast_days') === '1';
      calls.push(`${probe ? 'probe' : 'full'} ${new Date(init * 1000).getUTCHours()}`);
      const run = runs[init];
      if (!run) return Response.json({ error: true, reason: 'not available' }, { status: 400 });
      return Response.json(runBody(init, run[0], run[1], u.searchParams.get('latitude')!.split(',').length));
   }) as unknown as typeof fetch;
   return { fetchImpl, calls };
}

const iconEu = spot('A', 1, { models: [{ id: 'icon_eu', weight: 10, latestRuns: true }] });

/** Forecast API data: icon_eu at 10 kn for 6 days from 12:00 UTC. */
function forecast(s: SpotConfig = iconEu): SpotForecast {
   const times = Array.from({ length: 6 * 24 }, (_, i) => at(12) + i * H);
   const series = (v: number): ModelSeries => ({
      wind: times.map(() => v),
      gust: times.map(() => v + 5),
      dir: times.map(() => 270),
      temp: times.map(() => 12),
      weatherCode: times.map(() => 3),
      cape: times.map(() => 0),
   });
   return { fetchedAt: 0, times, models: Object.fromEntries(s.models.map((m) => [m.id, series(10)])), sun: [] };
}
const windAt = (fc: SpotForecast, t: number) => fc.models.icon_eu!.wind[fc.times.indexOf(t)];

test('the newest run that covers an hour wins; the forecast API fills the rest', async () => {
   // 09Z reaches 30 h, 06Z 120 h, 00Z 120 h; the forecast API (10 kn) only covers what no run does.
   const { fetchImpl } = api({ [at(9)]: [30, 25], [at(6)]: [120, 20], [at(0)]: [120, 15] });
   const cache = new RunCache({ fetchImpl });
   await cache.refresh([iconEu], NOW);
   const fc = cache.apply(iconEu, forecast());
   expect(windAt(fc, at(9) + 30 * H)).toBe(25);
   expect(windAt(fc, at(9) + 31 * H)).toBe(20);
   expect(windAt(fc, at(6) + 120 * H)).toBe(20);
   expect(windAt(fc, at(6) + 121 * H)).toBe(10);
   expect(fc.models.icon_eu!.gust[fc.times.indexOf(at(20))]).toBe(30);
   expect(fc.models.icon_eu!.dir[fc.times.indexOf(at(20))]).toBe(200);
});

test('models without latestRuns are left alone and never requested', async () => {
   const { fetchImpl, calls } = api({ [at(6)]: [120, 20] });
   const s = spot('A', 1, { models: [{ id: 'icon_eu', weight: 10 }] });
   const cache = new RunCache({ fetchImpl });
   await cache.refresh([s], NOW);
   expect(calls).toEqual([]);
   expect(windAt(cache.apply(s, forecast(s)), at(20))).toBe(10);
});

test('first refresh looks back 24 h; later ones only retry recent unknown hours and fetch each run once', async () => {
   const runs: Record<number, [number, number]> = { [at(6)]: [120, 20] };
   const { fetchImpl, calls } = api(runs);
   const cache = new RunCache({ fetchImpl });
   await cache.refresh([iconEu], NOW);
   expect(calls.filter((c) => c.startsWith('probe'))).toHaveLength(25);
   expect(calls.filter((c) => c.startsWith('full'))).toEqual(['full 6']);

   calls.length = 0;
   runs[at(12)] = [120, 22];
   await cache.refresh([iconEu], NOW + H);
   expect(calls.filter((c) => c.startsWith('full'))).toEqual(['full 12']);
   // 13 hours from 13Z back to 01Z, minus the known 06Z run.
   expect(calls.filter((c) => c.startsWith('probe'))).toHaveLength(12);
   expect(windAt(cache.apply(iconEu, forecast()), at(20))).toBe(22);
});

test('one request per run covers every spot using the model', async () => {
   const { fetchImpl, calls } = api({ [at(6)]: [120, 20] });
   const b = { ...iconEu, name: 'B', lat: 53 };
   const cache = new RunCache({ fetchImpl });
   await cache.refresh([iconEu, b], NOW);
   expect(calls.filter((c) => c.startsWith('full'))).toHaveLength(1);
   expect(windAt(cache.apply(b, forecast(b)), at(20))).toBe(20);
});

test('runs older than 24 h are dropped, except the newest', async () => {
   const { fetchImpl } = api({ [at(0)]: [120, 15], [at(6)]: [120, 20] });
   const cache = new RunCache({ fetchImpl });
   await cache.refresh([iconEu], NOW);
   await cache.refresh([iconEu], at(6) + 25 * H);
   const fc = cache.apply(iconEu, forecast());
   // 00Z is gone, so 06Z wins even where both covered.
   expect(windAt(fc, at(20))).toBe(20);
   await cache.refresh([iconEu], at(6) + 48 * H);
   expect(windAt(cache.apply(iconEu, forecast()), at(20))).toBe(20);
});

test('API failures keep the known runs and are logged', async () => {
   const good = api({ [at(6)]: [120, 20] });
   const logs: string[] = [];
   let fail = false;
   const fetchImpl = (async (input: string) =>
      fail ? new Response('busy', { status: 429 }) : good.fetchImpl(input)) as unknown as typeof fetch;
   const cache = new RunCache({ fetchImpl, log: (m) => logs.push(m) });
   await cache.refresh([iconEu], NOW);
   fail = true;
   await cache.refresh([iconEu], NOW + H);
   expect(logs.at(-1)).toMatch(/icon_eu.*HTTP 429/);
   expect(windAt(cache.apply(iconEu, forecast()), at(20))).toBe(20);
});

test('without any known run the forecast is returned unchanged', () => {
   const fc = forecast();
   expect(new RunCache().apply(iconEu, fc).models).toEqual(fc.models);
});
