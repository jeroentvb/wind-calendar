import type { SpotConfig } from './config.ts';
import {
   buildRunUrl,
   parseRunResponse,
   type Location,
   type ModelSeries,
   type RunSeries,
   type SpotForecast,
} from './openmeteo.ts';

const HOUR = 3600;
/** How far back the first refresh looks for runs, and how long fetched runs are kept. */
const KEEP = 24 * HOUR;
/** Later refreshes try every unknown hour this recent again: runs are published hours after they start. */
const RETRY = 12 * HOUR;

interface Run {
   /** Start (initialisation) time, epoch seconds. */
   init: number;
   /** Per location key; each with a lookup from timestamp to index. */
   byLocation: Map<string, RunSeries & { index: Map<number, number> }>;
}

export interface RunCacheOptions {
   fetchImpl?: typeof fetch;
   log?: (msg: string) => void;
}

const locationKey = (l: Location) => `${l.lat},${l.lon}`;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16) + 'Z';

/**
 * Open-Meteo's forecast API does not always serve a model's newest run (ICON-EU falls back to the
 * 00/12 UTC run beyond the 30 h of its 03/09/15/21 UTC runs). For models with `latestRuns`, this finds
 * runs in the single-runs API by trying every hour (missing runs return 400, so no model's schedule
 * needs to be known), fetches each run once for all spots, and lets the newest run win per hour.
 */
export class RunCache {
   /** Per model id, newest first. */
   private runs = new Map<string, Run[]>();
   /** Models whose first, 24 h look-back has completed. */
   private lookedBack = new Set<string>();
   private readonly fetchImpl: typeof fetch;
   private readonly log: (msg: string) => void;

   constructor(opts: RunCacheOptions = {}) {
      this.fetchImpl = opts.fetchImpl ?? fetch;
      this.log = opts.log ?? (() => {});
   }

   /** Finds and fetches new runs. Failures are logged and leave the known runs in place. */
   async refresh(spots: readonly SpotConfig[], now: number): Promise<void> {
      const locationsByModel = new Map<string, Location[]>();
      for (const spot of spots) {
         for (const ref of spot.models) {
            if (!ref.latestRuns) continue;
            const locs = locationsByModel.get(ref.id) ?? [];
            if (!locs.some((l) => locationKey(l) === locationKey(spot))) locs.push({ lat: spot.lat, lon: spot.lon });
            locationsByModel.set(ref.id, locs);
         }
      }
      for (const [id, locs] of locationsByModel) {
         try {
            await this.refreshModel(id, locs, now);
         } catch (err) {
            this.log(`newest runs for ${id} unavailable, keeping what is known: ${(err as Error).message}`);
         }
      }
   }

   private async refreshModel(id: string, locs: Location[], now: number): Promise<void> {
      const runs = (this.runs.get(id) ?? []).filter((r, i) => i === 0 || r.init >= now - KEEP);
      this.runs.set(id, runs);
      const latest = Math.floor(now / HOUR) * HOUR;
      const from = latest - (this.lookedBack.has(id) ? RETRY : KEEP);
      for (let init = latest; init >= from; init -= HOUR) {
         if (runs.some((r) => r.init === init)) continue;
         if (!(await this.exists(id, locs[0]!, init))) continue;
         const parsed = parseRunResponse(await this.get(buildRunUrl(locs, id, init)), locs.length);
         const byLocation = new Map(
            parsed.map((p, i) => [locationKey(locs[i]!), { ...p, index: new Map(p.times.map((t, j) => [t, j])) }]),
         );
         runs.push({ init, byLocation });
         runs.sort((a, b) => b.init - a.init);
         this.log(`fetched ${id} run ${iso(init)}`);
      }
      this.lookedBack.add(id);
   }

   private async exists(id: string, loc: Location, init: number): Promise<boolean> {
      const res = await this.fetchImpl(buildRunUrl([loc], id, init, true), { signal: AbortSignal.timeout(20_000) });
      await res.body?.cancel();
      if (res.status === 400) return false;
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      return true;
   }

   private async get(url: string): Promise<unknown> {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      return res.json();
   }

   /**
    * The spot's forecast with every `latestRuns` model's hours taken from the newest known run that
    * covers them; hours no run covers keep the forecast API's values.
    */
   apply(spot: SpotConfig, fc: SpotForecast): SpotForecast {
      const key = locationKey(spot);
      const models = { ...fc.models };
      for (const ref of spot.models) {
         const runs = ref.latestRuns ? this.runs.get(ref.id) : undefined;
         const base = fc.models[ref.id];
         if (!runs?.length || !base) continue;
         const merged = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, [...v]])) as unknown as ModelSeries;
         fc.times.forEach((t, i) => {
            for (const run of runs) {
               const r = run.byLocation.get(key);
               const j = r?.index.get(t);
               if (r === undefined || j === undefined || r.series.wind[j] == null) continue;
               for (const k of Object.keys(merged) as (keyof ModelSeries)[]) merged[k][i] = r.series[k][j] ?? null;
               return;
            }
         });
         models[ref.id] = merged;
      }
      return { ...fc, models };
   }
}
