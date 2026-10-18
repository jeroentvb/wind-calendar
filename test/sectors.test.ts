import { expect, test } from 'bun:test';
import { angleBetween, directionSpread, toSector, windSpread } from '../src/sectors.ts';
import type { Member } from '../src/types.ts';

test('maps degrees to 16-point sectors', () => {
   expect(toSector(0)).toBe('N');
   expect(toSector(11.24)).toBe('N');
   expect(toSector(11.25)).toBe('NNE');
   expect(toSector(225)).toBe('SW');
   expect(toSector(348.75)).toBe('N');
   expect(toSector(348.7)).toBe('NNW');
   expect(toSector(360)).toBe('N');
   expect(toSector(-90)).toBe('W');
});

test('angle between two directions takes the short way round', () => {
   expect(angleBetween(350, 10)).toBe(20);
   expect(angleBetween(10, 350)).toBe(20);
   expect(angleBetween(0, 180)).toBe(180);
   expect(angleBetween(90, 450)).toBe(0);
});

const m = (weight: number, wind: number, dir: number): Member => ({
   name: 'm',
   weight,
   wind,
   dir,
   thunder: false,
   highRes: false,
});

test('direction spread is the weighted mean deviation from the blended direction', () => {
   expect(directionSpread([m(1, 20, 180), m(1, 20, 240)], 210)).toBe(30);
   expect(directionSpread([m(1, 20, 350), m(1, 20, 10)], 0)).toBe(10);
   expect(directionSpread([m(100, 20, 270), m(1, 20, 90)], 270)).toBeCloseTo(180 / 101);
});

test('wind spread is the weighted mean deviation from the blended wind', () => {
   expect(windSpread([m(1, 22, 0), m(1, 16, 0), m(1, 32, 0)], 70 / 3)).toBeCloseTo(52 / 9);
   expect(windSpread([m(100, 20, 0), m(1, 40, 0)], 20)).toBeCloseTo(20 / 101);
});
