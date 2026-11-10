// What to do next time, per exercise: double progression for weighted work,
// variant-ladder progression for bodyweight work. Advisory and derived at
// read time — nothing here is ever stored. Pure.
//
// suggestNext() -> { kind, weightKg?, variantLevel?, repsMin?, repsMax?,
//                    reason, basis: { date, sets } } | null
// kind: add | hold | drop | return | advance | regress | variant_gap | deload

import { PROGRESSION, WEIGHT_STEP } from './config.js';
import { repsPerSet, weightsPerSet } from './sets.js';
import { variantLevelFor } from './load.js';

const LB_PER_KG = 2.20462262;
const WEIGHTED = ['barbell', 'dumbbell', 'machine', 'kettlebell'];
const DAY = 86400000;

// [lo, hi] from a target: a range, else a fixed rep count as [reps, reps]
// (the couch-to-10K plan uses fixed reps, so "top of range" is the
// prescribed reps). No reps at all: null.
export function rangeOf(target) {
  if (!target) return null;
  if (target.repsMin != null && target.repsMax != null) return [target.repsMin, target.repsMax];
  if (target.reps != null) return [target.reps, target.reps];
  return null;
}

export function progressionModeOf(exercise, target) {
  if (!exercise || (exercise.measurementType ?? 'reps') !== 'reps') return null;
  if (target?.kind && target.kind !== 'reps') return null;
  if (WEIGHTED.includes(exercise.modality) && rangeOf(target)) return 'double';
  if (exercise.variants?.length) return 'variant';
  return null;
}

// One entry per logged session of the exercise, newest first:
// { date, variantLevel, mode, sets: [{ reps, weightKg }] }.
export function sessionsOf(exerciseId, logs, plans = []) {
  return logs
    .filter((l) => l.exerciseId === exerciseId && repsPerSet(l.actual).length)
    .map((l) => {
      const reps = repsPerSet(l.actual);
      const kg = weightsPerSet(l.actual);
      return {
        date: l.date,
        variantLevel: variantLevelFor(l, plans),
        mode: l.mode ?? 'full',
        sets: reps.map((r, i) => ({ reps: r, weightKg: kg[i] ?? null })),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ---------- units: steps live in the display unit ----------

const toDisplay = (kg, units) => (units === 'imperial' ? kg * LB_PER_KG : kg);
const fromDisplay = (v, units) => (units === 'imperial' ? Math.round((v / LB_PER_KG) * 1000) / 1000 : Math.round(v * 1000) / 1000);
function stepOf(exercise, units) {
  if (exercise?.weightStepKg > 0) return toDisplay(exercise.weightStepKg, units);
  const table = WEIGHT_STEP[units === 'imperial' ? 'imperial' : 'metric'];
  return table[exercise?.modality] ?? table.other;
}
const snap = (v, step) => Math.round(v / step) * step;
const fmtW = (kg, units) => {
  const v = Math.round(toDisplay(kg, units) * 10) / 10;
  return `${v} ${units === 'imperial' ? 'lb' : 'kg'}`;
};
const fmtDate = (ds) => {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const repList = (sets) => sets.map((s) => s.reps).join('/');

// Working sets: those at the session's heaviest weight (back-off sets at a
// lower weight don't count toward qualifying).
function working(session) {
  const max = Math.max(...session.sets.map((s) => s.weightKg ?? -1));
  return { weightKg: max > 0 ? max : null, sets: session.sets.filter((s) => (s.weightKg ?? -1) === max) };
}

/**
 * @param {object} o
 * @param {object} o.exercise
 * @param {object} [o.plannedTarget]
 * @param {object[]} o.history   sessionsOf(): newest first, before today
 * @param {boolean} [o.weekIsDeload]
 * @param {string} o.today        YYYY-MM-DD
 * @param {'metric'|'imperial'} [o.units]
 * @param {boolean} [o.painHold]  last session with this exercise was flagged 'pain' (Phase D)
 */
export function suggestNext({ exercise, plannedTarget = null, history = [], weekIsDeload = false, today, units = 'metric', painHold = false }) {
  const mode = progressionModeOf(exercise, plannedTarget);
  if (!mode || !history.length) return null;
  return mode === 'double'
    ? double({ exercise, plannedTarget, history, weekIsDeload, today, units, painHold })
    : variant({ exercise, plannedTarget, history, weekIsDeload, painHold });
}

function double({ exercise, plannedTarget, history, weekIsDeload, today, units, painHold }) {
  const [lo, hi] = rangeOf(plannedTarget);
  const step = stepOf(exercise, units);
  const last = history[0];
  const lw = working(last);
  if (lw.weightKg == null) return null; // weighted exercise, no weights logged
  const basis = { date: last.date, sets: last.sets };
  const at = `${repList(last.sets)} at ${fmtW(lw.weightKg, units)} on ${fmtDate(last.date)}`;

  const gapDays = Math.round((Date.parse(today) - Date.parse(last.date)) / DAY);
  if (gapDays > PROGRESSION.layoffDays) {
    const kg = fromDisplay(snap(toDisplay(lw.weightKg, units) * PROGRESSION.layoffFactor, step), units);
    return { kind: 'return', weightKg: kg, repsMin: lo, repsMax: hi, basis,
      reason: `${gapDays} days since you last did this (${at}). Ease back in at ${fmtW(kg, units)}.` };
  }
  if (weekIsDeload) return { kind: 'deload', weightKg: lw.weightKg, basis, reason: 'Deload week. No progression.' };
  if (painHold) return { kind: 'hold', weightKg: lw.weightKg, repsMin: lo, repsMax: hi, basis, reason: 'Pain flagged last session. Hold here; no increase.' };

  // Minimum sessions still show as ghosts but never qualify a change.
  const full = history.filter((s) => s.mode !== 'minimum');
  if (!full.length) return { kind: 'hold', weightKg: lw.weightKg, repsMin: lo, repsMax: hi, basis, reason: `Last time was a minimum session (${at}). Hold.` };

  const recent = full.slice(0, PROGRESSION.dropAfterSessions);
  const sameWeight = recent.every((s) => working(s).weightKg === working(full[0]).weightKg);
  if (recent.length === PROGRESSION.dropAfterSessions && sameWeight
    && recent.every((s) => (working(s).sets[0]?.reps ?? Infinity) < lo)) {
    const w0 = working(full[0]).weightKg;
    const kg = fromDisplay(Math.max(0, snap(toDisplay(w0, units) - step, step)), units);
    return { kind: 'drop', weightKg: kg, repsMin: lo, repsMax: hi, basis,
      reason: `First set under ${lo} reps in your last ${recent.length} sessions at ${fmtW(w0, units)}. Drop to ${fmtW(kg, units)}.` };
  }

  const planned = plannedTarget?.sets ?? 2;
  const qualifies = (s) => {
    const w = working(s);
    return w.sets.length >= planned && w.sets.every((x) => x.reps >= hi);
  };
  const top = full.slice(0, PROGRESSION.addAfterSessions);
  if (top.length === PROGRESSION.addAfterSessions && top.every(qualifies)) {
    const w0 = working(full[0]).weightKg;
    const kg = fromDisplay(snap(toDisplay(w0, units) + step, step), units);
    return { kind: 'add', weightKg: kg, repsMin: lo, repsMax: hi, basis,
      reason: `You did ${repList(full[0].sets)} at ${fmtW(w0, units)} on ${fmtDate(full[0].date)}.` };
  }
  const short = working(full[0]).sets.length < planned;
  return { kind: 'hold', weightKg: working(full[0]).weightKg, repsMin: lo, repsMax: hi, basis,
    reason: short
      ? `${working(full[0]).sets.length} of ${planned} sets at ${fmtW(working(full[0]).weightKg, units)} last time. Hold until all ${planned} reach ${hi}.`
      : `Last time ${repList(working(full[0]).sets)} at ${fmtW(working(full[0]).weightKg, units)}; add weight when every set reaches ${hi}.` };
}

function variant({ exercise, plannedTarget, history, weekIsDeload, painHold }) {
  const range = rangeOf(plannedTarget);
  if (!range) return null;
  const [lo, hi] = range;
  const ladder = [...exercise.variants].sort((a, b) => a.level - b.level);
  const nameOf = (lvl) => ladder.find((v) => v.level === lvl)?.name ?? `level ${lvl}`;
  const last = history[0];
  const L = last.variantLevel ?? plannedTarget?.variantLevel;
  if (L == null) return null;
  const basis = { date: last.date, sets: last.sets };
  const planned = plannedTarget?.sets ?? 1;

  if (weekIsDeload) return { kind: 'deload', variantLevel: L, basis, reason: 'Deload week. No progression.' };
  if (painHold) return { kind: 'hold', variantLevel: L, repsMin: lo, repsMax: hi, basis, reason: 'Pain flagged last session. Hold here; no increase.' };

  // The most recent run of sessions at L (minimum sessions don't qualify).
  const atL = [];
  for (const s of history) {
    if (s.variantLevel !== L) break;
    if (s.mode !== 'minimum') atL.push(s);
  }
  const best = Math.max(...last.sets.map((s) => s.reps));

  if (L > ladder[0].level && atL.length >= 2 && atL.slice(0, 2).every((s) => (s.sets[0]?.reps ?? Infinity) < lo)) {
    return { kind: 'regress', variantLevel: L - 1, repsMin: lo, repsMax: hi, basis,
      reason: `First set under ${lo} in your last two sessions at ${nameOf(L)}. Step back to ${nameOf(L - 1)}.` };
  }
  const n = PROGRESSION.variantAdvanceAfter;
  const topAll = (s) => s.sets.length >= planned && s.sets.every((x) => x.reps >= hi);
  if (atL.length >= n && atL.slice(0, n).every(topAll)) {
    if (!ladder.some((v) => v.level === L + 1)) {
      return { kind: 'hold', variantLevel: L, repsMin: lo, repsMax: hi, basis, reason: 'Top of the ladder.' };
    }
    return { kind: 'advance', variantLevel: L + 1, repsMin: lo, repsMax: hi, basis,
      reason: `${n} sessions in a row at ${nameOf(L)} with every set at ${hi}+ (last: ${repList(last.sets)} on ${fmtDate(last.date)}). Move up to ${nameOf(L + 1)}.` };
  }
  const pl = plannedTarget?.variantLevel;
  if (pl != null && pl >= L + 2) {
    return { kind: 'variant_gap', variantLevel: L, repsMin: lo, repsMax: hi, basis,
      reason: `Plan asks for level ${pl}; you last did level ${L} (best ${best} reps). Consider staying at ${L}.` };
  }
  return { kind: 'hold', variantLevel: L, repsMin: lo, repsMax: hi, basis,
    reason: atL.length && atL.slice(0, 1).every(topAll) && !ladder.some((v) => v.level === L + 1)
      ? 'Top of the ladder.'
      : `Last time ${repList(last.sets)} at ${nameOf(L)}. Move up after ${n} sessions in a row with every set at ${hi}.` };
}
