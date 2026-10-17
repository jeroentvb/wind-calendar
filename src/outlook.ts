import { blend, type ModelRef } from './blend.ts';
import type { SpotConfig } from './config.ts';
import type { SpotForecast } from './openmeteo.ts';
import { candidatesForSpot, type Candidate } from './select.ts';

const HOUR = 3600;

/**
 * Candidates for the outlook range [from, to): every model is checked on its own, so one model is
 * enough. Overlapping windows from several models merge into the strongest one, which lists them all.
 */
export function outlookCandidates(spot: SpotConfig, fc: SpotForecast, from: number, to: number): Candidate[] {
   const refs = new Map<string, ModelRef>();
   for (const ref of spot.models.flat()) if (!refs.has(ref.id)) refs.set(ref.id, ref);

   let of = 0;
   const found: { label: string; order: number; candidate: Candidate }[] = [];
   [...refs.values()].forEach((ref, order) => {
      const hours = blend(fc, [[ref]]).filter((h) => h.time >= from && h.time + HOUR <= to);
      if (hours.length === 0) return;
      of++;
      const label = ref.name ?? ref.id;
      for (const candidate of candidatesForSpot(spot, hours, fc.sun)) found.push({ label, order, candidate });
   });

   const merged: { candidate: Candidate; members: typeof found }[] = [];
   for (const f of found.sort((a, b) => b.candidate.avgWind - a.candidate.avgWind)) {
      const into = merged.find(
         (m) => f.candidate.windowStart < m.candidate.windowEnd && m.candidate.windowStart < f.candidate.windowEnd,
      );
      if (into) into.members.push(f);
      else merged.push({ candidate: f.candidate, members: [f] });
   }

   return merged.map(({ candidate, members }) => {
      const models = [...new Set(members.sort((a, b) => a.order - b.order).map((m) => m.label))];
      return { ...candidate, outlook: { models, of } };
   });
}
