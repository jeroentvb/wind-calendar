import type { SpotForecast } from './openmeteo.ts';
import type { Hour } from './types.ts';

export interface ModelRef {
   id: string;
   weight: number;
   /** Display name for event descriptions; defaults to the id. */
   name?: string;
}
export type Tier = readonly ModelRef[];

const THUNDER_CODES = new Set([95, 96, 99]);
const THUNDER_CAPE = 800; // J/kg

export function allModelIds(tiers: readonly Tier[]): string[] {
   return [...new Set(tiers.flat().map((m) => m.id))];
}

/**
 * One blended hour per forecast timestamp. Each hour uses the first tier that has data for it
 * (weighted mean; direction as a vector mean). Thunder is flagged when any model of that same
 * tier reports it, so lower tiers never influence hours a higher tier covers.
 */
export function blend(fc: SpotForecast, tiers: readonly Tier[]): Hour[] {
   const out: Hour[] = [];

   fc.times.forEach((time, i) => {
      for (const tier of tiers) {
         const members = tier.flatMap((ref) => {
            const s = fc.models[ref.id];
            if (!s) return [];
            const wind = s.wind[i],
               gust = s.gust[i],
               dir = s.dir[i],
               temp = s.temp[i];
            if (wind == null || gust == null || dir == null || temp == null) return [];
            return [{ label: ref.name ?? ref.id, weight: ref.weight, wind, gust, dir, temp }];
         });
         if (members.length === 0) continue;

         const total = members.reduce((a, m) => a + m.weight, 0);
         const mean = (f: (m: (typeof members)[number]) => number) =>
            members.reduce((a, m) => a + m.weight * f(m), 0) / total;
         const rad = Math.PI / 180;
         const x = mean((m) => Math.cos(m.dir * rad));
         const y = mean((m) => Math.sin(m.dir * rad));
         const dir = (Math.atan2(y, x) / rad + 360) % 360;

         const thunder = tier.some(({ id }) => {
            const s = fc.models[id];
            const code = s?.weatherCode[i];
            const cape = s?.cape[i];
            return (code != null && THUNDER_CODES.has(code)) || (cape != null && cape >= THUNDER_CAPE);
         });

         out.push({
            time,
            wind: mean((m) => m.wind),
            gust: mean((m) => m.gust),
            dir,
            temp: mean((m) => m.temp),
            thunder,
            models: members.map((m) => m.label),
         });
         return;
      }
   });

   return out;
}
