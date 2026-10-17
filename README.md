# 📅 Wind calendar

An ICS feed of planned surf sessions, based on Open-Meteo wind forecasts. Subscribe to it from any calendar that supports ics subscriptions and sessions appear (and disappear) as the forecast changes.

> Disclaimer: this project was built using AI

## How it decides

For every spot, each hour is checked against the spot's conditions:

- daylight (the whole hour between sunrise and sunset)
- wind ≥ `minWindKn` (and ≤ `maxWindKn` if set)
- wind direction in one of the spot's sectors
- temperature ≥ `minTempC`
- **no thunder** – an hour is ruled out if _any_ model in the tier used for that hour reports a thunderstorm weather code (95/96/99) or CAPE ≥ 800 J/kg. Not configurable.

Consecutive good hours of at least `minDurationHours` form a **qualifying window**. The event covers the **peak block** inside it: the strongest hour plus adjacent hours less than `peakToleranceKn` below the peak, grown to `minDurationHours` if needed. When spots overlap, the highest spot weight wins; other good spots are listed in the description.

Forecast values at HH:00 are treated as the hour HH:00–HH+1:00. Model tiers: each hour uses the first tier that has data, averaging its models by weight (direction as a vector mean). When a high-resolution model's horizon ends, the next tier takes over.

**Outlook.** For `outlookDays` days after `maxDaysAhead`, models are not blended: every model is checked on its own, and one model meeting the conditions is enough. These events get a 🔮 instead of 🏄 in the title, are marked tentative, and their description warns that the forecast is uncertain and lists which models show the window (e.g. "Seen in GFS (1 of 2 models)"). When several models show overlapping windows at a spot, the event uses the strongest one. `maxDaysAhead + outlookDays` can be at most 15; without an explicit `outlookDays` the default shrinks to fit.

## Configuration

Copy `config.example.yml` to `config.yml` and adjust it. The config is read and validated at startup: on invalid values or unknown keys (typos) the app refuses to start with a readable error. Restart the app after changing it; in Docker the config is baked into the image, so rebuild with `docker compose up -d --build`.

### General

| Key                    | Default            | Description                                                  |
| ---------------------- | ------------------ | ------------------------------------------------------------ |
| `timezone`             | `Europe/Amsterdam` | IANA timezone for the times shown in event descriptions      |
| `fetchIntervalMinutes` | `60`               | How often forecasts are fetched (minimum 5)                  |
| `maxDaysAhead`         | `7`                | Only create events up to this many days ahead (1–15)         |
| `outlookDays`          | `4`                | Extra days with uncertain 🔮 events (see Outlook); `0` = off |
| `conditions`           | –                  | Required. Global good-condition settings, see below          |
| `models`               | –                  | Required. Forecast models in tiers, see below                |
| `spots`                | –                  | Required. At least one spot, see below                       |

### Conditions

Global settings under `conditions`. Every spot can override any of them in its own `conditions` block; keys a spot leaves out fall back to the global value.

| Key                | Default | Description                                                                                         |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------- |
| `minWindKn`        | –       | Required. Minimum sustained wind (knots) for every hour in a window                                 |
| `maxWindKn`        | `null`  | Maximum sustained wind (knots) per hour; `null` means no limit. Gusts are not checked               |
| `minDurationHours` | –       | Required. Minimum number of consecutive good hours                                                  |
| `minTempC`         | –       | Required. Minimum temperature (°C) for every hour                                                   |
| `peakToleranceKn`  | `3`     | Hours less than this many knots below the peak belong to the peak block (the event's start and end) |

### Models

`models` is a list of **tiers**, and each tier is a list of models. For every hour the first tier that has data is used; the models in it are averaged by `weight`. Lower tiers only take over once every model in the tiers above has run out of forecast hours, so long-range models never influence hours that high-resolution models cover. The same holds for thunder: only models in the tier used for an hour can rule it out.

In YAML a list of lists is written with `- -`: the first dash starts a new tier, the second starts that tier's first model, and the following lines with a single dash (aligned with the second dash) are more models in the same tier:

```yaml
models:
  - - { id: ecmwf_ifs, weight: 2 } # tier 1, first model
    - { id: icon_global, weight: 1 } # tier 1, second model
  - - { id: gfs_global, weight: 1 } # tier 2
```

| Key      | Default | Description                                        |
| -------- | ------- | -------------------------------------------------- |
| `id`     | –       | Required. Open-Meteo model id                      |
| `weight` | `1`     | Relative weight within the tier (must be > 0)      |
| `name`   | the id  | Display name in the event description's model list |

Choosing models: put high-resolution regional models that cover your spots in the first tier, and global models in a later tier for the longer range. A model returns no data for locations outside its domain, so check coverage for each spot. The [Open-Meteo docs](https://open-meteo.com/en/docs) list all models with their region, resolution and forecast length. Not every model provides gusts, weather codes or CAPE; a model without gusts is skipped for the hours it lacks them.

### Spots

| Key          | Default         | Description                                                                                                                        |
| ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | –               | Required, unique. Used in the event title and location                                                                             |
| `lat`, `lon` | –               | Required. Coordinates for the forecast and the Maps link                                                                           |
| `weight`     | `1`             | When spots are good at the same time, the highest weight gets the event; wind only breaks ties between equal weights               |
| `directions` | –               | Required. Wind directions that work, as 16-point sectors: `N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW`                    |
| `conditions` | –               | Optional overrides of the global conditions                                                                                        |
| `models`     | global `models` | Optional. This spot's own model tiers, in the same format as the global `models`. Replaces the global list completely (no merging) |

```yaml
spots:
  - name: Scheveningen
    lat: 52.11
    lon: 4.27
    weight: 10
    directions: [SW, WSW, W, WNW, NW]
    conditions:
      minWindKn: 18
    models: # optional: replaces the global models for this spot
      - - { id: <regional model id>, name: <short name> }
      - - { id: ecmwf_ifs, name: ECMWF }
```

A spot's own `models` is useful when spots lie in different regions: keep global models as the default and give a spot regional high-resolution models that cover it. Fetching, thunder detection and the model list in the description all follow the spot's own models.

## Running locally

```bash
bun install
bun test
cp config.example.yml config.yml
WIND_CAL_TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=') bun run src/main.ts
```

Environment variables:

| Variable           | Default             |                                                 |
| ------------------ | ------------------- | ----------------------------------------------- |
| `WIND_CAL_TOKEN`   | –                   | Required. ≥ 43 URL-safe base64 chars (256 bits) |
| `WIND_CAL_TOKEN_2` | –                   | Optional second token for rotation              |
| `CONFIG_PATH`      | `./config.yml`      |                                                 |
| `STATE_PATH`       | `./data/state.json` | Last-good forecast, served if fetching fails    |
| `PORT`             | `3005`              |                                                 |

## Deployment (Docker)

```bash
echo "WIND_CAL_TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" > .env
chmod 600 .env
cp config.example.yml config.yml   # edit spots and models
docker compose up -d --build
```

`config.yml` is copied into the image at build time, so this also works when deploying to a remote host through a Docker context: only `.env` and the build context are needed on the machine running `docker compose`. After changing the config, run `docker compose up -d --build` again. Keep the image private: it contains your spots.

The container publishes on `127.0.0.1:3005` only, runs as non-root with a read-only root filesystem, no capabilities and `no-new-privileges`. The last-good forecast lives on the `wind-data` volume so it survives restarts. Health is checked inside the container; no health endpoint is exposed.

The app speaks plain HTTP and does no rate limiting. Put a reverse proxy on the host in front of it to handle TLS (the token is part of the URL, so it must not travel over plain HTTP) and rate limiting.

The feed URL is `https://<your-host>/cal/<token>.ics`. Every other path, a wrong token, or a method other than GET/HEAD returns 404.

### Rotating the token

1. Add `WIND_CAL_TOKEN_2=<new token>` to `.env`, then `docker compose up -d` (recreates the container with both tokens).
2. Re-subscribe your devices with the new URL.
3. Replace `WIND_CAL_TOKEN` with the new token, remove the `WIND_CAL_TOKEN_2` line, then `docker compose up -d`.

The token is passed as an environment variable, so anyone with access to the Docker daemon on the host can read it with `docker inspect`.
