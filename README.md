# Fitness Tracker & Planner

A single-user fitness tracking and planning web app that runs entirely on
GitHub Pages — no backend. Data is saved as JSON files in this branch via the
GitHub Contents API, with localStorage as a write-through cache so the app
works offline and syncs when you're back online. Polar activities sync in
automatically via a scheduled GitHub Actions workflow, and GPX/TCX files from
any device can be imported directly.

*(This branch is one app in the webApps collection — GitHub Pages serves
whichever branch is selected in the repo's Pages settings.)*

## Features

- **Training Plans** — structured multi-week plans (weeks → sessions → blocks
  → exercises) with phases, deload weeks, and rich targets (rep ranges,
  holds, rest, RPE, variant levels, intervals). List and calendar views;
  multiple concurrent plans. Plans import/export as portable
  `fitness-tracker-plan` v2 JSON (see below).
- **Fitness Library** — the shared exercise library (descriptions, cues,
  safety notes, difficulty variants, per-set RWI history), with import
  (an `exerciseLibrary` map, a whole plan file, a single exercise, or an
  array) and whole-library export (definitions only, no history). Deleting
  an exercise that plans, logs, or goals still reference shows what uses it
  and offers to repoint everything at a replacement, or to archive it
  (hidden from pickers, existing references intact) instead. Plus **Goals**:
  bodyweight targets, run-time goals (1 mile / 5k / 10k / custom), and
  exercise goals, each with live progress against your logs.
  RWI (Relative Work Index) = (reps or seconds per set) × (goal weight ÷
  body weight on the day), normalizing bodyweight work as your weight moves
  toward its goal.
- **Logs** — today's planned session with inline logging, a one-tap morning
  weigh-in on the Today view, ad-hoc entries, filterable history, body metrics
  (weight, body fat %, resting HR, waist — extensible via `BODY_METRICS` in
  `js/config.js`), per-metric trend charts plus pace/distance charts, and a
  plan-adherence percentage.
- **Activity sync** — a scheduled workflow pulls new Polar activities into
  `data/activities/`, and **Logs → History → Import GPX/TCX** brings in files
  from any device. A fuzzy matcher suggests links between synced activities and
  planned sessions (one-tap confirm/reject).
- **GPS heatmap** — accumulated route density across all synced activities
  with GPS data (Leaflet + leaflet.heat, OpenStreetMap tiles).

## Setup

### 1. Enable GitHub Pages

Repo → Settings → Pages → deploy from branch `fitnessTracker`, root folder.
The app then lives at `https://<user>.github.io/webApps/`.

This repo can safely stay **public** — it contains only the app and the
starter presets. Your personal data goes somewhere else entirely:

### 2. Create your private data repo

**No personal data is ever written to this public repo.** The app stores it in
a separate private repo, which is free — only *Pages hosting* from a private
repo needs GitHub Pro, and the app isn't hosted from there.

1. New repository → name it e.g. `fitness-data` → **Private** → tick
   **Add a README** (this creates the default branch, which the API needs).
2. Copy the contents of [`datarepo-template/`](datarepo-template/) into it —
   the Polar sync workflow and its two scripts. That folder has its own README
   with the details.
3. Create a fine-grained token (GitHub → Settings → Developer settings →
   **Fine-grained tokens**):
   - Repository access: **only your new private data repo**
   - Permissions: **Contents: Read and write**, plus **Actions: Read and
     write** for the in-app "Sync activities now" button
   - The token needs *no* access to this public repo, so a leaked token
     cannot modify the deployed app.
4. In the app: ⚙ Settings → **Data repository** → enter owner, repo, and
   branch (`main`) → **Save data repo**, then paste the token below it.
5. Press **Upload all local data** once. The browser cache already holds
   everything, so this seeds the new repo in a single step.

Until a data repo is set, the app runs **local-only** — fully functional, with
everything kept in that browser. That's the deliberate default, so nothing
personal can land somewhere public by accident.

⚠️ If you previously synced real data to a public repo, deleting the files
removes them from the current commit but **not from git history**. Rewrite the
history, or delete and recreate the repo, if that matters to you.

⚙ Settings also has **unit preferences** — weight (kg/lb), distance (km/mi,
which also flips pace between min/km and min/mi), and body measurements
(cm/in). Units are a per-browser display setting: stored JSON, synced activities,
and exported plan templates are always metric (kg / meters / cm), converted
at the UI only, so switching units never rewrites data.

### 3. Activity sync (optional)

Two independent ways to get activities in — use either or both:

**Polar (free API).** Polar AccessLink needs no subscription. The one-time
OAuth bootstrap and the repo secrets it needs are documented in
[`datarepo-template/README.md`](datarepo-template/README.md); the sync workflow
lives in your data repo because that is where it writes. It runs every 4 hours,
or on demand from that repo's Actions tab or the app's "Sync activities now"
button. Polar credentials never reach the browser.

Note that **Polar only exposes the last ~30 days**, and only exercises uploaded
after you register your client, so there is no historical backfill through it.

**GPX/TCX import (no API at all).** Logs → History → **Import GPX/TCX** accepts
files exported from Polar Flow, Garmin Connect, or anything else, several at a
time. This is how you bring in history Polar can't reach, or activities from a
device with no integration. Re-importing the same file is a no-op, so retries
are safe. FIT files are not supported — export TCX or GPX instead.

The picker shows every file rather than filtering by extension, because iOS
greys out any extension it can't map to a system type — `.gpx` and `.tcx`
included — which made the file unselectable. Files are validated by their
contents after you pick them, so a wrong file is rejected with a message and
nothing is written. On iPhone, exports often arrive as a `.zip`: long-press it
in Files, tap Uncompress, then pick the `.gpx` or `.tcx` inside.

> The app used Strava until June 2026, when Strava
> [put its API behind a $11.99/month subscription](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428).
> That pipeline has been removed; any activities already synced from it still
> display, since the app still reads a legacy `data/strava/` folder.

## Encryption (optional)

Now that data lives in a private repo this is defense-in-depth rather than
load-bearing, but it's still worth enabling. Set a password in ⚙ Settings →
Privacy and **logs, body metrics, goals, and all activity shards** are committed
as AES-256-GCM envelopes (key derived from your password with PBKDF2, 310k
iterations) instead of readable JSON. Plans, the exercise library, and match
links stay plaintext. It protects you if the repo is ever made public by
mistake, shared, or exposed by a leaked token.

- For the Polar sync to keep working, add the same password as an Actions
  secret named `ENCRYPTION_PASSWORD` **in the data repo**. If the secret is
  missing while shards are encrypted, the sync fails loudly rather than writing
  mixed plaintext.
- The password is remembered in this browser's localStorage (same trust
  model as the PAT). On a new device, enter it once in Settings to unlock.
- **No recovery**: a lost password makes the encrypted data unreadable.
- Files committed *before* enabling encryption remain readable in git
  history. If that matters, rewrite history or start the data files fresh.
- Disabling encryption in Settings decrypts and re-commits everything as
  plaintext.

## Starter content (`presets/`)

The site ships with ready-made plans and exercise packs in `presets/`. They
load with a plain relative fetch from the same branch — no token, no GitHub
API, no rate limit — so they work in local-only mode and offline once cached.

- **Plans tab → Import → Starter plans** — pick a start date, tap a plan.
- **Fitness Library → Import → Starter packs** — tap a pack to merge it into
  your library (matched by name, so re-importing is a no-op).

Bundled today:

| Preset | What |
|---|---|
| Couch to 10K — 26-Week Conservative Build | 26 weeks, 78 sessions, deloads every 4th week, lower-leg strength in every session |
| Example Plan (edit me) | One week showing every target kind — the best base for writing your own |
| Running & Calisthenics | 26 exercises: running warm-ups, shin/calf prevention work, and a full skill ladder |
| Barbell Basics | Squat, deadlift, bench, overhead press, row, RDL |
| Dumbbell Essentials | Squat, hinge, push, pull, press, lunge with dumbbells and a bench |
| Cardio & Cross-Training | Bike, swim, row, incline walk, elliptical, jump rope |

**Adding your own takes no code**: drop a file in `presets/plans/` or
`presets/exercises/` and add an entry to `presets/index.json` (`name`,
`description`, `file`, plus optional `weeks`/`sessions`/`level` or `count`).

## Plan templates (import / export)

Plans import and export in the **`fitness-tracker-plan` v2 schema**: a
`plan` metadata object (goal, level, durationWeeks…), an `exerciseLibrary`
map of snake_case ids → full exercise definitions (description, cues,
safety notes, variants), optional `phases` and `blockTemplates`, and
`weeks[] → sessions[] → blocks[] → items[]` where each item is an
`exerciseId` reference plus a `target`. Target kinds: `reps` (with `reps`
or `repsMin`/`repsMax`, optional `weight`, `holdSec`), `duration`,
`distance` (with `paceSecPerKm`), and `intervals` (`rounds`, `workSec`,
`recoverySec`); all support `sets`, `restSec`, `rpe`, `tempo`,
`variantLevel`, `perSide`. All stored values are metric.

**Import** (Plans tab) accepts a pasted or uploaded v2 file — older v1
templates still work — and asks for a start date (the calendar day that
`dayOffset: 0` maps to). Library exercises are matched by name,
case-insensitively; missing ones are created with their full definitions,
and `blockTemplates` are materialized into the sessions that reference
them. **Export** (plan detail page) produces the same format; ⚙ Settings
has a starter template download. Scheduling stays relative (dayOffset), so
exported files re-import with any fresh start date.

## Development

No build step — plain ES modules. Serve the branch root over HTTP:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

With no data repo configured the app runs in local-only mode, which is also how
the UI is tested. To test the sync script locally, from a checkout of your data
repo (or `datarepo-template/`):

```sh
POLAR_ACCESS_TOKEN=… POLAR_USER_ID=… node scripts/polar-sync.mjs
```

### Tests

```sh
node tests/run.mjs              # everything
node tests/run.mjs app-settings # one suite
```

The runner starts its own static server and drives the real pages in Chromium.
It also runs ghsync's own suites from `ghsync/tests/`, which import
`playwright` directly — so install it locally (`npm i -D playwright`; it is
gitignored) or symlink a global install into `node_modules/`.
`ghsync/tests/http-cache.test.mjs` needs `openssl` and port 443, and reports
itself skipped where it can't bind that.

### Layout

| Path | What |
|---|---|
| `ghsync/` | **Reusable** private-data-repo sync package — see below |
| `js/config.js` | Tab registry, sport type→category map, data file paths |
| `js/gps.js` | GPX/TCX parsing, track downsampling, polyline encoding |
| `js/storage/store.js` | This app's layer on ghsync: collections, activity shards |
| `js/ui/` | Tab modules (plans, logs, library, heatmap) + shared components |
| `js/matcher.js` | Fuzzy matcher (pure functions) |
| `presets/` | Bundled starter plans and exercise packs (public, non-personal) |
| `datarepo-template/` | Files to copy into your private data repo |
| `tests/` | Playwright suites + the runner (`node tests/run.mjs`) |
| `vendor/` | Vendored Leaflet, leaflet.heat, polyline decoder |

### Reusing the sync layer in another site

Everything that makes "public Pages site, private data repo" work — the
Contents API client, the localStorage cache, the offline queue, conflict
merging, AES-GCM encryption, and the Settings panel for the repo/token/password
— lives in **[`ghsync/`](ghsync/README.md)** and knows nothing about fitness.
Copy that one folder into another GitHub Pages project, call `createStore()`
with your own collections, and render `syncSections()` somewhere:

```js
const store = createStore({ appId: 'notes', files: { notes: 'data/notes.json' } });
```

`ghsync/example/` is a complete working app built that way. This tracker is
just one consumer: `js/storage/store.js` is the app-specific layer on top.
Give each app its own `appId`; apps can share one private data repo as long as
each uses its own **Folder in the repo**.

**Where ghsync comes from.** The package is shared with
[rusty324/homeInventory](https://github.com/rusty324/homeInventory/tree/main/ghsync),
and each copy's `CHANGELOG.md` says which version it is. Whichever repo has
the newer version is current: copy its whole `ghsync/` folder over the other
one (homeInventory's `tools/pack-ghsync.mjs` zips it), never individual files,
then run `node tests/run.mjs`. Version 1.2 was made here, so homeInventory is
behind until it's copied across. If
`ghsync/crypto.js` changed, copy it to `datarepo-template/scripts/crypto.js`
too (and into your data repo's `scripts/`); `tests/crypto-drift.mjs` fails
until you do.

**This repo contains no personal data and no `data/` folder** — `/data/` is
gitignored so a local experiment can't add one. Everything personal lives in
the private data repo, laid out as:

```
data/plans.json  data/exercises.json  data/logs.json
data/metrics.json  data/goals.json  data/matches.json
data/activity-edits.json   # your corrections to synced activities
data/activities/…   # Polar sync workflow writes these
data/imported/…     # the app's GPX/TCX import writes these
```

Data-write ownership there: every file has exactly one writer. The workflow
owns `data/activities/`; the browser owns everything else, including
`data/imported/`. So the two can never conflict. Activity↔plan match decisions
live in `data/matches.json` (browser-owned) rather than in the activity files
themselves.

The same reasoning covers **editing an activity** (tap any row in Logs →
History): name, sport, date, distance, duration, average HR, and free-text
notes. Only the fields you change are written, to `data/activity-edits.json`,
and they are re-applied on top of the synced record every time it's read — so
a re-sync never undoes a correction, and **Reset** puts the original back.
Deleting works the same way: a file you imported is really deleted, while a
workflow-synced activity is hidden through the overlay, since its file isn't
the browser's to rewrite.
