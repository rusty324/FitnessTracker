// Cardio logging and gear mileage: pure functions over plain data, shared by
// the log form, the activity editor, history rows and the Gear view.
//
// Cardio fields live in the same shape everywhere — a manual log's `actual`,
// and a synced/imported activity record — all canonical units:
//   movingSec, distanceM, avgHr, maxHr, calories, elevationM (gain, meters),
//   environment ('outdoor' | 'indoor'), gearId (see below).

import { CARDIO_SPORTS, sportMapping } from './config.js';

const CARDIO_IDS = CARDIO_SPORTS.map((s) => s.id);

export const CARDIO_FIELDS = [
  'distanceM', 'movingSec', 'avgHr', 'maxHr', 'calories', 'elevationM', 'environment', 'gearId',
];

// An exercise gets the cardio form when it's cardio by category or by
// modality. (Most cardio exercises measure by duration, so measurementType
// can't decide this.)
export function isCardioExercise(ex) {
  return !!ex && (ex.category === 'cardio' || CARDIO_IDS.includes(ex.modality));
}

// Data first: an entry holding any cardio field is cardio, even if the
// exercise it referenced has since been deleted.
export function hasCardioData(actual) {
  return !!actual && CARDIO_FIELDS.some((k) => actual[k] != null);
}

// h:mm:ss / mm:ss / ss -> seconds. NaN signals "typed something unusable",
// which the caller reports rather than silently storing a wrong duration.
export function parseHms(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || !Number.isFinite(+p) || +p < 0)) return NaN;
  return Math.round(parts.reduce((acc, p) => acc * 60 + +p, 0));
}
export function formatHms(sec) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Timer-style entry: digits fill from the right, colons are implied.
// "4530" -> "45:30", "13000" -> "1:30:00", "5" -> "0:05". Up to six digits
// (99:59:59); leading zeros mean nothing and all-zero is empty, so
// backspacing all the way down clears the field.
export function digitsToHms(raw) {
  const d = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 6);
  if (!d) return '';
  const ss = d.slice(-2).padStart(2, '0');
  const rest = d.slice(0, -2);
  if (!rest) return `0:${ss}`;
  if (rest.length <= 2) return `${+rest}:${ss}`;
  return `${+rest.slice(0, -2)}:${rest.slice(-2)}:${ss}`;
}

// ---------- gear ----------
// gearId on an entry: absent = the default gear for its sport on that date,
// NO_GEAR = explicitly none, anything else = that gear's id. Defaults are
// resolved at read time, so synced activities count toward your shoes
// without being edited one by one, and changing a default re-attributes
// every run that didn't name its gear.
export const NO_GEAR = 'none';

export function inService(gear, date) {
  return (!gear.addedOn || date >= gear.addedOn) && (!gear.retiredOn || date <= gear.retiredOn);
}

// The gear a new or unassigned activity of this sport on this date uses. If
// two defaults overlap, the most recently added wins — so adding new shoes
// takes over from the old pair without having to touch it.
export function defaultGear(gearList, sport, date) {
  if (!sport) return null;
  return gearList
    .filter((g) => g.isDefault && (g.sports ?? []).includes(sport) && inService(g, date))
    .sort((a, b) => ((a.addedOn ?? '') < (b.addedOn ?? '') ? 1 : -1))[0] ?? null;
}

// item: { gearId, sport, date }
export function resolveGear(gearList, item) {
  if (item.gearId === NO_GEAR) return null;
  if (item.gearId) return gearList.find((g) => g.id === item.gearId) ?? null;
  return defaultGear(gearList, item.sport, item.date);
}

// The sport an entry counts as, for gear defaults.
export function sportOf(item, exercise) {
  if (exercise) return CARDIO_IDS.includes(exercise.modality) ? exercise.modality : null;
  const m = sportMapping(item.type).modality;
  return CARDIO_IDS.includes(m) ? m : null;
}

// Every cardio entry, manual and synced, normalized for gear and stats:
// { ref: {kind, id}, date, name, sport, ...cardio fields }.
//
// A manual log for a planned item that an activity is also confirmed against
// is the same workout recorded twice; only the activity counts, or mileage
// would double.
export function cardioItems({ logs = [], activities = [], exercises = [], matches = [] }) {
  const lib = new Map(exercises.map((e) => [e.id, e]));
  const coveredByActivity = new Set(matches
    .filter((m) => m.status === 'confirmed' && m.plannedExerciseId)
    .map((m) => m.plannedExerciseId));
  const out = [];
  for (const l of logs) {
    const ex = lib.get(l.exerciseId);
    const a = l.actual ?? {};
    if (!isCardioExercise(ex) && !hasCardioData(a)) continue;
    if (l.plannedExerciseId && coveredByActivity.has(l.plannedExerciseId)) continue;
    out.push({ ...a, ref: { kind: 'log', id: l.id }, date: l.date, name: ex?.name ?? 'Activity', sport: sportOf(l, ex) });
  }
  for (const e of activities) {
    out.push({ ...e, ref: { kind: 'activity', id: e.id }, date: e.date, name: e.name || e.type, sport: sportOf(e, null) });
  }
  return out;
}

// gear id -> { distanceM (incl. starting distance), count, movingSec, lastUsed, items }
export function gearStats(gearList, items) {
  const stats = new Map(gearList.map((g) => [g.id, {
    distanceM: g.startDistanceM || 0, count: 0, movingSec: 0, lastUsed: null, items: [],
  }]));
  for (const it of items) {
    const g = resolveGear(gearList, it);
    if (!g) continue;
    const s = stats.get(g.id);
    s.count++;
    s.distanceM += it.distanceM || 0;
    s.movingSec += it.movingSec || 0;
    if (!s.lastUsed || it.date > s.lastUsed) s.lastUsed = it.date;
    s.items.push(it);
  }
  for (const s of stats.values()) s.items.sort((a, b) => (a.date < b.date ? 1 : -1));
  return stats;
}
