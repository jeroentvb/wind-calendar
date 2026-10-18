import type { SpotForecast } from './openmeteo.ts';
import type { Hour, Member } from './types.ts';

export interface ModelRef {
   id: string;
   weight: number;
   /** Display name for event descriptions; defaults to the id. */
   name?: string;
   /** Grid spacing; also decides whether the model counts as high-resolution. */
   resolutionKm?: number;
   /** Take this model's hours from its newest runs in the single-runs API (see runs.ts). */
   latestRuns?: boolean;
}

const THUNDER_CODES = new Set([95, 96, 99]);
const THUNDER_CAPE = 800; // J/kg
/** Share of an hour's weight that must report thunder to rule the hour out. */
const THUNDER_SHARE = 0.5;
/** Models this fine resolve convection (showers, sea breeze) themselves: the usual meteorological cut-off. */
export const HIGH_RES_KM = 4;

export function allModelIds(models: readonly ModelRef[]): string[] {
   return [...new Set(models.map((m) => m.id))];
}

/**
 * One blended hour per forecast timestamp: the weighted mean of every model with data for it
 * (direction as a vector mean). Thunder rules an hour out only when models holding at least half
 * of its weight report it; each member records its own thunder flag either way.
 */
export function blend(fc: SpotForecast, models: readonly ModelRef[]): Hour[] {
   const out: Hour[] = [];

   fc.times.forEach((time, i) => {
      const members = models.flatMap((ref) => {
         const s = fc.models[ref.id];
         if (!s) return [];
         const wind = s.wind[i],
            gust = s.gust[i],
            dir = s.dir[i],
            temp = s.temp[i];
         if (wind == null || gust == null || dir == null || temp == null) return [];
         const code = s.weatherCode[i];
         const cape = s.cape[i];
         const thunder = (code != null && THUNDER_CODES.has(code)) || (cape != null && cape >= THUNDER_CAPE);
         const highRes = ref.resolutionKm !== undefined && ref.resolutionKm <= HIGH_RES_KM;
         return [{ name: ref.name ?? ref.id, weight: ref.weight, wind, gust, dir, temp, thunder, highRes }];
      });
      if (members.length === 0) return;

      const total = members.reduce((a, m) => a + m.weight, 0);
      const mean = (f: (m: (typeof members)[number]) => number) =>
         members.reduce((a, m) => a + m.weight * f(m), 0) / total;
      const rad = Math.PI / 180;
      const x = mean((m) => Math.cos(m.dir * rad));
      const y = mean((m) => Math.sin(m.dir * rad));
      const dir = (Math.atan2(y, x) / rad + 360) % 360;

      out.push({
         time,
         wind: mean((m) => m.wind),
         gust: mean((m) => m.gust),
         dir,
         temp: mean((m) => m.temp),
         thunder: mean((m) => (m.thunder ? 1 : 0)) >= THUNDER_SHARE,
         members: members.map(({ name, weight, wind, dir, thunder, highRes }): Member => ({
            name,
            weight,
            wind,
            dir,
            thunder,
            highRes,
         })),
      });
   });

   return out;
}
