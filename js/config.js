// Central app configuration. Adding a tab = add an entry to TABS and create
// a module exporting mount(el, ctx) / unmount().

export const TABS = [
  { id: 'plans', label: 'Plans', module: new URL('./ui/plans-tab.js', import.meta.url).href },
  { id: 'logs', label: 'Logs', module: new URL('./ui/logs-tab.js', import.meta.url).href },
  { id: 'library', label: 'Fitness Library', module: new URL('./ui/library-tab.js', import.meta.url).href },
];

export const DEFAULT_TAB = 'logs';

// Where the app itself is served from (public). Shown in Settings; the app
// never writes here.
export const APP_REPO = {
  owner: 'rusty324',
  repo: 'FitnessTracker',
  branch: 'main',
};

// Where personal data is stored — a SEPARATE PRIVATE repo, configured at
// runtime in Settings and kept in localStorage. Deliberately unset by
// default: with no data repo the app stays local-only rather than writing
// personal data somewhere public by accident. See README → "Where your
// data lives".
export const DATA_REPO_DEFAULT = null;

// Data files, relative to repo root. The browser owns all of these.
// data/activities/** is owned by the Polar sync workflow and is read-only here.
export const DATA_FILES = {
  plans: 'data/plans.json',
  exercises: 'data/exercises.json',
  logs: 'data/logs.json',
  metrics: 'data/metrics.json',
  matches: 'data/matches.json',
  goals: 'data/goals.json',
  // Per-activity corrections (name, sport, date, distance…). An overlay rather
  // than in-place edits, because most activity shards belong to the sync
  // workflow and the browser must not write them — see store.js.
  activityEdits: 'data/activity-edits.json',
  // Shoes, bikes and other kit whose mileage is tracked (see js/cardio.js).
  gear: 'data/gear.json',
};
// Synced activities, split by writer so the two can never conflict:
//   ACTIVITY_DIR — written only by the Polar sync workflow (Actions)
//   IMPORT_DIR   — written only by the browser (GPX/TCX file import)
//   LEGACY_STRAVA_DIR — read-only; Strava paywalled its API in June 2026, so
//                       the pipeline is gone, but old shards still display.
export const ACTIVITY_DIR = 'data/activities';
export const IMPORT_DIR = 'data/imported';
export const LEGACY_STRAVA_DIR = 'data/strava';

// Exercise taxonomy, aligned with the fitness-tracker-plan v2 schema.
export const CATEGORIES = ['cardio', 'strength', 'mobility', 'plyometric', 'skill', 'other'];
export const MODALITIES = ['run', 'walk', 'bike', 'swim', 'row', 'bodyweight', 'barbell', 'dumbbell', 'machine', 'band', 'stretch', 'mobility', 'other'];
export const MEASUREMENT_TYPES = ['reps', 'duration', 'distance', 'intervals'];

// Sport type -> exercise taxonomy, for fuzzy matching. When a modality is
// given the matcher prefers it; category is the fallback. Keys are looked up
// case-insensitively (see sportMapping below) because Polar uses
// UPPER_SNAKE_CASE, Strava used PascalCase, and imported GPX/TCX files carry
// whatever their exporter wrote.
export const SPORT_TYPE_MAP = {
  // Polar
  running: { category: 'cardio', modality: 'run' },
  treadmill_running: { category: 'cardio', modality: 'run' },
  trail_running: { category: 'cardio', modality: 'run' },
  road_running: { category: 'cardio', modality: 'run' },
  walking: { category: 'cardio', modality: 'walk' },
  hiking: { category: 'cardio', modality: 'walk' },
  cycling: { category: 'cardio', modality: 'bike' },
  indoor_cycling: { category: 'cardio', modality: 'bike' },
  mountain_biking: { category: 'cardio', modality: 'bike' },
  swimming: { category: 'cardio', modality: 'swim' },
  pool_swimming: { category: 'cardio', modality: 'swim' },
  open_water_swimming: { category: 'cardio', modality: 'swim' },
  rowing: { category: 'cardio', modality: 'row' },
  indoor_rowing: { category: 'cardio', modality: 'row' },
  strength_training: { category: 'strength' },
  functional_training: { category: 'strength' },
  other_indoor: { category: 'other' },
  other_outdoor: { category: 'cardio' },
  // Strava / generic exporters (legacy shards and imported files)
  run: { category: 'cardio', modality: 'run' },
  trailrun: { category: 'cardio', modality: 'run' },
  virtualrun: { category: 'cardio', modality: 'run' },
  walk: { category: 'cardio', modality: 'walk' },
  hike: { category: 'cardio', modality: 'walk' },
  ride: { category: 'cardio', modality: 'bike' },
  mountainbikeride: { category: 'cardio', modality: 'bike' },
  gravelride: { category: 'cardio', modality: 'bike' },
  virtualride: { category: 'cardio', modality: 'bike' },
  ebikeride: { category: 'cardio', modality: 'bike' },
  biking: { category: 'cardio', modality: 'bike' },
  swim: { category: 'cardio', modality: 'swim' },
  weighttraining: { category: 'strength' },
  workout: { category: 'strength' },
  crossfit: { category: 'strength' },
};

// Case- and separator-insensitive lookup, so "TREADMILL_RUNNING",
// "Treadmill running", and "treadmill-running" all resolve.
export function sportMapping(type) {
  const key = String(type ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return SPORT_TYPE_MAP[key] ?? { category: 'other' };
}

// Fuzzy matcher: how many days a plan session may differ from the
// activity date and still be considered a candidate.
export const MATCH_WINDOW_DAYS = 1;

// Cardio modalities: an exercise with one of these (or category 'cardio')
// gets the cardio log form, and gear can be the default for each.
export const CARDIO_SPORTS = [
  { id: 'run', label: 'Running' },
  { id: 'walk', label: 'Walking / hiking' },
  { id: 'bike', label: 'Cycling' },
  { id: 'swim', label: 'Swimming' },
  { id: 'row', label: 'Rowing' },
];

// Gear kinds. `sports` is what a new item defaults to; `alert` is a common
// replace-at distance per display unit (shoes are usually retired at
// 300–500 mi), offered as a starting point and editable.
export const GEAR_KINDS = [
  { id: 'shoes', label: 'Shoes', icon: '👟', sports: ['run'], alert: { mi: 400, km: 650 } },
  { id: 'bike', label: 'Bike', icon: '🚲', sports: ['bike'], alert: null },
  { id: 'other', label: 'Other', icon: '🎒', sports: [], alert: null },
];

export const TARGET_KINDS = [
  { id: 'reps', label: 'Sets × Reps' },
  { id: 'distance', label: 'Distance / Pace' },
  { id: 'duration', label: 'Duration' },
  { id: 'intervals', label: 'Intervals' },
];

// Presets for run-time goals (Fitness Library → Goals).
export const RUN_GOAL_PRESETS = [
  { label: '1 mile', distanceM: 1609 },
  { label: '5k', distanceM: 5000 },
  { label: '10k', distanceM: 10000 },
  { label: 'Half marathon', distanceM: 21097 },
  { label: 'Marathon', distanceM: 42195 },
];

export const SYNC_WORKFLOW_FILE = 'polar-sync.yml';

// Body metrics the Metrics view can record. Adding a metric here is all
// that's needed — the entry modal, charts, and history list derive from it.
// unit/step are the metric (canonical) defaults; entries with a `dimension`
// are shown in the user's preferred unit via units.js resolveMetric().
export const BODY_METRICS = [
  { id: 'weight', label: 'Weight', unit: 'kg', step: 0.1, dimension: 'weight' },
  { id: 'bodyFat', label: 'Body fat', unit: '%', step: 0.1, dimension: null },
  { id: 'restingHr', label: 'Resting HR', unit: 'bpm', step: 1, dimension: null },
  { id: 'waist', label: 'Waist', unit: 'cm', step: 0.5, dimension: 'length' },
];
