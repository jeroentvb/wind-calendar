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
   /** Weighted mean deviation (degrees) from the blended direction above which models disagree. */
   directionSpreadDeg: number;
   /** Weighted mean deviation (knots) from the blended wind above which models disagree. */
   windSpreadKn: number;
}

/** One model's contribution to a blended hour. */
export interface Member {
   /** Display name, or the id when the model has no name. */
   name: string;
   weight: number;
   wind: number;
   dir: number;
   /** Thunderstorm weather code or high CAPE in this model. */
   thunder: boolean;
}

/** One blended forecast hour. `time` is the slot start in epoch seconds (UTC); the slot lasts one hour. */
export interface Hour {
   time: number;
   wind: number;
   gust: number;
   dir: number;
   temp: number;
   /** Ruled out: models holding at least half of the hour's weight report thunder. */
   thunder: boolean;
   /** The models with data for this hour, in config order. */
   members: Member[];
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
