import { expect, test } from 'bun:test';
import { eventDescription, eventTitle } from '../src/describe.ts';
import { renderCalendar } from '../src/ics.ts';
import type { ModelSeries, SpotForecast } from '../src/openmeteo.ts';
import { outlookCandidates } from '../src/outlook.ts';
import { selectEvents } from '../src/select.ts';
import { allDay, H, spot, T0 } from './helpers.ts';

const N = 8;

function series(wind: (number | null)[], patch: Partial<ModelSeries> = {}): ModelSeries {
   return {
      wind,
      gust: wind.map((w) => (w == null ? null : w + 6)),
      dir: wind.map((w) => (w == null ? null : 270)),
      temp: wind.map((w) => (w == null ? null : 15)),
      weatherCode: new Array(N).fill(3),
      cape: new Array(N).fill(0),
      ...patch,
   };
}

function fc(models: Record<string, ModelSeries>): SpotForecast {
   return { fetchedAt: 0, times: Array.from({ length: N }, (_, i) => T0 + i * H), models, sun: allDay };
}

const s = spot('Scheveningen', 1, {
   models: [
      { id: 'ecmwf', weight: 1, name: 'ECMWF' },
      { id: 'gfs', weight: 1, name: 'GFS' },
      { id: 'icon', weight: 1, name: 'ICON' },
   ],
});
const calm = new Array(N).fill(8);
const none = new Array(N).fill(null);
const end = T0 + N * H;

test('one model is enough, even when the blend would not qualify', () => {
   // Blended, the windy hours average (20 + 8) / 2 = 14 kn, below minWindKn 15.
   const windy = [8, 20, 20, 20, 8, 8, 8, 8];
   const [c, ...rest] = outlookCandidates(
      s,
      fc({ ecmwf: series(calm), gfs: series(windy), icon: series(none) }),
      T0,
      end,
   );
   expect(rest).toHaveLength(0);
   expect(c!.windowStart).toBe(T0 + H);
   expect(c!.avgWind).toBe(20);
   expect(c!.outlook).toEqual({ models: ['GFS'], of: 2 });
   // A single model never disagrees with itself.
   expect([c!.directionSplit, c!.windSplit]).toEqual([[], []]);
});

test('overlapping windows from several models merge into the strongest one', () => {
   const ecmwf = [8, 18, 18, 18, 8, 8, 8, 8];
   const gfs = [8, 8, 22, 22, 22, 8, 8, 8];
   const icon = [8, 8, 8, 8, 8, 8, 25, 25];
   const cs = outlookCandidates(s, fc({ ecmwf: series(ecmwf), gfs: series(gfs), icon: series(icon) }), T0, end);
   expect(cs).toHaveLength(2);
   const merged = cs.find((c) => c.windowStart < T0 + 6 * H)!;
   expect(merged.avgWind).toBe(22);
   expect(merged.outlook).toEqual({ models: ['ECMWF', 'GFS'], of: 3 });
   expect(cs.find((c) => c !== merged)!.outlook).toEqual({ models: ['ICON'], of: 3 });
});

test('only hours in the outlook range count', () => {
   const windy = [20, 20, 20, 20, 8, 8, 8, 8];
   expect(outlookCandidates(s, fc({ ecmwf: series(windy) }), T0 + 3 * H, end)).toHaveLength(0);
});

test("thunder in one model does not block another model's window", () => {
   const windy = [8, 20, 20, 20, 8, 8, 8, 8];
   const thunder = { weatherCode: new Array(N).fill(95) };
   const cs = outlookCandidates(s, fc({ ecmwf: series(windy, thunder), gfs: series(windy) }), T0, end);
   expect(cs.map((c) => c.outlook)).toEqual([{ models: ['GFS'], of: 2 }]);
});

test('outlook events are marked uncertain', () => {
   const windy = [8, 20, 20, 20, 8, 8, 8, 8];
   const events = selectEvents(outlookCandidates(s, fc({ ecmwf: series(windy), gfs: series(calm) }), T0, end));
   expect(eventTitle(events[0]!)).toBe('🔮 Scheveningen 20-26kn W');
   expect(eventDescription(events[0]!, 'UTC').split('\n').slice(0, 2)).toEqual([
      '⚠️ Uncertain long-range forecast',
      'Seen in ECMWF (1 of 2 models). Check again closer to the day.',
   ]);
   expect(renderCalendar(events, { timezone: 'UTC', now: T0 })).toContain('STATUS:TENTATIVE\r\n');
});
