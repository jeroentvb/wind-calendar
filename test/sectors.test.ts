import { expect, test } from 'bun:test';
import { directionSpread, toSector } from '../src/sectors.ts';

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

test('direction spread is the largest angle between any two directions, across north', () => {
   expect(directionSpread([270])).toBe(0);
   expect(directionSpread([350, 10])).toBe(20);
   expect(directionSpread([180, 225, 135])).toBe(90);
   expect(directionSpread([0, 180])).toBe(180);
});
