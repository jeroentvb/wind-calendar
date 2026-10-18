export const SECTORS = [
   'N',
   'NNE',
   'NE',
   'ENE',
   'E',
   'ESE',
   'SE',
   'SSE',
   'S',
   'SSW',
   'SW',
   'WSW',
   'W',
   'WNW',
   'NW',
   'NNW',
] as const;

export type Sector = (typeof SECTORS)[number];

export interface Conditions {
   minWindKn: number;
   maxWindKn: number | null;
   minDurationHours: number;
   minTempC: number;
   peakToleranceKn: number;
   /** Models further apart than this (degrees) are flagged as disagreeing on direction. */
   directionSpreadDeg: number;
}

/** One blended forecast hour. `time` is the slot start in epoch seconds (UTC); the slot lasts one hour. */
export interface Hour {
   time: number;
   wind: number;
   gust: number;
   dir: number;
   temp: number;
   thunder: boolean;
   /** Display names (or ids) of the models averaged for this hour, in config order. */
   models: string[];
   /** Each model's own direction, in the same order as `models`. */
   dirs: number[];
   /** Index of the tier these models come from. */
   tier: number;
}

/** Daylight interval in epoch seconds. */
export interface SunDay {
   sunrise: number;
   sunset: number;
}

export interface SpotRules {
   directions: readonly Sector[];
   conditions: Conditions;
}
