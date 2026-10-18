import { expect, test } from 'bun:test';
import { blend } from '../src/blend.ts';
import type { ModelSeries, SpotForecast } from '../src/openmeteo.ts';

function series(n: number, v: Partial<Record<keyof ModelSeries, (number | null)[]>>): ModelSeries {
   const nulls = () => new Array(n).fill(null);
   return {
      wind: v.wind ?? nulls(),
      gust: v.gust ?? v.wind?.map((w) => (w == null ? null : w + 5)) ?? nulls(),
      dir: v.dir ?? new Array(n).fill(270),
      temp: v.temp ?? new Array(n).fill(15),
      weatherCode: v.weatherCode ?? new Array(n).fill(3),
      cape: v.cape ?? nulls(),
   };
}

function fc(models: Record<string, ModelSeries>, n: number): SpotForecast {
   return { fetchedAt: 0, times: Array.from({ length: n }, (_, i) => i * 3600), models, sun: [] };
}

test('weighted mean across all models', () => {
   const hours = blend(fc({ a: series(1, { wind: [20] }), b: series(1, { wind: [26] }) }, 1), [
      { id: 'a', weight: 2 },
      { id: 'b', weight: 1 },
   ]);
   expect(hours[0]!.wind).toBeCloseTo(22);
   expect(hours[0]!.gust).toBeCloseTo(27);
});

test('direction uses a vector mean', () => {
   const hours = blend(fc({ a: series(1, { wind: [20], dir: [350] }), b: series(1, { wind: [20], dir: [10] }) }, 1), [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
   ]);
   const d = hours[0]!.dir;
   expect(Math.min(d, 360 - d)).toBeCloseTo(0, 6);
});

test('a model past its horizon drops out and the others carry on', () => {
   const hours = blend(fc({ hi: series(3, { wind: [20, 20, null] }), lo: series(3, { wind: [10, 10, 12] }) }, 3), [
      { id: 'hi', weight: 100 },
      { id: 'lo', weight: 1 },
   ]);
   expect(hours.map((h) => h.wind.toFixed(1))).toEqual(['19.9', '19.9', '12.0']);
   expect(hours.map((h) => h.members.map((m) => m.name))).toEqual([['hi', 'lo'], ['hi', 'lo'], ['lo']]);
});

test('records each model with its name (falling back to the id), weight, wind and direction', () => {
   const hours = blend(fc({ a: series(1, { wind: [20], dir: [180] }), b: series(1, { wind: [22] }) }, 1), [
      { id: 'a', weight: 10, name: 'Model A' },
      { id: 'b', weight: 1 },
   ]);
   expect(hours[0]!.members).toEqual([
      { name: 'Model A', weight: 10, wind: 20, dir: 180, thunder: false },
      { name: 'b', weight: 1, wind: 22, dir: 270, thunder: false },
   ]);
});

test('a model missing any variable is left out of that hour', () => {
   const hours = blend(
      fc({ a: series(2, { wind: [20, 20], gust: [25, null] }), b: series(2, { wind: [22, 22] }) }, 2),
      [
         { id: 'a', weight: 1 },
         { id: 'b', weight: 1 },
      ],
   );
   expect(hours.map((h) => h.members.map((m) => m.name))).toEqual([['a', 'b'], ['b']]);
});

test('hours without any data are dropped', () => {
   const hours = blend(fc({ a: series(2, { wind: [20, null] }) }, 2), [{ id: 'a', weight: 1 }]);
   expect(hours).toHaveLength(1);
});

test('thunder rules an hour out from half of the weight; less only flags the models', () => {
   const hours = blend(
      fc(
         {
            hi: series(3, { wind: [20, 20, 20], weatherCode: [3, 95, 3] }),
            lo: series(3, { wind: [20, 20, 20], cape: [900, null, null] }),
            lo2: series(3, { wind: [20, 20, 20] }),
         },
         3,
      ),
      [
         { id: 'hi', weight: 2 },
         { id: 'lo', weight: 1 },
         { id: 'lo2', weight: 1 },
      ],
   );
   expect(hours.map((h) => h.thunder)).toEqual([false, true, false]);
   expect(hours.map((h) => h.members.filter((m) => m.thunder).map((m) => m.name))).toEqual([['lo'], ['hi'], []]);
});
