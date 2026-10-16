import { toSector } from './sectors.ts';
import type { Conditions, Hour, SpotRules, SunDay } from './types.ts';

const HOUR = 3600;

export function isDaylight(time: number, sun: readonly SunDay[]): boolean {
   return sun.some((d) => time >= d.sunrise && time + HOUR <= d.sunset);
}

function hourQualifies(h: Hour, rules: SpotRules, sun: readonly SunDay[]): boolean {
   const c = rules.conditions;
   return (
      !h.thunder &&
      h.wind >= c.minWindKn &&
      (c.maxWindKn === null || h.wind <= c.maxWindKn) &&
      h.temp >= c.minTempC &&
      rules.directions.includes(toSector(h.dir)) &&
      isDaylight(h.time, sun)
   );
}

/** Runs of consecutive qualifying hours that last at least the minimum duration. */
export function qualifyingWindows(hours: readonly Hour[], rules: SpotRules, sun: readonly SunDay[]): Hour[][] {
   const windows: Hour[][] = [];
   let current: Hour[] = [];
   const flush = () => {
      if (current.length >= rules.conditions.minDurationHours) windows.push(current);
      current = [];
   };
   for (const h of hours) {
      const last = current[current.length - 1];
      if (last && h.time - last.time !== HOUR) flush();
      if (hourQualifies(h, rules, sun)) current.push(h);
      else flush();
   }
   flush();
   return windows;
}

/** Block of hours around the peak; `end` is exclusive. */
export interface Block {
   start: number;
   end: number;
}

export function peakBlock(window: readonly Hour[], cond: Conditions): Block {
   const winds = window.map((h) => h.wind);
   const peak = Math.max(...winds);
   let best: { block: Block; avg: number } | null = null;

   winds.forEach((w, i) => {
      if (w !== peak) return;
      let lo = i;
      let hi = i;
      while (lo > 0 && peak - winds[lo - 1]! < cond.peakToleranceKn) lo--;
      while (hi < winds.length - 1 && peak - winds[hi + 1]! < cond.peakToleranceKn) hi++;
      while (hi - lo + 1 < cond.minDurationHours) {
         const left = lo > 0 ? winds[lo - 1]! : -Infinity;
         const right = hi < winds.length - 1 ? winds[hi + 1]! : -Infinity;
         if (left === -Infinity && right === -Infinity) break;
         if (left >= right) lo--;
         else hi++;
      }
      const avg = winds.slice(lo, hi + 1).reduce((a, b) => a + b, 0) / (hi - lo + 1);
      if (!best || avg > best.avg) best = { block: { start: lo, end: hi + 1 }, avg };
   });

   return best!.block;
}
