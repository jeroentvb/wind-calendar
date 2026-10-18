import { expect, test } from 'bun:test';
import { buildUrl, fetchForecast, parseResponse, parseRunResponse } from '../src/openmeteo.ts';
import multi from './fixtures/openmeteo-multi.json';
import single from './fixtures/openmeteo-single.json';

const MULTI = ['knmi_harmonie_arome_netherlands', 'meteofrance_arome_france_hd', 'ecmwf_ifs025'];

test('buildUrl requests knots, unix time and all models', () => {
   const url = new URL(buildUrl({ lat: 52.1, lon: 4.27 }, MULTI, 8));
   expect(url.searchParams.get('wind_speed_unit')).toBe('kn');
   expect(url.searchParams.get('timeformat')).toBe('unixtime');
   expect(url.searchParams.get('models')).toBe(MULTI.join(','));
   expect(url.searchParams.get('forecast_days')).toBe('8');
});

test('buildUrl prefers sea grid cells, since spots sit on the water', () => {
   const url = new URL(buildUrl({ lat: 52.1, lon: 4.27 }, MULTI, 8));
   expect(url.searchParams.get('cell_selection')).toBe('sea');
});

test('parses suffixed multi-model responses', () => {
   const fc = parseResponse(multi, MULTI);
   expect(fc.times).toHaveLength(96);
   for (const id of MULTI) expect(fc.models[id]!.wind.filter((v) => v !== null).length).toBeGreaterThan(0);
   // HARM-NL has no CAPE
   expect(fc.models.knmi_harmonie_arome_netherlands!.cape.every((v) => v === null)).toBe(true);
   // high-res models end before ECMWF
   const lastNonNull = (s: (number | null)[]) => s.findLastIndex((v) => v !== null);
   expect(lastNonNull(fc.models.meteofrance_arome_france_hd!.wind)).toBeLessThan(
      lastNonNull(fc.models.ecmwf_ifs025!.wind),
   );
   expect(fc.sun).toHaveLength(4);
   expect(fc.sun[0]!.sunrise).toBeLessThan(fc.sun[0]!.sunset);
});

test('parses unsuffixed single-model responses', () => {
   const fc = parseResponse(single, ['ecmwf_ifs025']);
   expect(fc.models.ecmwf_ifs025!.wind.every((v) => typeof v === 'number')).toBe(true);
   expect(fc.sun).toHaveLength(2);
});

test('throws on Open-Meteo error bodies', () => {
   expect(() => parseResponse({ error: true, reason: 'bad model' }, ['x'])).toThrow('bad model');
   expect(() => parseResponse({}, ['x'])).toThrow();
});

test('fetchForecast surfaces HTTP errors', async () => {
   const fake = (async () =>
      new Response(JSON.stringify({ error: true, reason: 'nope' }), { status: 400 })) as unknown as typeof fetch;
   await expect(fetchForecast({ lat: 1, lon: 1 }, ['x'], 2, fake)).rejects.toThrow('HTTP 400: nope');
});

test('hours where a model gust drops below its mean wind are dropped as broken data', () => {
   const hourly = {
      time: [0, 3600, 7200, 10800],
      wind_speed_10m: [23.6, 14.3, 20, 18],
      wind_gusts_10m: [10.5, 14, 20, null],
      wind_direction_10m: [300, 300, 300, 300],
      temperature_2m: [12, 12, 12, 12],
      weather_code: [3, 3, 3, 3],
      cape: [0, 0, 0, 0],
   };
   const fc = parseResponse({ hourly, daily: { time: [0], sunrise: [0], sunset: [36000] } }, ['gfs_global']);
   expect(fc.models.gfs_global!.wind).toEqual([null, null, 20, 18]);
   expect(fc.models.gfs_global!.gust).toEqual([null, null, 20, null]);
   // The single-runs API is parsed the same way.
   expect(parseRunResponse({ hourly }, 1)[0]!.series.wind).toEqual([null, null, 20, 18]);
});
