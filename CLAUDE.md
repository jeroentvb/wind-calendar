# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install
bun test                          # all tests
bun test test/windows.test.ts     # one file
bun test -t "peak ties"           # tests matching a name
bun run typecheck                 # tsc --noEmit (TypeScript 7)
bun run format                    # prettier --write .
bun run format:check
WIND_CAL_TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=') bun run src/main.ts   # needs ./config.yml
docker compose up -d --build      # needs .env (WIND_CAL_TOKEN) and config.yml
```

No ESLint: typescript-eslint does not support TS 7 yet, and the project stays on TS 7 until it does. Formatting is Prettier only (`.prettierrc.json`): single quotes, 120 columns, 3-space indent for `.ts`/`.js` and 2 spaces elsewhere.

## Architecture

A Bun HTTP server that serves one pre-rendered ICS feed. Data flows through `src/` like this:

1. **Fetch** (`openmeteo.ts`, driven by `scheduler.ts`): one Open-Meteo request per spot, listing every model in that spot's tiers. With several models, Open-Meteo suffixes every variable with the model id (`wind_speed_10m_icon_d2`); with exactly one model it returns plain names, and `parseResponse` handles both. Hours past a model's horizon come back as `null`, which is what drives tier fallback; horizons are never hardcoded. Requests use `cell_selection=sea`: Open-Meteo's default `land` reads coastal spots from a land cell and underestimates wind by several knots.
2. **State** (`state.ts`): the last successful forecast per spot, persisted atomically to `STATE_PATH`. It is keyed by the spot's coordinates plus model ids, so changing either drops the cached data. A failed fetch keeps serving the previous data.
3. **Blend** (`blend.ts`): for each hour, use the first tier with any model that has wind, gust, direction and temperature; take a weighted mean (direction as a vector mean). Thunder (weather code 95/96/99 or CAPE ≥ 800, fixed and deliberately not configurable) only counts models of that same tier, so long-range models never affect hours a high-res tier covers. Each `Hour` records the display names of the models used.
4. **Windows** (`windows.ts`): a qualifying window is consecutive daylight hours meeting every condition and lasting at least `minDurationHours`. The peak block extends from the max-wind hour while `peak - wind < peakToleranceKn` (strictly less: the spec example 22,26,26,26,23,23 with tolerance 3 must give only the 26s). A forecast value at HH:00 stands for the slot HH:00–HH+1:00, and daylight requires the whole slot between sunrise and sunset.
5. **Select** (`select.ts`): one candidate per window. Candidates are ranked by spot weight, then average wind; a candidate is dropped if its peak block overlaps an accepted one. Other spots whose windows overlap a winner's window are listed under "Also good".
6. **Render** (`ics.ts`, `describe.ts`): plain-text descriptions (iOS doesn't render HTML), RFC 5545 escaping and 75-octet folding. The UID is a hash of spot name plus window start, so iOS updates events instead of duplicating them. The feed is fully regenerated on each refresh, so events that stop qualifying disappear.
7. **Serve** (`server.ts`, `tokens.ts`): only `GET|HEAD /cal/<token>.ics`; everything else, including a wrong token or any other method, is an empty 404. Tokens (`WIND_CAL_TOKEN`, optional `WIND_CAL_TOKEN_2` for rotation) must be at least 43 URL-safe base64 characters and are compared with SHA-256 plus `timingSafeEqual`. By design there are no other endpoints; the Docker healthcheck (`healthcheck.ts`) requests the feed from inside the container.

`Feed` (`scheduler.ts`) takes injectable `fetchImpl`, `now`, `sleep` and `log`, which is how the scheduler tests run without the network.

## Config

`config.ts` validates YAML with zod `strictObject`s, so unknown keys (typos) fail at startup. Global `conditions` are merged with each spot's partial `conditions`; the override schema has no defaults so missing keys fall through. `models` is a list of tiers (YAML `- -` per tier), and a spot's own `models` replaces the global tiers entirely rather than merging. The README's Configuration section is the user-facing reference; keep it and `config.example.yml` in sync when adding options.

## Deployment notes

- `config.yml` is baked into the image (`COPY` in the Dockerfile) rather than mounted, because the author deploys through a remote Docker context, where bind-mount paths resolve on the server. Config changes need `docker compose up -d --build`.
- The app listens on port 3005, and `compose.yaml` publishes it on `127.0.0.1` only behind a reverse proxy. The container runs as user `bun` with a read-only root filesystem; `/data` (named volume) is the only writable path besides a `/tmp` tmpfs.
- `config.yml`, `.env` and `docs/` are gitignored. `docs/` holds the original spec (`prompt.md`) and the author's nginx setup.
- `test/fixtures/` holds real recorded Open-Meteo responses and is excluded from Prettier; keep them byte-for-byte.
