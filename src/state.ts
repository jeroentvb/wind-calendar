import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SpotForecast } from './openmeteo.ts';

/** Last successful forecast per spot, tagged with what was requested so config changes invalidate it. */
export interface StoredForecast {
   key: string;
   forecast: SpotForecast;
}

export type State = Record<string, StoredForecast>;

interface StateFile {
   version: 1;
   spots: State;
}

export async function loadState(path: string): Promise<State> {
   const file = Bun.file(path);
   if (!(await file.exists())) return {};
   try {
      const data = (await file.json()) as StateFile;
      if (data?.version !== 1 || typeof data.spots !== 'object' || data.spots === null) return {};
      return data.spots;
   } catch (err) {
      console.warn(`Ignoring unreadable state file ${path}: ${(err as Error).message}`);
      return {};
   }
}

export async function saveState(path: string, spots: State): Promise<void> {
   await mkdir(dirname(path), { recursive: true });
   const tmp = `${path}.tmp`;
   const body: StateFile = { version: 1, spots };
   await Bun.write(tmp, JSON.stringify(body));
   await rename(tmp, path);
}
