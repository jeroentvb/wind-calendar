import { expect, test } from 'bun:test';
import { toSector } from '../src/sectors.ts';

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
