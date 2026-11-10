// Inline warnings for a logged set: likely typos, never a block. Only NaN and
// negatives are refused outright (`reject: true`). Pure.

import { SANITY } from './config.js';

const LB_PER_KG = 2.20462;

// history: prior sets of this exercise, [{ weightKg, reps }] (any order).
// -> null | { message, reject? }
export function checkSet({ weightKg = null, reps = null, durationSec = null, history = [] }) {
  for (const [v, what] of [[weightKg, 'Weight'], [reps, 'Reps'], [durationSec, 'Duration']]) {
    if (v == null) continue;
    if (typeof v !== 'number' || Number.isNaN(v)) return { message: `${what} isn’t a number`, reject: true };
    if (v < 0) return { message: `${what} can’t be negative`, reject: true };
  }
  if (reps != null && reps > SANITY.maxReps) return { message: `${reps} reps is a lot — typo?` };
  if (durationSec != null && durationSec > SANITY.maxDurationSec) return { message: 'Over 12 hours — typo?' };

  const prior = history.map((s) => s.weightKg).filter((w) => w > 0);
  if (weightKg > 0) {
    if (!prior.length && weightKg > SANITY.maxFirstWeightKg) return { message: 'Over 500 kg — typo?' };
    const near = (a, b) => Math.abs(a - b) <= b * SANITY.unitMixTolerance;
    // An exact repeat of a prior weight is never a unit mix-up.
    if (!prior.some((p) => near(weightKg, p))
      && prior.some((p) => near(weightKg, p * LB_PER_KG) || near(weightKg, p / LB_PER_KG))) {
      return { message: 'This matches a past weight converted between lb and kg — right unit?' };
    }
    if (prior.length >= SANITY.jumpMinHistory && weightKg > SANITY.jumpFactor * Math.max(...prior)) {
      return { message: `Over ${SANITY.jumpFactor}× your heaviest so far — typo?` };
    }
  }
  return null;
}
