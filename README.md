# 📅 Wind calendar

An ICS feed of planned surf sessions, based on Open-Meteo wind forecasts. Subscribe to it from any calendar that supports ics subscriptions and sessions appear (and disappear) as the forecast changes.

> Disclaimer: this project was built using AI

## How it decides

For every spot, each hour is checked against the spot's conditions:

- daylight (the whole hour between sunrise and sunset)
- wind ≥ `minWindKn` (and ≤ `maxWindKn` if set)
- wind direction in one of the spot's sectors
- temperature ≥ `minTempC`
- **no thunder** – an hour is ruled out when models holding at least half of that hour's weight report a thunderstorm weather code (95/96/99) or CAPE ≥ 800 J/kg. Below that, the description lists the hour under "Possible thunder" with the models that report it. Not configurable.

Consecutive good hours of at least `minDurationHours` form a **qualifying window**. The event covers the **peak block** inside it: the strongest hour plus adjacent hours less than `peakToleranceKn` below the peak, grown to `minDurationHours` if needed. When spots overlap, the highest spot weight wins; other good spots are listed in the description.

Forecast values at HH:00 are treated as the hour HH:00–HH+1:00. Each hour is the weighted mean of every model that has data for it (direction as a vector mean), like Windguru's WG blend. Weights follow the models' resolution, so high-resolution models dominate while they have data and the coarser models take over once they run out.

**Disagreement.** When the models disagree, the event description warns and lists the hours with each model's value: for direction when the models deviate on average more than `directionSpreadDeg` from the blended direction, and for wind when they deviate more than `windSpreadKn` from the blended wind. Both averages are weighted, so a low-weight outlier barely counts. These warnings never rule an hour out.

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
| `models`               | –                  | Required. Forecast models, see below                         |
| `spots`                | –                  | Required. At least one spot, see below                       |

### Conditions

Global settings under `conditions`. Every spot can override any of them in its own `conditions` block; keys a spot leaves out fall back to the global value.

| Key                  | Default | Description                                                                                         |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `minWindKn`          | –       | Required. Minimum sustained wind (knots) for every hour in a window                                 |
| `maxWindKn`          | `null`  | Maximum sustained wind (knots) per hour; `null` means no limit. Gusts are not checked               |
| `minDurationHours`   | –       | Required. Minimum number of consecutive good hours                                                  |
| `minTempC`           | –       | Required. Minimum temperature (°C) for every hour                                                   |
| `peakToleranceKn`    | `3`     | Hours less than this many knots below the peak belong to the peak block (the event's start and end) |
| `directionSpreadDeg` | `25`    | Warn when the models' weighted mean deviation from the blended direction exceeds this (degrees)     |
| `windSpreadKn`       | `4`     | Warn when the models' weighted mean deviation from the blended wind exceeds this (knots)            |

### Models

`models` is a list of models. For every hour, all models with data are averaged by `weight`, and thunder is judged by weight share as described above. A model that has run out of forecast hours simply drops out, and the weights of the remaining models decide.

Every model needs a `weight` or a `resolutionKm`. With only `resolutionKm` (the model's grid spacing, listed in the [Open-Meteo docs](https://open-meteo.com/en/docs)), the weight is `(10 / resolutionKm)²`: proportional to the number of grid cells per area, so a model with half the grid spacing counts four times as much. A 2 km model then outweighs a 9 km global model about 20 to 1, which keeps global models from moving the short range much while they still fill in the days after it. An explicit `weight` always wins.

```yaml
models:
  - { id: knmi_harmonie_arome_netherlands, name: HARM-NL, resolutionKm: 2 } # weight 25
  - { id: icon_eu, name: ICON-EU, resolutionKm: 7 } # weight 2.04
  - { id: ecmwf_ifs, name: ECMWF, weight: 2 } # explicit weight
```

| Key            | Default | Description                                                                 |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `id`           | –       | Required. Open-Meteo model id                                               |
| `weight`       | –       | Relative weight in the blend (must be > 0). Required without `resolutionKm` |
| `resolutionKm` | –       | Grid spacing in km; sets the weight to `(10 / resolutionKm)²`               |
| `name`         | the id  | Display name in the event description                                       |
| `latestRuns`   | `false` | Use the model's newest runs, see "Newest model runs" below                  |

Choosing models: add high-resolution regional models that cover your spots, plus global models for the longer range. A model returns no data for locations outside its domain, so check coverage for each spot. The [Open-Meteo docs](https://open-meteo.com/en/docs) list all models with their region, resolution and forecast length. Not every model provides gusts, weather codes or CAPE; a model without gusts is skipped for the hours it lacks them.

#### Newest model runs

Open-Meteo's forecast API stitches each model from its runs, but does not always use the newest one. ICON-EU, for example, also runs at 03, 09, 15 and 21 UTC, but those runs only reach 30 hours ahead; beyond that the API keeps serving the older 00 or 12 UTC run, even when a newer 06 or 18 UTC run reaching 120 hours exists. Sites like Windguru do show that newer run, so for days 2–5 the calendar can be a run behind what you see there.

Set `latestRuns: true` on a model to fix that:

```yaml
models:
  - { id: icon_eu, name: ICON-EU, resolutionKm: 7, latestRuns: true }
  - { id: icon_global, name: ICON, resolutionKm: 13, latestRuns: true }
```

The app then also reads the model from Open-Meteo's [Single Runs API](https://open-meteo.com/en/docs/single-runs-api). On every refresh it checks each hour of the last 12 (24 on startup) for a new run, fetches each new run once for all spots, and per hour uses the newest run that covers it. Hours no run covers, and any failure of the Single Runs API, fall back to the regular forecast data.

So far this is only known to improve ICON-EU (`icon_eu`) and ICON global (`icon_global`); other models we checked (HARM-NL, ICON-D2, AROME-HD, UKV, ARPEGE, GFS, ECMWF) are already served from their newest run. It costs extra API calls: about a dozen small requests per model per refresh plus one larger request per new run, which with five spots and two models stays well within the free limit of 10,000 calls a day. The Single Runs API may pick a slightly different grid cell than the regular API.

### Spots

| Key          | Default         | Description                                                                                                                   |
| ------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `name`       | –               | Required, unique. Used in the event title and location                                                                        |
| `lat`, `lon` | –               | Required. Coordinates for the forecast and the Maps link                                                                      |
| `weight`     | `1`             | When spots are good at the same time, the highest weight gets the event; wind only breaks ties between equal weights          |
| `directions` | –               | Required. Wind directions that work, as 16-point sectors: `N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW`               |
| `conditions` | –               | Optional overrides of the global conditions                                                                                   |
| `models`     | global `models` | Optional. This spot's own models, in the same format as the global `models`. Replaces the global list completely (no merging) |

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
      - { id: <regional model id>, name: <short name>, resolutionKm: 2 }
      - { id: ecmwf_ifs, name: ECMWF, resolutionKm: 9 }
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
