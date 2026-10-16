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
