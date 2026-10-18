import { describe, expect, test } from 'bun:test';
import { peakBlock, qualifyingWindows } from '../src/windows.ts';
import type { Conditions, Hour, SpotRules, SunDay } from '../src/types.ts';

const T0 = Date.UTC(2026, 9, 17, 8) / 1000; // 08:00Z
const H = 3600;

const cond: Conditions = {
   minWindKn: 20,
   maxWindKn: null,
   minDurationHours: 2,
   minTempC: 5,
   peakToleranceKn: 3,
   directionSpreadDeg: 45,
};
const rules: SpotRules = { directions: ['SW', 'WSW', 'W'], conditions: cond };
const sun: SunDay[] = [{ sunrise: T0 - 30 * 60, sunset: T0 + 12 * H }];

function hours(winds: number[], patch: (i: number) => Partial<Hour> = () => ({})): Hour[] {
   return winds.map((wind, i) => ({
      time: T0 + i * H,
      wind,
      gust: wind + 8,
      dir: 250,
      temp: 15,
      thunder: false,
      models: ['test_model'],
      dirs: [250],
      tier: 0,
      ...patch(i),
   }));
}

describe('qualifyingWindows', () => {
   test('spec example: whole run qualifies', () => {
      const ws = qualifyingWindows(hours([22, 26, 26, 26, 23, 23]), rules, sun);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.map((h) => h.wind)).toEqual([22, 26, 26, 26, 23, 23]);
   });

   test('splits on low wind and drops windows shorter than min duration', () => {
      const ws = qualifyingWindows(hours([25, 15, 22, 23, 10, 21, 21, 21]), rules, sun);
      expect(ws.map((w) => w.length)).toEqual([2, 3]);
   });

   test('max wind cutoff', () => {
      const r = { ...rules, conditions: { ...cond, maxWindKn: 30 } };
      const ws = qualifyingWindows(hours([25, 31, 25, 25]), r, sun);
      expect(ws.map((w) => w.length)).toEqual([2]);
   });

   test('direction cutoff', () => {
      const ws = qualifyingWindows(
         hours([25, 25, 25, 25], (i) => (i === 1 ? { dir: 90 } : {})),
         rules,
         sun,
      );
      expect(ws.map((w) => w.length)).toEqual([2]);
   });

   test('temperature cutoff', () => {
      const ws = qualifyingWindows(
         hours([25, 25, 25], (i) => (i === 0 ? { temp: 4 } : {})),
         rules,
         sun,
      );
      expect(ws.map((w) => w.length)).toEqual([2]);
   });

   test('thunder splits a window', () => {
      const ws = qualifyingWindows(
         hours([25, 25, 25, 25, 25], (i) => (i === 2 ? { thunder: true } : {})),
         rules,
         sun,
      );
      expect(ws.map((w) => w.length)).toEqual([2, 2]);
   });

   test('daylight: hour must lie fully between sunrise and sunset', () => {
      const tightSun: SunDay[] = [{ sunrise: T0 + 10 * 60, sunset: T0 + 4 * H - 1 }];
      // 08:00 starts before sunrise; 11:00 slot ends after sunset -> only 09:00, 10:00
      const ws = qualifyingWindows(hours([25, 25, 25, 25]), rules, tightSun);
      expect(ws).toHaveLength(1);
      expect(ws[0]!.map((h) => h.time)).toEqual([T0 + H, T0 + 2 * H]);
   });

   test('a gap in the time series breaks a window', () => {
      const hs = hours([25, 25, 25, 25]);
      hs[2]!.time += H; // gap between index 1 and 2
      hs[3]!.time += H;
      const ws = qualifyingWindows(hs, rules, sun);
      expect(ws.map((w) => w.length)).toEqual([2, 2]);
   });
});

describe('peakBlock', () => {
   test('spec example: the three 26 kn hours', () => {
      expect(peakBlock(hours([22, 26, 26, 26, 23, 23]), cond)).toEqual({ start: 1, end: 4 });
   });

   test('extends with the stronger neighbour until min duration', () => {
      const c = { ...cond, minDurationHours: 3 };
      // peak 30 alone; neighbours 22 (left) and 24 (right) -> right first, then compare 22 vs 21
      expect(peakBlock(hours([21, 22, 30, 24, 21]), c)).toEqual({ start: 1, end: 4 });
   });

   test('equal neighbours extend to the earlier side', () => {
      const c = { ...cond, minDurationHours: 2 };
      expect(peakBlock(hours([22, 30, 22]), c)).toEqual({ start: 0, end: 2 });
   });

   test('peak ties: highest average wins', () => {
      const c = { ...cond, minDurationHours: 2 };
      // peak 28 at index 0 -> [28,20] avg 24; peak 28 at index 4 -> [27,28] avg 27.5 (27 within tolerance)
      expect(peakBlock(hours([28, 20, 21, 22, 28, 27]), c)).toEqual({ start: 4, end: 6 });
   });

   test('peak ties with equal average: earliest wins', () => {
      const c = { ...cond, minDurationHours: 1 };
      expect(peakBlock(hours([28, 20, 28]), c)).toEqual({ start: 0, end: 1 });
   });
});
