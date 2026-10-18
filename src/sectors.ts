import { SECTORS, type Member, type Sector } from './types.ts';

export function toSector(deg: number): Sector {
   const normalized = ((deg % 360) + 360) % 360;
   return SECTORS[Math.round(normalized / 22.5) % 16]!;
}

/** Smallest angle in degrees (0-180) between two directions. */
export function angleBetween(a: number, b: number): number {
   const d = Math.abs(a - b) % 360;
   return d > 180 ? 360 - d : d;
}

const weightedMean = (members: readonly Member[], f: (m: Member) => number) =>
   members.reduce((a, m) => a + m.weight * f(m), 0) / members.reduce((a, m) => a + m.weight, 0);

/** Weighted mean angle (degrees) between each model's direction and the blended direction. */
export function directionSpread(members: readonly Member[], dir: number): number {
   return weightedMean(members, (m) => angleBetween(m.dir, dir));
}

/** Weighted mean difference (knots) between each model's wind and the blended wind. */
export function windSpread(members: readonly Member[], wind: number): number {
   return weightedMean(members, (m) => Math.abs(m.wind - wind));
}
