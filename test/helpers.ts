import type { SpotConfig } from '../src/config.ts';
import type { Hour } from '../src/types.ts';

export const T0 = Date.UTC(2026, 9, 17, 8) / 1000; // 2026-10-17 08:00Z = 10:00 Amsterdam
export const H = 3600;

export function spot(name: string, weight: number, overrides: Partial<SpotConfig> = {}): SpotConfig {
   return {
      name,
      lat: 52.1,
      lon: 4.27,
      weight,
      directions: ['SW', 'WSW', 'W', 'WNW'],
      conditions: {
         minWindKn: 15,
         maxWindKn: null,
         minDurationHours: 2,
         minTempC: 5,
         peakToleranceKn: 3,
         directionSpreadDeg: 25,
         windSpreadKn: 4,
      },
      models: [{ id: 'test_model', weight: 1 }],
      ...overrides,
   };
}

export function hours(winds: number[], start = T0, patch: (i: number) => Partial<Hour> = () => ({})): Hour[] {
   return winds.map((wind, i) => ({
      time: start + i * H,
      wind,
      gust: wind + 8,
      dir: 270,
      temp: 15,
      thunder: false,
      members: [{ name: 'test_model', weight: 1, wind, dir: 270, thunder: false, highRes: true }],
      ...patch(i),
   }));
}

export const allDay = [{ sunrise: T0 - 2 * H, sunset: T0 + 10 * H }];
