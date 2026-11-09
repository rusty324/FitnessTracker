// Reps logged per set. Sets that all match keep the original shape
// { sets, reps }; sets that differ store the list as well,
// { sets, setReps: [20, 20, 20, 15, 12] }, with no single `reps`. Everything
// that reads reps goes through repsPerSet(), so both shapes read the same.

export function repsPerSet(actual) {
  if (!actual) return [];
  if (Array.isArray(actual.setReps) && actual.setReps.length) return actual.setReps;
  if (actual.reps != null) return Array(Math.max(1, actual.sets ?? 1)).fill(actual.reps);
  return [];
}

// The stored fields for a list of per-set reps (blank sets already removed).
export function setFields(list) {
  if (!list.length) return {};
  return list.every((r) => r === list[0])
    ? { sets: list.length, reps: list[0] }
    : { sets: list.length, setReps: list };
}

export const totalReps = (actual) => repsPerSet(actual).reduce((a, b) => a + b, 0);

// "5 × 20", or "5 sets: 20, 20, 20, 15, 12" when they differ.
export function formatSets(actual) {
  const reps = repsPerSet(actual);
  if (!reps.length) return actual?.sets ? `${actual.sets} sets` : '';
  return reps.every((r) => r === reps[0])
    ? `${reps.length} × ${reps[0]}`
    : `${reps.length} sets: ${reps.join(', ')}`;
}
