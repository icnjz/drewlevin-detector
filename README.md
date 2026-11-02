# DrewLevin Detector

A League of Legends match-history tool with a sense of humor. Enter a Riot ID,
get a Drew Index, and open **THE RECEIPTS** to inspect the matches behind each
detected change.

Live site: [drewed.lol](https://drewed.lol/)

## What it does

- Reviews every Solo/Duo and Flex match returned for the current year and the
  previous two years, with paginated history requests.
- Compares Flash placement, item slots, rune pages, champion and role habits,
  and sustained performance changes across that history.
- Keeps Solo/Duo and Flex performance comparisons separate while comparing
  mechanical habits across both queues.
- Shows dated evidence, baseline comparisons, match IDs, participant details,
  and complete rune pages in dialogs.
- Provides a scan queue, progress updates, cached match details, and local game
  assets.

Supported platforms: **NA1, BR1, LA1, LA2, EUW1, EUN1, TR1**.

The Drew Index is a heuristic score derived from the available match history.
Coverage depends on the matches the upstream services still return. OP.GG and
Rewind can supplement historical rank labels or totals; those aggregates do
not supply the individual matches used as evidence.

## Run locally

Requirements: Node.js **22.13 or newer**, npm, and one
[Riot API key](https://developer.riotgames.com/).

```sh
npm ci
```

Copy `.env.example` to `.env.local` and fill in the single server-side variable:

```dotenv
RIOT_API_KEY=
```

```sh
npm run dev
```

Open [localhost:5173](http://localhost:5173). The key is used only by server-side
API routes. Keep `.env.local` private; Git and Docker builds exclude it.
Restart the application after replacing the token.

For UI previews without Riot requests, use `/?preview=low` or `/?preview=queue`.

## API requests and pacing

All Riot calls go through `lib/riot.ts` and use **one** `RIOT_API_KEY`. Requests
to each routing host share a queue, with a 1.3-second minimum interval between
starts. A 429 response pauses that queue according to `Retry-After`. Temporary
network and server failures receive up to three attempts; a rejected token
returns an error.

The application processes one account scan at a time per running instance.
Analysis results are cached in memory for a short time, and match details are
cached in memory for up to 24 hours. Queue and cache ownership assume a single
application instance. The KV binding stores the counter and progress updates.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run check:secrets
npm run build
```

Tests use deterministic upstream responses and a virtual clock. They do not
need an API key or call Riot. The secret check scans Git's tracked and untracked
publishable files without printing matched secret values.

## Docker

Use Docker Engine on Linux or Docker Desktop with Linux containers. Create
`.env.local` as above, then run:

```sh
docker compose --env-file .env.local up -d --build
```

Open [localhost:4173](http://localhost:4173). Set `DETECTOR_PORT` in `.env.local`
to change the published port. The `detector-state` named volume preserves the
counter and scan progress when the container is replaced.

For Docker without Compose:

```sh
docker build -t drewlevin-detector .
docker run -d --init --name drewlevin-detector -p 4173:4173 --env-file .env.local -v detector-state:/app/.wrangler/state drewlevin-detector
```

The image runs as a non-root user and accepts `RIOT_API_KEY` as a runtime
environment variable. Credentials are excluded from the image build. A health
check monitors the local stats endpoint.

To preview a production build locally without Docker:

```sh
npm run build
npm start
```

## Project layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Search, TLDR, receipts, and evidence dialogs |
| `app/api/analyze/route.ts` | History collection and evidence assembly |
| `app/api/scan-state.ts` | Account queue, progress, and counter |
| `app/api/match/route.ts` | Individual match details |
| `lib/riot.ts` | Single-token Riot client and request pacing |
| `lib/detection-rules.ts` | Detection helpers |
| `lib/match-utils.ts` | Flash, inventory, dates, and Riot ID handling |
| `lib/regions.ts` | Platform and regional routing |
| `public/riot/` | Local champion, item, spell, and rune assets |
| `tests/` | Mocked API and detection regression checks |

## Updating game assets

The repository includes local assets. To refresh them:

```sh
npm run sync-riot-assets
node scripts/sync-historical-runes.mjs
```

These scripts download public Data Dragon and CommunityDragon assets. They do
not use the Riot API token.

## Contributing and licensing

Use `.env.example` for configuration documentation. Keep credentials, local
state, logs, build output, and ownership-verification files out of commits.
Run `npm run check:secrets` before publishing.

Original code is licensed under [MIT](LICENSE). Riot game assets and vendored
files retain their own ownership and terms; see [NOTICE](NOTICE).
