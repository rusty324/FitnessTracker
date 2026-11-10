// The minimum session: a computed view of a planned session for days when
// the full one won't happen. The stored plan is never changed. Pure.
//
// Applied to each block's targets (templates are already expanded when a
// plan is imported):
//   - warm-up and cool-down blocks: unchanged (short, and they protect the shins);
//   - intervals: rounds × factor (min 1), totalSec recomputed;
//   - timed sets (sets > 1, e.g. planks): sets × factor rounded up, hold unchanged;
//   - one continuous effort: duration × factor, never below min(original, 60 s);
//   - distance: × factor;
//   - sets of reps: sets × factor rounded up (min 1).
// Every exercise stays — variety on purpose (the tibialis raises stay, at
// two sets instead of three). Each scaled item keeps its original target as
// `was` for display.
//
// Completing it counts as a completed session (js/sessions.js), and its
// logs carry mode: 'minimum', so it never triggers a weight or level
// increase (js/progression.js).

import { MIN_SESSION } from './config.js';

const KEEP = ['warmup', 'cooldown'];

export function minimumTarget(t = {}, factor = MIN_SESSION.factor) {
  const out = { ...t };
  if (t.kind === 'intervals') {
    out.rounds = Math.max(1, Math.round((t.rounds ?? 1) * factor));
    out.totalSec = out.rounds * ((t.workSec ?? 0) + (t.recoverySec ?? 0));
  } else if (t.kind === 'duration') {
    if ((t.sets ?? 1) > 1) out.sets = Math.max(1, Math.ceil(t.sets * factor));
    else if (t.durationSec != null) out.durationSec = Math.round(Math.max(t.durationSec * factor, Math.min(t.durationSec, 60)));
  } else if (t.kind === 'distance') {
    if (t.distanceM != null) out.distanceM = Math.round(t.distanceM * factor);
  } else if (t.sets != null) {
    out.sets = Math.max(1, Math.ceil(t.sets * factor));
  }
  return out;
}

export function minimumSession(session, factor = MIN_SESSION.factor) {
  return {
    ...session,
    blocks: (session.blocks ?? []).map((b) => (KEEP.includes(b.type)
      ? { ...b, unchanged: true, items: (b.items ?? []).map((it) => ({ ...it })) }
      : { ...b, items: (b.items ?? []).map((it) => ({ ...it, target: minimumTarget(it.target ?? {}, factor), was: it.target ?? {} })) })),
  };
}

// Rough seconds for one item's target (for "~26 min" beside the toggle).
export function itemSeconds(t = {}) {
  const sides = t.perSide ? 2 : 1;
  const rest = t.restSec ?? 30;
  if (t.kind === 'intervals') return t.totalSec ?? (t.rounds ?? 1) * ((t.workSec ?? 0) + (t.recoverySec ?? 0));
  if (t.kind === 'duration') return (t.sets ?? 1) * (t.durationSec ?? 0) * sides + ((t.sets ?? 1) - 1) * rest;
  if (t.kind === 'distance') return ((t.distanceM ?? 0) / 1000) * (t.paceSecPerKm ?? 420);
  const sets = t.sets ?? 1;
  const reps = t.reps ?? t.repsMax ?? t.repsMin ?? 10;
  return sets * reps * 4 * sides + (sets - 1) * rest;
}

// Estimated minutes: the plan's own estimate when it has one, scaled by how
// much the minimum keeps; otherwise the sum of the items.
export function estimateMinutes(session, minimum = null) {
  const total = (s) => (s.blocks ?? []).reduce((a, b) => a + (b.items ?? []).reduce((x, it) => x + itemSeconds(it.target), 0), 0);
  const full = total(session);
  const min = minimum ? total(minimum) : full;
  const base = session.estimatedDurationMin ? session.estimatedDurationMin * 60 : full;
  return Math.round(((full ? base * (min / full) : base)) / 60);
}
