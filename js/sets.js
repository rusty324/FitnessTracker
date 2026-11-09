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
