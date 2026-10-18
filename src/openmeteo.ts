import type { SunDay } from './types.ts';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const RUNS_URL = 'https://single-runs-api.open-meteo.com/v1/forecast';
const HOURLY_VARS = [
   'wind_speed_10m',
   'wind_gusts_10m',
   'wind_direction_10m',
   'temperature_2m',
   'weather_code',
   'cape',
] as const;

type Series = (number | null)[];

export interface ModelSeries {
   wind: Series;
   gust: Series;
   dir: Series;
   temp: Series;
   weatherCode: Series;
   cape: Series;
}

export interface SpotForecast {
   fetchedAt: number;
   times: number[];
   models: Record<string, ModelSeries>;
   sun: SunDay[];
}

export interface Location {
   lat: number;
   lon: number;
}

export function buildUrl(loc: Location, modelIds: readonly string[], forecastDays: number): string {
   const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      hourly: HOURLY_VARS.join(','),
      daily: 'sunrise,sunset',
      wind_speed_unit: 'kn',
      timeformat: 'unixtime',
      timezone: 'auto',
      forecast_days: String(forecastDays),
      models: modelIds.join(','),
      // The default ('land') reads coastal spots from a land cell, where friction cuts the wind by several knots.
      cell_selection: 'sea',
   });
   return `${BASE_URL}?${params}`;
}

/**
 * Single-runs API: one model run (`run`, epoch seconds) for several locations at once; 16 days covers
 * every model's horizon. A probe asks for the least data possible, just to learn whether the run exists.
 */
export function buildRunUrl(locs: readonly Location[], modelId: string, run: number, probe = false): string {
   const params = new URLSearchParams({
      latitude: locs.map((l) => l.lat).join(','),
      longitude: locs.map((l) => l.lon).join(','),
      hourly: probe ? 'wind_speed_10m' : HOURLY_VARS.join(','),
      wind_speed_unit: 'kn',
      timeformat: 'unixtime',
      forecast_days: probe ? '1' : '16',
      models: modelId,
      run: new Date(run * 1000).toISOString().slice(0, 16),
      cell_selection: 'sea',
   });
   return `${RUNS_URL}?${params}`;
}

/**
 * Open-Meteo suffixes every variable with the model id when several models are requested,
 * but returns plain names when only one model is requested.
 */
function pick(block: Record<string, unknown>, name: string, model: string, single: boolean, length: number): Series {
   const raw = block[`${name}_${model}`] ?? (single ? block[name] : undefined);
   if (!Array.isArray(raw)) return new Array(length).fill(null);
   return raw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
}

function modelSeries(hourly: Record<string, unknown>, id: string, single: boolean, length: number): ModelSeries {
   const get = (name: string) => pick(hourly, name, id, single, length);
   return {
      wind: get('wind_speed_10m'),
      gust: get('wind_gusts_10m'),
      dir: get('wind_direction_10m'),
      temp: get('temperature_2m'),
      weatherCode: get('weather_code'),
      cape: get('cape'),
   };
}

export function parseResponse(json: unknown, modelIds: readonly string[], fetchedAt = Date.now()): SpotForecast {
   const data = json as {
      error?: boolean;
      reason?: string;
      hourly?: Record<string, unknown>;
      daily?: Record<string, unknown>;
   };
   if (data?.error) throw new Error(`Open-Meteo error: ${data.reason ?? 'unknown'}`);
   const hourly = data?.hourly;
   const daily = data?.daily;
   if (!hourly || !Array.isArray(hourly.time) || !daily || !Array.isArray(daily.time)) {
      throw new Error('Open-Meteo response is missing hourly or daily data');
   }

   const times = hourly.time as number[];
   const single = modelIds.length === 1;
   const models: Record<string, ModelSeries> = {};
   for (const id of modelIds) models[id] = modelSeries(hourly, id, single, times.length);

   // Sunrise/sunset differ by seconds between models; take the first model that has them.
   const dayCount = (daily.time as unknown[]).length;
   let sun: SunDay[] = [];
   for (const id of modelIds) {
      const rise = pick(daily, 'sunrise', id, single, dayCount);
      const set = pick(daily, 'sunset', id, single, dayCount);
      sun = rise.flatMap((r, i) => (r !== null && set[i] != null ? [{ sunrise: r, sunset: set[i]! }] : []));
      if (sun.length > 0) break;
   }
   if (sun.length === 0) throw new Error('Open-Meteo response has no sunrise/sunset data');

   return { fetchedAt, times, models, sun };
}

export async function fetchForecast(
   loc: Location,
   modelIds: readonly string[],
   forecastDays: number,
   fetchImpl: typeof fetch = fetch,
): Promise<SpotForecast> {
   const res = await fetchImpl(buildUrl(loc, modelIds, forecastDays), { signal: AbortSignal.timeout(20_000) });
   const body = await res.json().catch(() => null);
   if (!res.ok) {
      const reason = (body as { reason?: string } | null)?.reason;
      throw new Error(`Open-Meteo HTTP ${res.status}${reason ? `: ${reason}` : ''}`);
   }
   return parseResponse(body, modelIds);
}

export interface RunSeries {
   times: number[];
   series: ModelSeries;
}

/** Parses a single-runs response for one model; one entry per requested location, in request order. */
export function parseRunResponse(json: unknown, locationCount: number): RunSeries[] {
   const blocks = (Array.isArray(json) ? json : [json]) as { hourly?: Record<string, unknown> }[];
   if (blocks.length !== locationCount) {
      throw new Error(`Open-Meteo returned ${blocks.length} locations, expected ${locationCount}`);
   }
   return blocks.map((b) => {
      const hourly = b?.hourly;
      if (!hourly || !Array.isArray(hourly.time)) throw new Error('Open-Meteo run response is missing hourly data');
      const times = hourly.time as number[];
      // With a single model Open-Meteo returns plain variable names.
      return { times, series: modelSeries(hourly, '', true, times.length) };
   });
}
