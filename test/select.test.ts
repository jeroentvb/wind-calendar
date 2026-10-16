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

   test('models line lists every model used in the window, across tiers', () => {
      const hs = hours([20, 20, 20], T0, (i) => ({ models: i < 2 ? ['icon_d2', 'harmonie'] : ['ecmwf_ifs'] }));
      const [e] = selectEvents(candidatesForSpot(spot('A', 1), hs, allDay));
      expect(eventDescription(e!, 'UTC')).toContain('Models: icon_d2, harmonie, ecmwf_ifs');
   });
});
