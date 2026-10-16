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

test('weighted mean within a tier', () => {
   const hours = blend(fc({ a: series(1, { wind: [20] }), b: series(1, { wind: [26] }) }, 1), [
      [
         { id: 'a', weight: 2 },
         { id: 'b', weight: 1 },
      ],
   ]);
   expect(hours[0]!.wind).toBeCloseTo(22);
   expect(hours[0]!.gust).toBeCloseTo(27);
});

test('direction uses a vector mean', () => {
   const hours = blend(fc({ a: series(1, { wind: [20], dir: [350] }), b: series(1, { wind: [20], dir: [10] }) }, 1), [
      [
         { id: 'a', weight: 1 },
         { id: 'b', weight: 1 },
      ],
   ]);
   const d = hours[0]!.dir;
   expect(Math.min(d, 360 - d)).toBeCloseTo(0, 6);
});

test("falls back to the next tier when the first tier's data ends", () => {
   const hours = blend(fc({ hi: series(3, { wind: [20, 20, null] }), lo: series(3, { wind: [10, 10, 12] }) }, 3), [
      [{ id: 'hi', weight: 1 }],
      [{ id: 'lo', weight: 1 }],
   ]);
   expect(hours.map((h) => h.wind)).toEqual([20, 20, 12]);
   expect(hours.map((h) => h.models)).toEqual([['hi'], ['hi'], ['lo']]);
});

test('records model names, falling back to the id', () => {
   const hours = blend(fc({ a: series(1, { wind: [20] }), b: series(1, { wind: [22] }) }, 1), [
      [
         { id: 'a', weight: 1, name: 'Model A' },
         { id: 'b', weight: 1 },
      ],
   ]);
   expect(hours[0]!.models).toEqual(['Model A', 'b']);
});

test('records only the models that had data for the hour, in config order', () => {
   const hours = blend(fc({ a: series(2, { wind: [20, null] }), b: series(2, { wind: [22, 22] }) }, 2), [
      [
         { id: 'a', weight: 1 },
         { id: 'b', weight: 1 },
      ],
   ]);
   expect(hours.map((h) => h.models)).toEqual([['a', 'b'], ['b']]);
});

test('hours without any data are dropped', () => {
   const hours = blend(fc({ a: series(2, { wind: [20, null] }) }, 2), [[{ id: 'a', weight: 1 }]]);
   expect(hours).toHaveLength(1);
});

test('thunder from any model in the active tier vetoes the hour', () => {
   const hours = blend(
      fc(
         {
            a: series(3, { wind: [20, 20, 20], weatherCode: [3, 95, 3] }),
            // no wind data, but its CAPE still counts because it belongs to the active tier
            b: series(3, { wind: [null, null, null], cape: [null, null, 900] }),
         },
         3,
      ),
      [
         [
            { id: 'a', weight: 1 },
            { id: 'b', weight: 1 },
         ],
      ],
   );
   expect(hours.map((h) => h.thunder)).toEqual([false, true, true]);
});

test('lower tiers do not affect thunder while a higher tier has data', () => {
   const hours = blend(
      fc(
         {
            hi: series(3, { wind: [20, 20, null] }),
            lo: series(3, { wind: [20, 20, 20], weatherCode: [95, 95, 95] }),
         },
         3,
      ),
      [[{ id: 'hi', weight: 1 }], [{ id: 'lo', weight: 1 }]],
   );
   expect(hours.map((h) => h.thunder)).toEqual([false, false, true]);
});
