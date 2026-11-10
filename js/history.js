// What you did last time, for the gym floor: ghost values in the set rows,
// and later the evidence behind progression suggestions. Pure.

import { repsPerSet, weightsPerSet } from './sets.js';
import { variantLevelFor } from './load.js';

// Most recent log of the exercise strictly before `beforeDate`. When the
// exercise has variants, only logs at `variantLevel` count (a level-3 push-up
// says nothing about level 4); the level of each log resolves as the load
// metrics do — its own, else its plan item's.
// -> { date, variantLevel, logId, sets: [{ reps, weightKg, durationSec }] } | null
export function lastPerformance({ exerciseId, variantLevel = null, logs = [], beforeDate, exercise = null, plans = [] }) {
  const hasLadder = !!exercise?.variants?.length;
  const candidates = logs
    .filter((l) => l.exerciseId === exerciseId && (!beforeDate || l.date < beforeDate))
    .filter((l) => !hasLadder || variantLevel == null || variantLevelFor(l, plans) === variantLevel)
    .filter((l) => setsOf(l).length)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const log = candidates[0];
  if (!log) return null;
  return { date: log.date, variantLevel: variantLevelFor(log, plans), logId: log.id, sets: setsOf(log) };
}

export function setsOf(log) {
  const a = log?.actual ?? {};
  const reps = repsPerSet(a);
  const kg = weightsPerSet(a);
  if (reps.length) return reps.map((r, i) => ({ reps: r, weightKg: kg[i] ?? null, durationSec: null }));
  if (a.durationSec != null) {
    return Array.from({ length: Math.max(1, a.sets ?? 1) }, () => ({ reps: null, weightKg: null, durationSec: a.durationSec }));
  }
  return [];
}

// Set i of last time; with fewer sets then, the last one repeats.
export function ghostSet(perf, i) {
  if (!perf?.sets?.length) return null;
  return perf.sets[Math.min(i, perf.sets.length - 1)];
}
