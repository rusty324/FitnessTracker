# Fitness Tracker — briefing for AI assistants

Read this first. It's the shortest path to being useful in this repo.

## What this is

A **single-user fitness tracker and planner** for one person (the owner,
`rusty324`), used mostly on an **iPhone**. It is a static site on **GitHub
Pages**: no backend, no build step, no dependencies — plain HTML/CSS and native
ES modules, with third-party libs vendored in `vendor/` (no CDNs). The owner
iterates by asking for features in chat and testing on their phone, so
mobile behaviour matters (iOS quirks have bitten before — see Gotchas).

Four areas, in tabs:

- **Plans** — multi-week training plans (weeks → sessions → blocks →
  exercises) with rich targets; import/export as `fitness-tracker-plan` v2 JSON.
  Bundled starter plans/exercise packs live in `presets/`.
- **Logs** — Today (planned session, one-tap weigh-in, ad-hoc logging),
  History (manual logs + synced/imported activities), Metrics (weight/pace
  charts, adherence), Heatmap (Leaflet GPS density).
- **Fitness Library** — Exercises (search + filters by muscle group, weights
  needed, position), Goals (bodyweight, run times, exercise), Gear (mileage).
- **Settings (⚙)** — data repo, GitHub token, encryption, units, templates.

## The most important design decision: where data lives

The app repo is **public and holds no personal data**. Personal data goes to a
**separate private GitHub repo** (the "data repo"), read/written from the
browser through the GitHub Contents API with a fine-grained PAT, cached in
`localStorage`. With no data repo configured the app is **local-only**
(deliberate default). Optional AES-256-GCM encryption covers logs, metrics,
goals, gear, activity edits and activity shards (plans/exercises/matches stay
plaintext).

This sync layer is a reusable package, **`ghsync/`** (v1.2), shared with a
sibling repo `rusty324/homeInventory`. **Read `ghsync/CLAUDE.md`** before
touching sync, storage, or the settings sections. Key invariants: one writer
per repo file; never write a bare `null`; never guess a file's shape (refuse
with `ShapeError` rather than overwrite); the token never touches the DOM.
`js/storage/store.js` is this app's thin layer on top (collections, activity
shards, the edit overlay).

A scheduled **GitHub Actions workflow lives in the data repo** (template in
`datarepo-template/`), not here: it pulls new activities from the **Polar
AccessLink API** (free; Strava was removed in 2026 when it paywalled its API).
It owns `data/activities/`; the browser owns everything else, including
`data/imported/` (GPX/TCX file imports) and `data/activity-edits.json` (user
corrections layered over synced activities — the app never edits the workflow's
files). `datarepo-template/scripts/crypto.js` must stay **byte-identical** to
`ghsync/crypto.js` (a test enforces it).

## Data conventions

- **Canonical units in storage:** kg, meters, sec/km, cm. Conversion to
  lb/mi/in happens only at the UI edge (`js/units.js`). An untouched converted
  field must save its original value exactly (no 20 kg → 19.99).
- **Logs** (`data/logs.json`): `{id,date,exerciseId,planId,plannedExerciseId,actual,rpe,notes}`.
  `actual` shapes: strength `{sets,reps,weight}` — or, when sets differ,
  `setReps:[…]` and/or `setWeights:[…]` (0 = bodyweight, null = not recorded);
  everything reads through `js/sets.js`. Cardio `{movingSec,distanceM,avgHr,
  maxHr,calories,elevationM,environment,gearId}` (`js/cardio.js`).
- **Activities** (synced/imported): same cardio fields plus `id,date,name,type,
  source,gpsPolyline`. Matching to plan sessions is a fuzzy matcher
  (`js/matcher.js`) with decisions stored in `data/matches.json`.
- **Gear** (`data/gear.json`): mileage is **computed**, never stored — the sum
  of cardio entries using it (explicitly, or as the default for its sport on
  that date) plus a starting distance. Newest default wins; retired gear keeps
  its history.
- **Exercises** have free-text `primaryTargets`/`equipment` (v2 schema shape);
  filters map them onto muscle groups/weight types at read time
  (`js/exercise-filters.js`, patterns in `js/config.js`). `positions` is a
  list of position ids. Optional `gif` on an exercise and on each variant:
  an `https://` link or `media:<id>` — an upload stored by `store.media`
  (ghsync blobs) at `data/media/<id>.json`, mirrored to IndexedDB `ft.media`.
- **Exercise import** (`js/exercise-io.js`): a user's file *updates* what it
  matches (by `id`, else by normalised name — a name match never renames)
  and adds the rest, after a preview; starter packs only fill blanks
  (`libraryUpserter`). Library exports carry ids so a round trip updates in
  place. Names ending "(example)" are skipped (the downloadable template).
- **Load metrics** (`js/load.js`, pure): optional exercise `loadModel`
  (`e1rm | erm_ref | bw_e1rm | reps | duration | cardio`; inferred from
  modality when absent), `referenceReps` (erm_ref), `bodyweightFraction`
  (exercise-level, or per `variants[]` entry; `null` = not comparable by
  load). Logs may carry `actual.variantLevel`; otherwise the level comes from
  the linked plan item's target. Session value = best set's Brzycki
  `w·(37−rRef)/(37−r)`, null over the model's rep cap (never extrapolate).
  Goal-weight scaling is display-only (`ft.loadScale` in localStorage) —
  never store a scaled number. RWI (`js/rwi.js`) remains the "work" view
  and the main one for cardio. Variant levels are positional: changing a
  ladder's order breaks plans and logs that reference levels, so ladder
  fixes need a migration (`js/preset-sync.js` has the Push-Up one).
- **Session dates come only from `js/schedule.js`** (`effectiveSessionDate`,
  `occurrences`, `plannedBetween`, `nextPlannedFor`). Never compute
  `addDays(plan.startDate, dayOffset)` elsewhere — `tests/app-schedule.mjs`
  scans for it. `data/schedule.json` (encrypted) is a ghsync collection of
  `{id:'<planId>:<sessionId>', kind:'move'|'skip', planId, sessionId, date}`
  and `{id:'repeat:…', kind:'repeat', …, date}`: slides, skips and repeated
  weeks layered over plans, which are never edited for them.
- **Sessions** (`data/sessions.json`, encrypted): `{id:'<date>:<plannedSessionId>',
  date, plannedSessionId, planId, kind:'full'|'minimum', repeat?, pain?:
  {level:'none'|'niggle'|'pain', regions?}}` written by "Finish session" and
  the pain question after it (`js/pain.js`: same-region niggles twice running
  = pain; the plan's `injuryRule` is shown verbatim, never paraphrased). A planned session is **completed** when it has such a record *or*
  at least one of its items has a linked log / confirmed match (lenient on
  purpose: old sessions were logged piecemeal)
  (`js/sessions.js` — the only definition; reuse it).
- **Gym-floor drafts**: ticking a set writes `localStorage`
  `ft.draft.<date>.<sessionId|adhoc>`, never the repo; drafts become logs when an
  exercise's sets are all ticked, on Finish, and on pagehide/hidden (and on the
  next load). Deletes of sets/log entries use an Undo toast; `store.removeLater`
  hides the record until the toast expires, then removes it.
- **Suggestions are derived, never stored** (progression, weight trend, weekly
  review). Only user-confirmed facts are persisted. Logs may carry
  `mode:'minimum'`; such sessions never qualify a progression.
- Old data must keep working: shapes only ever **add** optional fields, and
  readers handle every older shape.

## Code map

| Path | What |
|---|---|
| `index.html`, `css/main.css` | Shell and all styles (CSS variables, dark-mode aware) |
| `js/app.js` | Boot, settings modal, sync badge (click it for the copyable error report) |
| `js/config.js` | Tabs, data paths, taxonomies, sport map, gear kinds, muscle/position lists |
| `js/models.js` | Record factories and v1→v2 migrations |
| `js/storage/store.js` | App layer over ghsync |
| `js/ui/*-tab.js`, `gear-view.js` | The tabs; `cardio-form.js` and `set-rows.js` (stepper set rows, Today + log form) are the shared entry forms |
| `js/history.js`, `js/sanity.js`, `js/sessions.js` | Pure: last performance / ghosts, inline set warnings, the one "completed session" rule |
| `js/progression.js`, `js/ui/suggestion.js` | Pure next-time suggestions (double / variant progression, `PROGRESSION` in config) and their chip / Next time card |
| `js/trend.js`, `js/review.js` | Pure weight trend (time-aware EMA; rate/ETA from OLS on raw weights) and the weekly review (sessions, PRs, volume, one recommendation) |
| `js/schedule.js`, `js/minimum.js`, `js/pain.js` | Pure: the one session-date function + slide/skip/repeat; the derived minimum session; pain escalation and rules |
| `js/draft.js`, `js/rest-timer.js` | Gym-floor drafts (localStorage, flushed to logs) and the rest timer / wake lock |
| `js/exercise-io.js`, `js/ui/media.js` | Pure exercise import planning + template; exercise GIFs (link/upload, card, thumb, lightbox) |
| `js/ui/exercise-filter-bar.js` | Exercise search + muscle/weights/position filters, shared by the Library list and the exercise picker |
| `js/ui/layout.js` | `isDesktop()` (wide + mouse, the CSS's desktop query); desktop-redesigned views add `wide` to `#view` (1200px, `.two-col` → `.col-main` + `.col-side`) |
| `js/ui/exercise-desktop.js` | Desktop exercise page: library sidebar, Next time + the rule, top set by session, what the rule said per session (replayed) |
| `js/ui/tabbar.js` | Hash router `#/<tab>[/<path>]`; tabs may export `route(path)` |
| `js/cardio.js`, `js/sets.js`, `js/gps.js` | Pure helpers (gear, per-set math, GPX/TCX parsing) |
| `js/load.js`, `js/rwi.js` | Pure strength-load (Brzycki eRM) and RWI math |
| `js/preset-sync.js` | Once per load: fill empty library fields from `presets/`, ladder migrations |
| `ghsync/` | The sync package (own README, CLAUDE.md, tests) |
| `datarepo-template/` | Files the owner copies into the private data repo |
| `presets/` | Bundled plans + exercise packs |
| `tests/` | Playwright suites + runner |

## Working here

- **Run tests before every push:** `node tests/run.mjs` (starts its own static
  server, runs this repo's suites and ghsync's; needs `playwright` resolvable —
  e.g. symlink the global install into `node_modules/`). ~300 checks, all
  should be green. Subset: `node tests/run.mjs app-sets`.
- **Add a test with every change.** Suites drive the real pages in Chromium;
  `tests/lib.mjs` has `stubGithub()` for a fake GitHub API. Prefer asserting
  stored data and visible behaviour; for UI, also check phone width (390px).
- Develop on `main` and push straight to it (the owner's preference; no PRs
  unless asked). Commit messages explain *why*.
- **No build, no CDN, no new dependencies.** Vendor anything needed.
- Match the surrounding style: small modules, comments that say why, UI built
  with the `el()` helper in `js/ui/components.js` (no framework).
- Never put personal data, tokens or passwords in the repo or logs.

## Gotchas learned the hard way

- **iOS Safari:** `accept=` on file inputs greys out `.gpx/.tcx/.json` — pickers
  have none (`filePicker()`); date inputs ignore `width:100%` unless
  `appearance:none; min-width:0`; the number pad has **no colon** (duration
  fields format digits like a timer: `4530` → `45:30`); a home-screen app has
  storage separate from Safari. Chromium can't reproduce WebKit bugs, so tests
  check the preventing CSS/behaviour instead.
- `a ?? b || c` is a JS syntax error — parenthesise.
- GitHub API reads are HTTP-cached ~60 s: all reads use `cache: 'no-store'`.
- Polar only exposes ~30 days and its transactional endpoints discard data on
  commit, so the sync script commits only *after* writing shards.
- Imported/synced names can be long unbroken strings — row titles wrap and clamp.

## History (what was built, roughly in order)

1. App per the owner's brief: plans, logs, library, Polar-then-Strava sync,
   Leaflet heatmap, GitHub-API persistence with localStorage write-through.
2. Plan import/export (v2 schema) and editable templates; goals; RWI
   (relative work index = reps or seconds × goal weight ÷ body weight);
   exercise library tab, import/export, safe deletion with replace/archive.
3. Body metrics + weigh-in; unit preferences; encryption; separate private
   data repo (after the owner worried about personal data in a public repo).
4. Strava → Polar AccessLink + GPX/TCX import; activity editing/hiding via an
   overlay; Settings rebuilt as a checklist with collapsible sections.
5. Extracted the sync layer into **ghsync**; upgraded to 1.1 (from homeInventory),
   then 1.2 (refuse unknown file shapes; "sync error" with copyable report).
6. Cardio logging (duration, distance, HR, calories, elevation,
   treadmill/outside, gear) and Gear mileage tracking.
7. Library search/filters; exercise names link to library pages; reps and
   weight **per set** in a table with a bodyweight toggle; iPhone fixes.
8. Moved to this repo (`rusty324/FitnessTracker`) from a branch of
   `rusty324/webApps`, history preserved.
9. Desktop layout; RWI counts distance × speed for cardio; load metrics
   (Brzycki eRM per load model, variant select in the log form, Load index
   card) and the Push-Up ladder fix (Wall → One-Arm, so plan levels match).
10. Adherence-first revamp (owner's spec + mockups), phase by phase: restyle
    (teal theme, bottom tab bar, page titles, heatmap inside Metrics), then
    Phase A gym-floor logging (set rows with ghosts and one-tap ✓, drafts,
    rest timer, sanity warnings, Undo, Finish session + sessions.json), then
    Phase B progression suggestions (chip on Today with suggested ghosts,
    Next time card; derived at read time, never stored), then Phase C weight
    trend (trend is the headline; raw weigh-ins are muted dots with neutral
    deltas — never red/green) and the weekly Review sub-tab + Today banner,
    then Phase D: one session-date function with slide/skip for overdue
    sessions, the derived minimum session (counts as completed, never
    progresses), pain flags with the plan's injury rule and repeat-week,
    and weekly dots ("2 of 3 this week") instead of an adherence %.

## Ideas not built yet

Exercise names on the Plans tab as links; per-set timed holds; editing
variant ladders (and their fractions) in the UI; RIR logging; a Google Drive
backup (owner prefers a visible folder via `drive.file`, plaintext); copying
ghsync 1.2 back to homeInventory.
