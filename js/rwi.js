// RWI (Relative Work Index): a log's work scaled by goal weight ÷ body weight
// on the day, so the same effort scores higher as you near your goal.
//
// What counts as "work" depends on what was logged:
//   - reps: each set's own reps (js/sets.js), so a short set counts as it was;
//   - distance with a time: km × km/h. Seconds alone rewarded going slowly —
//     a mile walked in 20 min scored three times a 6-min mile — so distance
//     work scales with both how far and how fast: double either, double the
//     RWI. 6-min mile ≈ 25.9, 20-min mile walk ≈ 7.8, 30-min 5K = 50;
//   - run/walk intervals logged against a plan item: the running seconds
//     (rounds × workSec). Whole-session pace is mostly the walking, so
//     km × km/h would score the walk breaks, not the running;
//   - time only (holds, cardio without a distance): seconds, as before.
// Strength work's load-based numbers live in js/load.js; RWI stays the
// "work" view there, and the main one for cardio.
// Always km-based, whatever the display units, so values stay comparable.

import { repsPerSet, timedPerSet, totalTimedSec } from './sets.js';

// { basis: 'reps' | 'run time' | 'distance' | 'time' | null, perSet: number[] }
// before the weight ratio is applied. plannedTarget: the plan item the log
// was logged against, if any (js/load.js → plannedTargetOf).
export function rwiWork(actual, plannedTarget = null) {
  const reps = repsPerSet(actual);
  if (reps.length) return { basis: 'reps', perSet: reps };
  const t = plannedTarget;
  if (t?.kind === 'intervals' && t.rounds > 0 && t.workSec > 0) {
    return { basis: 'run time', perSet: [t.rounds * t.workSec] };
  }
  // Timed sets count every rep's time (2 × 3 × 10s = 60 s).
  const sec = actual?.movingSec ?? (timedPerSet(actual).length ? totalTimedSec(actual) : actual?.durationSec);
  const m = actual?.distanceM;
  if (m > 0 && sec > 0) {
    const km = m / 1000;
    const kmh = km / (sec / 3600);
    return { basis: 'distance', perSet: [km * kmh] };
  }
  if (sec != null) return { basis: 'time', perSet: [sec] };
  return { basis: null, perSet: [] };
}

export const RWI_BASIS_LABEL = { reps: 'reps', 'run time': 'running seconds', distance: 'km × km/h', time: 'seconds' };

// Body weight in effect on a given date: the most recent weigh-in on or
// before it, else the earliest one after.
export function weightOn(date, metrics) {
  const weighed = metrics.filter((m) => m.weight != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!weighed.length) return null;
  let candidate = null;
  for (const m of weighed) {
    if (m.date <= date) candidate = m;
    else break;
  }
  return (candidate ?? weighed[0]).weight;
}
