import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig, parseConfig } from '../src/config.ts';

const example = await Bun.file(new URL('../config.example.yml', import.meta.url)).text();

const minimal = (extra = '', spot = '') => `
conditions: { minWindKn: 15, minDurationHours: 2, minTempC: 5 }
models: [[{ id: ecmwf_ifs025 }]]
spots:
  - { name: A, lat: 52, lon: 4, directions: [W]${spot} }
${extra}`;

test('example config loads', () => {
   const c = parseConfig(example);
   expect(c.spots.map((s) => s.name)).toEqual(['Scheveningen', 'Brouwersdam']);
   expect(c.models.map((tier) => tier.map((m) => m.id))).toEqual([['ecmwf_ifs', 'icon_global', 'gfs_global']]);
});

test('model name is optional', () => {
   const c = parseConfig(
      minimal().replace('{ id: ecmwf_ifs025 }', '{ id: ecmwf_ifs025, name: ECMWF }, { id: gfs_global }'),
   );
   expect(c.models[0]).toEqual([
      { id: 'ecmwf_ifs025', weight: 1, name: 'ECMWF' },
      { id: 'gfs_global', weight: 1 },
   ]);
   expect(() => parseConfig(minimal().replace('{ id: ecmwf_ifs025 }', "{ id: ecmwf_ifs025, name: '' }"))).toThrow(
      /name/,
   );
});

test('spot overrides replace global values, rest falls through', () => {
   const c = parseConfig(example);
   expect(c.spots[0]!.conditions).toEqual({
      minWindKn: 18,
      maxWindKn: null,
      minDurationHours: 2,
      minTempC: 5,
      peakToleranceKn: 3,
   });
   expect(c.spots[1]!.conditions.minWindKn).toBe(16);
});

test('defaults', () => {
   const c = parseConfig(minimal());
   expect(c.fetchIntervalMinutes).toBe(60);
   expect(c.maxDaysAhead).toBe(7);
   expect(c.outlookDays).toBe(4);
   expect(c.timezone).toBe('Europe/Amsterdam');
   expect(c.spots[0]!.conditions.peakToleranceKn).toBe(3);
   expect(c.spots[0]!.weight).toBe(1);
});

test('outlookDays defaults to what still fits in the forecast range', () => {
   expect(parseConfig(minimal('maxDaysAhead: 13')).outlookDays).toBe(2);
   expect(parseConfig(minimal('maxDaysAhead: 15')).outlookDays).toBe(0);
   expect(parseConfig(minimal('maxDaysAhead: 10\noutlookDays: 5')).outlookDays).toBe(5);
   expect(() => parseConfig(minimal('maxDaysAhead: 10\noutlookDays: 6'))).toThrow(/maxDaysAhead \+ outlookDays/);
});

test('rejects invalid sectors', () => {
   expect(() => parseConfig(minimal('', '').replace('[W]', '[WEST]'))).toThrow(ConfigError);
});

test('rejects negative wind', () => {
   expect(() => parseConfig(minimal().replace('minWindKn: 15', 'minWindKn: -1'))).toThrow(/minWindKn/);
});

test('rejects a spot without coordinates', () => {
   expect(() => parseConfig(minimal().replace('lat: 52, ', ''))).toThrow(/lat/);
});

test('rejects unknown keys (typos)', () => {
   expect(() => parseConfig(minimal('', ', wieght: 3'))).toThrow(ConfigError);
});

test('rejects max wind below min wind after overrides', () => {
   expect(() => parseConfig(minimal('', ', conditions: { maxWindKn: 10 }'))).toThrow(/maxWindKn/);
});

test('rejects duplicate spot names', () => {
   const text = minimal().replace('spots:\n', 'spots:\n  - { name: A, lat: 1, lon: 1, directions: [N] }\n');
   expect(() => parseConfig(text)).toThrow(/unique/);
});

test('rejects invalid YAML', () => {
   expect(() => parseConfig('spots: [')).toThrow(/YAML/);
});

test('spot models replace the global models; spots without them use the global ones', () => {
   const c = parseConfig(
      minimal('  - { name: B, lat: 1, lon: 1, directions: [N], models: [[{ id: icon_d2 }], [{ id: gfs_global }]] }'),
   );
   expect(c.spots[0]!.models).toEqual([[{ id: 'ecmwf_ifs025', weight: 1 }]]);
   expect(c.spots[1]!.models).toEqual([[{ id: 'icon_d2', weight: 1 }], [{ id: 'gfs_global', weight: 1 }]]);
});

test('rejects an empty spot models list', () => {
   expect(() => parseConfig(minimal('', ', models: []'))).toThrow(/models/);
});

test('loadConfig explains a missing file or a directory', async () => {
   const dir = await mkdtemp(join(tmpdir(), 'wind-cfg-'));
   await mkdir(join(dir, 'config.yml'));
   await expect(loadConfig(join(dir, 'config.yml'))).rejects.toThrow(/is a directory/);
   await expect(loadConfig(join(dir, 'missing.yml'))).rejects.toThrow(/not found/);
   await rm(dir, { recursive: true });
});
