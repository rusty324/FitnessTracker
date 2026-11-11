// Reps and weight logged per set. Sets that all match keep the original
// shape { sets, reps, weight }; when they differ the list is stored instead —
// setReps: [20, 20, 18, 15, 12] and/or setWeights: [50, 50, 45, 0, null] —
// with no single value. Weights are kg; 0 means bodyweight only (no added
// load), null that no weight was recorded for that set. Everything that
// reads sets goes through these helpers, so every shape reads the same.

import { formatWeight } from './units.js';

export function repsPerSet(actual) {
  if (!actual) return [];
  if (Array.isArray(actual.setReps) && actual.setReps.length) return actual.setReps;
  if (actual.reps != null) return Array(Math.max(1, actual.sets ?? 1)).fill(actual.reps);
  return [];
}

// One entry per set (kg, 0 = bodyweight, null = not recorded), or [] if no
// weight was logged at all.
export function weightsPerSet(actual) {
  if (!actual) return [];
  if (Array.isArray(actual.setWeights) && actual.setWeights.length) return actual.setWeights;
  if (actual.weight != null) return Array(Math.max(1, repsPerSet(actual).length || actual.sets || 1)).fill(actual.weight);
  return [];
}

// The stored fields for per-set reps (blank sets already removed).
export function setFields(list) {
  if (!list.length) return {};
  return list.every((r) => r === list[0])
    ? { sets: list.length, reps: list[0] }
    : { sets: list.length, setReps: list };
}

// The stored weight fields for per-set weights, matching setFields.
export function weightFields(list) {
  if (!list.length || list.every((w) => w == null)) return {};
  return list.every((w) => w === list[0]) ? { weight: list[0] } : { setWeights: list };
}

export const totalReps = (actual) => repsPerSet(actual).reduce((a, b) => a + b, 0);

const weightText = (kg) => (kg === 0 ? 'bodyweight' : formatWeight(kg));

// "5 × 20", "5 × 20 @ 50 kg", "3 × 10 @ bodyweight",
// "5 sets: 20, 20, 18, 15, 12 @ 50 kg",
// "4 sets: 10 @ 60 kg, 8 @ 60 kg, 8 @ 55 kg, 12 @ bodyweight".
export function formatSets(actual) {
  if (isTimedActual(actual)) return ''; // formatTimedSets says those
  const reps = repsPerSet(actual);
  const weights = weightsPerSet(actual);
  if (!reps.length) {
    if (!actual?.sets) return '';
    return weights.length && weights.every((w) => w === weights[0]) && weights[0] != null
      ? `${actual.sets} sets @ ${weightText(weights[0])}` : `${actual.sets} sets`;
  }
  const sameReps = reps.every((r) => r === reps[0]);
  const sameWeight = weights.every((w) => w === weights[0]);
  if (!weights.length || sameWeight) {
    const base = sameReps ? `${reps.length} × ${reps[0]}` : `${reps.length} sets: ${reps.join(', ')}`;
    return weights.length && weights[0] != null ? `${base} @ ${weightText(weights[0])}` : base;
  }
  return `${reps.length} sets: ${reps.map((r, i) => (weights[i] == null ? `${r}` : `${r} @ ${weightText(weights[i])}`)).join(', ')}`;
}

// ---------- timed sets (planks, holds, stretches) ----------
//
// Sets × reps × time per rep, the timed twin of reps × weight. Kept in their
// own fields, not reps/setReps, so reps-based maths (load, RWI, progression,
// rep PRs) never mistakes a 1-rep plank for a set of one:
//   all sets alike  { sets: 2, holdReps: 1, holdSec: 20 }
//   sets differ     { sets: 3, setHoldReps: [1, 1, 2], setHoldSec: [30, 25, 20] }
//                   (either list may stand alone beside the other's single value)
// Older timed logs held one number, durationSec: read as one set of one rep
// (or `sets` sets of it, if a count was stored beside it).

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function isTimedActual(actual) {
  if (!actual) return false;
  return actual.holdSec != null || Array.isArray(actual.setHoldSec)
    || (actual.durationSec != null && actual.movingSec == null && actual.distanceM == null && !repsPerSet(actual).length);
}

// One { reps, sec } per set, or [] when the entry isn't timed.
export function timedPerSet(actual) {
  if (!actual) return [];
  const secs = Array.isArray(actual.setHoldSec) && actual.setHoldSec.length ? actual.setHoldSec : null;
  const reps = Array.isArray(actual.setHoldReps) && actual.setHoldReps.length ? actual.setHoldReps : null;
  if (secs || reps || actual.holdSec != null) {
    const n = secs?.length ?? reps?.length ?? Math.max(1, actual.sets ?? 1);
    return Array.from({ length: n }, (_, i) => ({
      reps: reps ? reps[i] ?? null : actual.holdReps ?? 1,
      sec: secs ? secs[i] ?? null : actual.holdSec ?? null,
    }));
  }
  if (isTimedActual(actual) && isNum(actual.durationSec)) {
    return Array.from({ length: Math.max(1, actual.sets ?? 1) }, () => ({ reps: 1, sec: actual.durationSec }));
  }
  return [];
}

// The stored fields for a list of { reps, sec } (blank sets already removed).
export function timedFields(list) {
  if (!list.length) return {};
  const reps = list.map((s) => s.reps ?? 1);
  const secs = list.map((s) => s.sec);
  return {
    sets: list.length,
    ...(reps.every((r) => r === reps[0]) ? { holdReps: reps[0] } : { setHoldReps: reps }),
    ...(secs.every((s) => s === secs[0]) ? { holdSec: secs[0] } : { setHoldSec: secs }),
  };
}

// Time under tension: every rep of every set.
export const totalTimedSec = (actual) => timedPerSet(actual).reduce((a, s) => a + (s.reps ?? 1) * (s.sec ?? 0), 0);
export const longestTimedSec = (actual) => Math.max(0, ...timedPerSet(actual).map((s) => s.sec ?? 0)) || null;

// 20 -> "20s", 90 -> "1:30", 3600 -> "1:00:00": short, for set lists.
export function holdText(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// "2 × 20s", "3 × 5 × 10s" (sets × reps × time), "3 sets: 30s, 25s, 20s",
// "2 sets: 3 × 10s, 2 × 10s".
export function formatTimedSets(actual) {
  const sets = timedPerSet(actual);
  if (!sets.length) return '';
  const one = (s) => (s.reps > 1 ? `${s.reps} × ${holdText(s.sec)}` : holdText(s.sec));
  if (sets.every((s) => s.reps === sets[0].reps && s.sec === sets[0].sec)) {
    return sets.length > 1 ? `${sets.length} × ${one(sets[0])}` : one(sets[0]);
  }
  return `${sets.length} sets: ${sets.map(one).join(', ')}`;
}
