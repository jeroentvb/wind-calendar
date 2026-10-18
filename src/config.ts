import { stat } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ModelRef } from './blend.ts';
import { SECTORS, type Conditions, type Sector } from './types.ts';

const knots = z.number().nonnegative();

const conditionFields = {
   minWindKn: knots,
   maxWindKn: knots.nullable(),
   minDurationHours: z.int().min(1),
   minTempC: z.number(),
   peakToleranceKn: knots,
   directionSpreadDeg: z.number().min(0).max(180),
   windSpreadKn: knots,
};

const GlobalConditions = z.strictObject({
   ...conditionFields,
   maxWindKn: conditionFields.maxWindKn.optional().transform((v) => v ?? null),
   peakToleranceKn: conditionFields.peakToleranceKn.optional().transform((v) => v ?? 3),
   directionSpreadDeg: conditionFields.directionSpreadDeg.optional().transform((v) => v ?? 25),
   windSpreadKn: conditionFields.windSpreadKn.optional().transform((v) => v ?? 4),
});

// Overrides carry no defaults, so absent fields fall through to the global settings.
const ConditionOverrides = z.strictObject(conditionFields).partial();

const Model = z
   .strictObject({
      id: z.string().regex(/^[a-z0-9_]+$/, 'model id must be an Open-Meteo model id like ecmwf_ifs025'),
      weight: z.number().positive().optional(),
      // Without a weight: (10 / resolutionKm)², proportional to grid cells per area.
      resolutionKm: z.number().positive().optional(),
      name: z.string().trim().min(1).optional(),
      latestRuns: z.boolean().optional(),
   })
   .refine((m) => m.weight !== undefined || m.resolutionKm !== undefined, {
      message: 'set weight or resolutionKm',
      path: ['weight'],
   })
   .transform((m): ModelRef => ({ ...m, weight: m.weight ?? (10 / m.resolutionKm!) ** 2 }));

const Models = z
   .array(
      z
         .unknown()
         .superRefine((v, ctx) => {
            if (Array.isArray(v)) {
               ctx.addIssue({
                  code: 'custom',
                  message: 'models is a flat list now: model tiers were removed, use weights',
               });
            }
         })
         .pipe(Model),
   )
   .min(1);

const Spot = z.strictObject({
   name: z.string().trim().min(1),
   lat: z.number().min(-90).max(90),
   lon: z.number().min(-180).max(180),
   weight: z.number().default(1),
   directions: z.array(z.enum(SECTORS)).min(1),
   conditions: ConditionOverrides.optional(),
   // Replaces the global models for this spot.
   models: Models.optional(),
});

const ConfigSchema = z
   .strictObject({
      timezone: z
         .string()
         .default('Europe/Amsterdam')
         .refine((tz) => {
            try {
               new Intl.DateTimeFormat('en', { timeZone: tz });
               return true;
            } catch {
               return false;
            }
         }, 'unknown IANA timezone'),
      fetchIntervalMinutes: z.int().min(5).default(60),
      maxDaysAhead: z.int().min(1).max(15).default(7),
      outlookDays: z.int().min(0).max(14).optional(),
      conditions: GlobalConditions,
      models: Models,
      spots: z.array(Spot).min(1),
   })
   .refine((c) => new Set(c.spots.map((s) => s.name)).size === c.spots.length, {
      message: 'spot names must be unique',
      path: ['spots'],
   });

export interface SpotConfig {
   name: string;
   lat: number;
   lon: number;
   weight: number;
   directions: Sector[];
   conditions: Conditions;
   /** The spot's own models, or the global ones. */
   models: ModelRef[];
}

export interface Config {
   timezone: string;
   fetchIntervalMinutes: number;
   maxDaysAhead: number;
   /** Extra days after maxDaysAhead where a single model is enough for an (uncertain) event. */
   outlookDays: number;
   models: ModelRef[];
   spots: SpotConfig[];
}

export class ConfigError extends Error {}

export function parseConfig(text: string): Config {
   let raw: unknown;
   try {
      raw = parseYaml(text);
   } catch (err) {
      throw new ConfigError(`Config is not valid YAML: ${(err as Error).message}`);
   }
   const result = ConfigSchema.safeParse(raw);
   if (!result.success) throw new ConfigError(`Invalid config:\n${z.prettifyError(result.error)}`);
   const c = result.data;

   // Open-Meteo forecasts at most 16 days, and the fetch asks for one day beyond the last one shown.
   const maxTotalDays = 15;
   if (c.outlookDays !== undefined && c.maxDaysAhead + c.outlookDays > maxTotalDays) {
      throw new ConfigError(`Invalid config: maxDaysAhead + outlookDays must be at most ${maxTotalDays}`);
   }
   const outlookDays = c.outlookDays ?? Math.min(4, maxTotalDays - c.maxDaysAhead);

   const spots = c.spots.map((s): SpotConfig => {
      const conditions: Conditions = { ...c.conditions, ...s.conditions };
      if (conditions.maxWindKn !== null && conditions.maxWindKn < conditions.minWindKn) {
         throw new ConfigError(`Invalid config: spot "${s.name}" has maxWindKn below minWindKn`);
      }
      return {
         name: s.name,
         lat: s.lat,
         lon: s.lon,
         weight: s.weight,
         directions: s.directions,
         conditions,
         models: s.models ?? c.models,
      };
   });

   return {
      timezone: c.timezone,
      fetchIntervalMinutes: c.fetchIntervalMinutes,
      maxDaysAhead: c.maxDaysAhead,
      outlookDays,
      models: c.models,
      spots,
   };
}

export async function loadConfig(path: string): Promise<Config> {
   const info = await stat(path).catch(() => null);
   if (!info) throw new ConfigError(`Config file not found: ${path}. Copy config.example.yml to config.yml.`);
   if (info.isDirectory()) {
      throw new ConfigError(
         `Config path ${path} is a directory, not a file. Docker creates an empty directory when the ` +
            'mounted config.yml does not exist on the host: remove it and copy config.example.yml to config.yml.',
      );
   }
   return parseConfig(await Bun.file(path).text());
}
