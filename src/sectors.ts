import { SECTORS, type Sector } from './types.ts';

export function toSector(deg: number): Sector {
   const normalized = ((deg % 360) + 360) % 360;
   return SECTORS[Math.round(normalized / 22.5) % 16]!;
}
