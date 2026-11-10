// Central app configuration. Adding a tab = add an entry to TABS and create
// a module exporting mount(el, ctx) / unmount().

// icon: a key of TAB_ICONS in js/ui/tabbar.js (shown in the phone's bottom bar).
export const TABS = [
  { id: 'plans', label: 'Plans', icon: 'calendar', module: new URL('./ui/plans-tab.js', import.meta.url).href },
  { id: 'logs', label: 'Logs', icon: 'pulse', module: new URL('./ui/logs-tab.js', import.meta.url).href },
  { id: 'library', label: 'Library', icon: 'dumbbell', module: new URL('./ui/library-tab.js', import.meta.url).href },
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
  // One record per (date, planned session) the user finished — full or
  // minimum — and later skips and pain flags. Health data: encrypted.
  sessions: 'data/sessions.json',
  // When sessions actually happen: moves, skips and repeat weeks layered
  // over the plans (js/schedule.js). The plans themselves never change.
  schedule: 'data/schedule.json',
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

// Load models (js/load.js): how an exercise's strength is tracked over time.
// The three below project each set to an estimated rep max with Brzycki,
// eRM = w·(37 − rRef)/(37 − r), and refuse sets over maxReps rather than
// extrapolate. rRef is the rep count reported: 1 = est. 1RM.
export const LOAD_MODELS = {
  e1rm: { rRef: 1, maxReps: 10 }, // barbell compounds
  erm_ref: { rRef: 10, maxReps: 15 }, // dumbbell / machine / isolation; exercise.referenceReps overrides rRef
  bw_e1rm: { rRef: 5, maxReps: 12 }, // bodyweight + weighted bodyweight
};
// Every loadModel value: the three above, plus 'reps' (trend reps at a fixed
// variant), 'duration' (trend hold time) and 'cardio' (RWI, js/rwi.js).
export const LOAD_MODEL_IDS = ['e1rm', 'erm_ref', 'bw_e1rm', 'reps', 'duration', 'cardio'];

// Body position(s) an exercise is done in (exercise.positions; an exercise
// can have several, e.g. a shoulder press standing or seated).
export const POSITIONS = [
  { id: 'standing', label: 'Standing', short: 'Standing' },
  { id: 'sitting', label: 'Sitting', short: 'Sitting' },
  { id: 'lying', label: 'Lying down', short: 'Lying' },
  { id: 'kneeling', label: 'Kneeling / all fours', short: 'Kneeling' },
  { id: 'plank', label: 'Plank / push-up position', short: 'Plank' },
  { id: 'hanging', label: 'Hanging / supported', short: 'Hanging' },
  { id: 'inverted', label: 'Upside down', short: 'Upside down' },
];

// Muscle groups for filtering. Exercises keep their detailed, free-text
// primaryTargets ("latissimus dorsi", "glute medius"…); these patterns map
// that text onto groups at read time — see js/exercise-filters.js.
export const MUSCLE_GROUPS = [
  { id: 'chest', label: 'Chest', match: /chest|\bpec/ },
  { id: 'back', label: 'Back', match: /\blats?\b|latissimus|rhomboid|upper back|\bback\b|\btrap|erector/ },
  { id: 'shoulders', label: 'Shoulders', match: /shoulder|deltoid|\bdelts?\b|rotator cuff|serratus/ },
  { id: 'arms', label: 'Arms', match: /bicep|tricep|forearm|brachi/ },
  { id: 'core', label: 'Core', match: /\bcore\b|\babs?\b|abdomin|oblique|anterior chain/ },
  { id: 'glutes', label: 'Glutes', match: /glute|hip abductor|hip external rotator/ },
  { id: 'quads', label: 'Quads', match: /quad|\blegs?\b/ },
  { id: 'hamstrings', label: 'Hamstrings', match: /hamstring|\blegs?\b/ },
  { id: 'hips', label: 'Hip flexors & adductors', match: /hip flexor|adductor/ },
  { id: 'calves', label: 'Calves & shins', match: /\bcalf|calves|gastrocnemius|soleus|achilles|tibialis|\bankle|\bshin/ },
  { id: 'cardio', label: 'Cardio', match: /cardio/ },
];

// What load an exercise needs, derived from its modality and its (non-
// optional) equipment. Anything needing none of these is bodyweight.
export const WEIGHT_TYPES = [
  { id: 'bodyweight', label: 'Bodyweight (no weights)', short: 'Bodyweight' },
  { id: 'dumbbell', label: 'Dumbbells', short: 'Dumbbells', modality: 'dumbbell', match: /dumbbell/ },
  { id: 'barbell', label: 'Barbell', short: 'Barbell', modality: 'barbell', match: /barbell/ },
  { id: 'kettlebell', label: 'Kettlebell', short: 'Kettlebell', modality: 'kettlebell', match: /kettlebell/ },
  { id: 'band', label: 'Resistance band', short: 'Band', modality: 'band', match: /\bbands?\b/ },
  { id: 'machine', label: 'Machine', short: 'Machine', modality: 'machine', match: /machine|ergometer|\berg\b|treadmill|elliptical|stationary bike|trainer|cable|smith/ },
];

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
  // smooth: shown as a trend (js/trend.js) rather than raw points.
  { id: 'weight', label: 'Weight', unit: 'kg', step: 0.1, dimension: 'weight', smooth: true },
  { id: 'bodyFat', label: 'Body fat', unit: '%', step: 0.1, dimension: null, smooth: false },
  { id: 'restingHr', label: 'Resting HR', unit: 'bpm', step: 1, dimension: null, smooth: false },
  { id: 'waist', label: 'Waist', unit: 'cm', step: 0.5, dimension: 'length', smooth: false },
];

// ---------- Gym-floor logging (js/ui/set-rows.js) ----------

// Weight stepper step, in the DISPLAY unit, by modality (exercise.weightStepKg
// overrides). Bodyweight exercises with added weight use `other`.
export const WEIGHT_STEP = {
  imperial: { barbell: 5, dumbbell: 5, machine: 5, kettlebell: 8, other: 5 },
  metric: { barbell: 2.5, dumbbell: 2, machine: 2.5, kettlebell: 4, other: 2.5 },
};

// Rest timer default when the plan target has no restSec, by exercise
// category. Cardio has no timer.
export const REST_DEFAULT_SEC = { strength: 90, plyometric: 90, skill: 60, other: 60, mobility: 30 };

// Inline set warnings (js/sanity.js). Warn, never block.
export const SANITY = {
  jumpFactor: 3, // weight > 3× the heaviest prior weight…
  jumpMinHistory: 3, // …once there are at least this many prior sets
  unitMixTolerance: 0.01, // within 1% of prior × or ÷ 2.2046 looks like lb/kg mixed up
  maxReps: 100,
  maxDurationSec: 12 * 3600,
  maxFirstWeightKg: 500, // with no history
};

// Progression suggestions (js/progression.js). Starting values, not science:
// tune them here.
export const PROGRESSION = {
  addAfterSessions: 1, // sessions at the top of the range before adding weight
  variantAdvanceAfter: 2, // matches the plan's progressionPolicy.generalRule
  dropAfterSessions: 2, // consecutive sessions with the first set below the range
  layoffDays: 21,
  layoffFactor: 0.9, // unvalidated heuristic; keep configurable
};

// Weight trend (js/trend.js). A heuristic, not medical advice: a loss rate
// above this (% of body weight per week) is flagged as fast.
export const RATE_WARN_PCT = 1.0;

// Weekly review (js/review.js): a weight PR needs at least this many reps.
export const PR_MIN_REPS = 5;

// The minimum session (js/minimum.js): a derived, half-volume version of a
// planned session for busy or flat days. Warm-up and cool-down stay whole.
export const MIN_SESSION = { factor: 0.5 };
