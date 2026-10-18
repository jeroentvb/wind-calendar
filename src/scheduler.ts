import { allModelIds, blend } from './blend.ts';
import type { Config, SpotConfig } from './config.ts';
import { renderCalendar } from './ics.ts';
import { fetchForecast, type SpotForecast } from './openmeteo.ts';
import { outlookCandidates } from './outlook.ts';
import { RunCache } from './runs.ts';
import { candidatesForSpot, selectEvents, type Candidate } from './select.ts';
import { loadState, saveState, type State } from './state.ts';

const HOUR = 3600;
const DAY = 86400;

export interface FeedOptions {
   statePath?: string;
   fetchImpl?: typeof fetch;
   now?: () => number;
   sleep?: (ms: number) => Promise<void>;
   log?: (msg: string) => void;
}

export function spotKey(spot: SpotConfig): string {
   return `${spot.lat},${spot.lon}|${allModelIds(spot.models).join(',')}`;
}

export class Feed {
   ics: string;
   private state: State = {};
   private refreshing: Promise<void> | null = null;
   private timer: ReturnType<typeof setInterval> | null = null;
   private readonly now: () => number;
   private readonly sleep: (ms: number) => Promise<void>;
   private readonly log: (msg: string) => void;
   private readonly runs: RunCache;

   constructor(
      private readonly config: Config,
      private readonly opts: FeedOptions = {},
   ) {
      this.now = opts.now ?? (() => Date.now() / 1000);
      this.sleep = opts.sleep ?? ((ms) => Bun.sleep(ms));
      this.log = opts.log ?? ((msg) => console.log(`${new Date().toISOString()} ${msg}`));
      this.runs = new RunCache({ fetchImpl: opts.fetchImpl, log: this.log });
      this.ics = this.render();
   }

   async init(): Promise<void> {
      if (!this.opts.statePath) return;
      this.state = await loadState(this.opts.statePath);
      const restored = this.config.spots.filter((s) => this.forecastFor(s)).length;
      this.log(`restored last-good forecast for ${restored}/${this.config.spots.length} spots`);
      this.ics = this.render();
   }

   /** Fetches every spot; a failed spot keeps its last successful forecast. */
   refresh(): Promise<void> {
      this.refreshing ??= this.doRefresh().finally(() => {
         this.refreshing = null;
      });
      return this.refreshing;
   }

   start(): void {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), this.config.fetchIntervalMinutes * 60_000);
   }

   stop(): void {
      if (this.timer) clearInterval(this.timer);
   }

   private async doRefresh(): Promise<void> {
      const days = Math.min(16, this.config.maxDaysAhead + this.config.outlookDays + 1);
      let changed = false;
      await this.runs.refresh(this.config.spots, this.now());
      for (const spot of this.config.spots) {
         try {
            const forecast = await this.withRetry(() =>
               fetchForecast(spot, allModelIds(spot.models), days, this.opts.fetchImpl),
            );
            this.state[spot.name] = { key: spotKey(spot), forecast: this.runs.apply(spot, forecast) };
            changed = true;
         } catch (err) {
            this.log(`fetch failed for ${spot.name}, keeping last-good data: ${(err as Error).message}`);
         }
      }
      this.ics = this.render();
      if (changed && this.opts.statePath) {
         try {
            await saveState(this.opts.statePath, this.state);
         } catch (err) {
            this.log(`could not persist state: ${(err as Error).message}`);
         }
      }
   }

   private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
      const delays = [2_000, 8_000];
      for (let attempt = 0; ; attempt++) {
         try {
            return await fn();
         } catch (err) {
            if (attempt >= delays.length) throw err;
            await this.sleep(delays[attempt]!);
         }
      }
   }

   private forecastFor(spot: SpotConfig): SpotForecast | undefined {
      const stored = this.state[spot.name];
      return stored && stored.key === spotKey(spot) ? stored.forecast : undefined;
   }

   render(): string {
      const now = this.now();
      const cutoff = now + this.config.maxDaysAhead * DAY;
      const outlookEnd = cutoff + this.config.outlookDays * DAY;
      const candidates: Candidate[] = [];
      const outlook: Candidate[] = [];
      const updatedAt: Record<string, number> = {};
      for (const spot of this.config.spots) {
         const fc = this.forecastFor(spot);
         if (!fc) continue;
         updatedAt[spot.name] = Math.floor(fc.fetchedAt / 1000);
         const hours = blend(fc, spot.models).filter((h) => h.time + HOUR <= cutoff);
         candidates.push(...candidatesForSpot(spot, hours, fc.sun));
         outlook.push(...outlookCandidates(spot, fc, cutoff, outlookEnd));
      }
      // Selected separately so "Also good" on an outlook event only lists other outlook spots.
      const events = [...selectEvents(candidates), ...selectEvents(outlook)];
      return renderCalendar(events, { timezone: this.config.timezone, now, updatedAt });
   }
}
