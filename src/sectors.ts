import { SECTORS, type Sector } from './types.ts';

export function toSector(deg: number): Sector {
   const normalized = ((deg % 360) + 360) % 360;
   return SECTORS[Math.round(normalized / 22.5) % 16]!;
}

/** Largest angle in degrees (0-180) between any two of the directions. */
export function directionSpread(dirs: readonly number[]): number {
   let max = 0;
   for (const [i, a] of dirs.entries()) {
      for (const b of dirs.slice(i + 1)) {
         const d = Math.abs(a - b) % 360;
         max = Math.max(max, d > 180 ? 360 - d : d);
      }
   }
   return max;
}
