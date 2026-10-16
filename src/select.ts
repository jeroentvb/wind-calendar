import type { SpotConfig } from './config.ts';
import { toSector } from './sectors.ts';
import type { Hour, Sector } from './types.ts';
import { peakBlock, qualifyingWindows } from './windows.ts';
import type { SunDay } from './types.ts';

const HOUR = 3600;

export interface Candidate {
   spot: SpotConfig;
   window: Hour[];
   peak: Hour[];
   /** Epoch seconds, end exclusive. */
   peakStart: number;
   peakEnd: number;
   windowStart: number;
   windowEnd: number;
   avgWind: number;
   avgGust: number;
   sector: Sector;
}

export interface CalendarEvent extends Candidate {
   alsoGood: Candidate[];
}

/** Most common sector; ties go to the sector that occurs first. */
export function modalSector(hours: readonly Hour[]): Sector {
   const counts = new Map<Sector, number>();
   for (const h of hours) {
      const s = toSector(h.dir);
      counts.set(s, (counts.get(s) ?? 0) + 1);
   }
   let best: Sector | null = null;
   for (const [s, n] of counts) if (best === null || n > counts.get(best)!) best = s;
   return best!;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function candidatesForSpot(spot: SpotConfig, hours: readonly Hour[], sun: readonly SunDay[]): Candidate[] {
   return qualifyingWindows(hours, spot, sun).map((window) => {
      const block = peakBlock(window, spot.conditions);
      const peak = window.slice(block.start, block.end);
      return {
         spot,
         window,
         peak,
         peakStart: peak[0]!.time,
         peakEnd: peak[peak.length - 1]!.time + HOUR,
         windowStart: window[0]!.time,
         windowEnd: window[window.length - 1]!.time + HOUR,
         avgWind: avg(peak.map((h) => h.wind)),
         avgGust: avg(peak.map((h) => h.gust)),
         sector: modalSector(peak),
      };
   });
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/**
 * Picks one event per peak-block slot: the highest spot weight wins, stronger wind only breaks
 * ties between equal weights. Other spots that are good during a winner's window are listed on it.
 */
export function selectEvents(candidates: readonly Candidate[]): CalendarEvent[] {
   const ranked = [...candidates].sort(
      (a, b) => b.spot.weight - a.spot.weight || b.avgWind - a.avgWind || a.peakStart - b.peakStart,
   );
   const accepted: CalendarEvent[] = [];
   for (const c of ranked) {
      const clash = accepted.some((a) => overlaps(a.peakStart, a.peakEnd, c.peakStart, c.peakEnd));
      if (!clash) accepted.push({ ...c, alsoGood: [] });
   }
   for (const event of accepted) {
      event.alsoGood = ranked.filter(
         (c) =>
            c.spot.name !== event.spot.name && overlaps(event.windowStart, event.windowEnd, c.windowStart, c.windowEnd),
      );
   }
   return accepted.sort((a, b) => a.peakStart - b.peakStart);
}
