import { describe, expect, test } from 'bun:test';
import { eventDescription, eventTitle } from '../src/describe.ts';
import { candidatesForSpot, modalSector, selectEvents } from '../src/select.ts';
import { allDay, H, hours, spot, T0 } from './helpers.ts';

describe('candidatesForSpot', () => {
   test('one candidate per qualifying window with peak stats', () => {
      const cs = candidatesForSpot(spot('A', 1), hours([22, 26, 26, 26, 23, 23, 5, 18, 18]), allDay);
      expect(cs).toHaveLength(2);
      expect(cs[0]!.peakStart).toBe(T0 + H);
      expect(cs[0]!.peakEnd).toBe(T0 + 4 * H);
      expect(cs[0]!.windowEnd).toBe(T0 + 6 * H);
      expect(cs[0]!.avgWind).toBe(26);
      expect(cs[0]!.avgGust).toBe(34);
   });
});

test('modalSector picks most common, first on ties', () => {
   expect(modalSector(hours([1, 1, 1], T0, (i) => ({ dir: [270, 225, 225][i] })))).toBe('SW');
   expect(modalSector(hours([1, 1], T0, (i) => ({ dir: [270, 225][i] })))).toBe('W');
});

describe('selectEvents', () => {
   test('higher weight wins an overlap even with weaker wind; loser listed as also good', () => {
      const heavy = candidatesForSpot(spot('Heavy', 10), hours([18, 18, 18]), allDay);
      const light = candidatesForSpot(spot('Light', 1), hours([30, 30, 30]), allDay);
      const events = selectEvents([...light, ...heavy]);
      expect(events).toHaveLength(1);
      expect(events[0]!.spot.name).toBe('Heavy');
      expect(events[0]!.alsoGood.map((c) => c.spot.name)).toEqual(['Light']);
   });

   test('equal weights: stronger wind wins', () => {
      const a = candidatesForSpot(spot('A', 5), hours([18, 18, 18]), allDay);
      const b = candidatesForSpot(spot('B', 5), hours([25, 25, 25]), allDay);
      expect(selectEvents([...a, ...b]).map((e) => e.spot.name)).toEqual(['B']);
   });

   test('non-overlapping peak blocks both become events', () => {
      const a = candidatesForSpot(spot('A', 5), hours([20, 20, 0, 0, 0]), allDay);
      const b = candidatesForSpot(spot('B', 1), hours([0, 0, 0, 20, 20]), allDay);
      const events = selectEvents([...a, ...b]);
      expect(events.map((e) => e.spot.name)).toEqual(['A', 'B']);
      expect(events[0]!.alsoGood).toEqual([]);
   });

   test('multiple windows per day for one spot', () => {
      const a = candidatesForSpot(spot('A', 5), hours([20, 20, 0, 20, 20]), allDay);
      expect(selectEvents(a)).toHaveLength(2);
   });
});

describe('text', () => {
   const [a] = candidatesForSpot(spot('Scheveningen', 10), hours([22, 26, 26, 26, 23, 23]), allDay);
   const [b] = candidatesForSpot(spot('Brouwersdam', 1), hours([20, 21, 22]), allDay);
   const [event] = selectEvents([a!, b!]);

   test('title', () => {
      expect(eventTitle(a!)).toBe('🏄 Scheveningen 26-34kn W');
   });

   test('description lists every window hour, marks peak and also-good spots', () => {
      const d = eventDescription(event!, 'Europe/Amsterdam', T0);
      const rows = d.split('\n').filter((l) => /\d\d:\d\d  /.test(l));
      expect(rows).toHaveLength(6);
      expect(rows.filter((r) => r.startsWith('▶')).map((r) => r.slice(2, 7))).toEqual(['11:00', '12:00', '13:00']);
      expect(d).toContain('Peak 11:00–14:00');
      expect(d).toContain('• Brouwersdam 10:00–13:00 21-29kn W');
      expect(d).toContain('Forecast updated');
      expect(d).toContain('Models: test_model');
      expect(d.split('\n').at(-1)).toBe('Weather data by Open-Meteo.com (CC BY 4.0)');
      expect(d).not.toMatch(/<[a-z]/i);
   });

   test('models line lists every model used in the window', () => {
      const member = (name: string) => ({ name, weight: 1, wind: 20, dir: 270, thunder: false });
      const hs = hours([20, 20, 20], T0, (i) => ({
         members: i < 2 ? [member('icon_d2'), member('harmonie')] : [member('ecmwf_ifs')],
      }));
      const [e] = selectEvents(candidatesForSpot(spot('A', 1), hs, allDay));
      expect(eventDescription(e!, 'UTC')).toContain('Models: icon_d2, harmonie, ecmwf_ifs');
   });
});

describe('model disagreement and possible thunder', () => {
   type M = { name: string; weight: number; wind: number; dir: number; thunder?: boolean };
   // The middle hour gets the given members; the blended wind/dir are 20 kn W.
   const withMiddle = (ms: M[]) =>
      hours([20, 20, 20], T0, (i) => (i === 1 ? { members: ms.map((m) => ({ thunder: false, ...m })) } : {}));
   const describeOne = (s: ReturnType<typeof spot>, ms: M[]) => {
      const [c] = candidatesForSpot(s, withMiddle(ms), allDay);
      return { c: c!, d: eventDescription({ ...c!, alsoGood: [] }, 'UTC') };
   };
   const a = spot('A', 1);

   test('flags direction disagreement and lists each weighty model', () => {
      const { c, d } = describeOne(a, [
         { name: 'HARM-NL', weight: 1, wind: 20, dir: 220 },
         { name: 'ICON', weight: 1, wind: 20, dir: 320 },
         { name: 'GFS', weight: 0.01, wind: 20, dir: 90 },
      ]);
      expect(c.directionSplit.map((h) => h.time)).toEqual([T0 + H]);
      expect(d).toContain('⚠️ Models disagree on wind direction\n09:00 HARM-NL SW, ICON NW\n');
   });

   test('a low-weight outlier does not count as disagreement', () => {
      const { c } = describeOne(a, [
         { name: 'HARM-NL', weight: 100, wind: 20, dir: 270 },
         { name: 'GFS', weight: 1, wind: 40, dir: 90 },
      ]);
      expect(c.directionSplit).toEqual([]);
      expect(c.windSplit).toEqual([]);
   });

   test('flags wind speed disagreement with each model speed', () => {
      const { c, d } = describeOne(a, [
         { name: 'ICON', weight: 1, wind: 22, dir: 270 },
         { name: 'ECMWF', weight: 1, wind: 16, dir: 270 },
         { name: 'GFS', weight: 1, wind: 32, dir: 270 },
      ]);
      expect(c.windSplit.map((h) => h.time)).toEqual([T0 + H]);
      expect(d).toContain('⚠️ Models disagree on wind speed\n09:00 ICON 22, ECMWF 16, GFS 32\n');
   });

   test('tolerances come from the spot conditions', () => {
      const loose = spot('A', 1, { conditions: { ...a.conditions, windSpreadKn: 10 } });
      const { c } = describeOne(loose, [
         { name: 'ICON', weight: 1, wind: 22, dir: 270 },
         { name: 'ECMWF', weight: 1, wind: 16, dir: 270 },
         { name: 'GFS', weight: 1, wind: 32, dir: 270 },
      ]);
      expect(c.windSplit).toEqual([]);
   });

   test('names the models that report thunder when too few to rule the hour out', () => {
      const { c, d } = describeOne(a, [
         { name: 'HARM-NL', weight: 100, wind: 20, dir: 270 },
         { name: 'GFS', weight: 1, wind: 20, dir: 270, thunder: true },
      ]);
      expect(c.possibleThunder.map((h) => h.time)).toEqual([T0 + H]);
      expect(d).toContain('⛈️ Possible thunder\n09:00 GFS\n');
   });

   test('agreeing models give no warnings', () => {
      const { d } = describeOne(a, [
         { name: 'HARM-NL', weight: 1, wind: 21, dir: 265 },
         { name: 'ICON', weight: 1, wind: 19, dir: 275 },
      ]);
      expect(d).not.toContain('⚠️');
      expect(d).not.toContain('⛈️');
   });
});
