// Load metrics: a strength number for each logged session that, unlike RWI,
// moves with the weight lifted. Pure — no DOM, no storage; callers pass data.
//
// Brzycki: 1RM = w·36/(37 − r). Chained with its inverse it gives the weight
// you could do for rRef reps, given you did w for r:
//     eRM(w, r, rRef) = w · (37 − rRef) / (37 − r)
// rRef = 1 is the est. 1RM. Reporting at a rep count near what's trained keeps
// the formula in the range it's accurate in, so each model caps the reps it
// will project from (LOAD_MODELS.maxReps) and returns null past that rather
// than extrapolate.
//
// Models (exercise.loadModel, or inferred for older records — loadModelOf):
//   e1rm     barbell compounds: est. 1RM from the logged (total) weight
//   erm_ref  dumbbell/machine/isolation: est. rRef-rep max (exercise.referenceReps)
//   bw_e1rm  bodyweight: effective load = variant fraction × body weight on
//            the day + any added weight, then est. 5-rep max
//   reps / duration / cardio: no load number — the UI trends reps at a
//            variant, hold time, or RWI instead.
// Goal-weight scaling is a display choice made at read time; nothing scaled
// is ever stored, so changing the goal restates the whole history.

import { LOAD_MODELS } from './config.js';
import { repsPerSet, weightsPerSet, longestTimedSec } from './sets.js';
import { isCardioExercise } from './cardio.js';
import { allSessions, sessionItems } from './models.js';

const LOAD_BASED = ['e1rm', 'erm_ref', 'bw_e1rm'];
export const isLoadModel = (model) => LOAD_BASED.includes(model);

// The weight you could do for rRef reps, given w for r; null outside the
// model's valid range (never extrapolate, never divide by 37 − r ≤ 0).
export function ermRef(w, r, rRef, maxReps) {
  if (!Number.isFinite(w) || w <= 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > maxReps || r >= 37) return null;
  if (!Number.isFinite(rRef) || rRef < 1 || rRef >= 37) return null;
  return (w * (37 - rRef)) / (37 - r);
}

// Dumbbell-style exercises that move a lot of muscle report an 8-rep max;
// isolation work keeps the model's 10.
const COMPOUND = /squat|press|row|deadlift|\brdl\b|lunge|bench|thruster|clean|snatch|swing|step-?up|pull-?over/i;

export function hasFraction(exercise) {
  return exercise?.bodyweightFraction != null
    || (exercise?.variants ?? []).some((v) => v.bodyweightFraction != null);
}

// The explicit loadModel, else inferred from what older records do have.
export function loadModelOf(exercise) {
  if (!exercise) return 'reps';
  if (exercise.loadModel) return exercise.loadModel;
  if (isCardioExercise(exercise)) return 'cardio';
  const m = exercise.modality;
  if (m === 'barbell') return 'e1rm';
  if (['dumbbell', 'machine', 'band', 'kettlebell'].includes(m)) return 'erm_ref';
  if (m === 'bodyweight' && hasFraction(exercise)) return 'bw_e1rm';
  if (exercise.measurementType === 'duration') return 'duration';
  return 'reps';
}

// { rRef, maxReps } for a load model, with the exercise's own reference reps
// (erm_ref only) or the compound-dumbbell default of 8 when inferred.
export function modelParams(exercise) {
  const model = loadModelOf(exercise);
  const base = LOAD_MODELS[model];
  if (!base) return null;
  if (model !== 'erm_ref') return { ...base };
  const own = Number.isInteger(exercise?.referenceReps) && exercise.referenceReps >= 1 ? exercise.referenceReps : null;
  const inferred = !exercise?.loadModel && COMPOUND.test(exercise?.name ?? '') ? 8 : null;
  return { ...base, rRef: own ?? inferred ?? base.rRef };
}

export function modelLabel(exercise) {
  const model = loadModelOf(exercise);
  if (model === 'e1rm') return 'Est. 1RM';
  if (model === 'erm_ref') return `Est. ${modelParams(exercise).rRef}-rep max`;
  if (model === 'bw_e1rm') return `Bodyweight-adjusted est. ${LOAD_MODELS.bw_e1rm.rRef}-rep max`;
  return null;
}

// Effective load for one set, kg: f·BW + added for bodyweight work, else the
// logged weight. null when it can't be known.
export function effectiveLoadKg({ exercise, variantFraction, bodyKg, addedKg }) {
  if (loadModelOf(exercise) === 'bw_e1rm') {
    if (variantFraction == null || bodyKg == null) return null;
    return variantFraction * bodyKg + (addedKg ?? 0);
  }
  return addedKg > 0 ? addedKg : null;
}

// ---------- variants ----------

// item id -> target, for every plan item; cached per plans array.
const targetIndexCache = new WeakMap();
function targetIndex(plans) {
  if (!Array.isArray(plans)) return new Map();
  let idx = targetIndexCache.get(plans);
  if (!idx) {
    idx = new Map();
    for (const plan of plans) {
      for (const { session } of allSessions(plan)) {
        for (const { item } of sessionItems(session)) idx.set(item.id, item.target ?? {});
      }
    }
    targetIndexCache.set(plans, idx);
  }
  return idx;
}

// The plan target a log was logged against, or null (ad-hoc, or the plan
// item no longer exists).
export function plannedTargetOf(log, plans) {
  if (!log?.plannedExerciseId) return null;
  return targetIndex(plans).get(log.plannedExerciseId) ?? null;
}

// Which variant a log was done at: what the log says, else what its plan
// item prescribed, else null.
export function variantLevelFor(log, plans) {
  const own = log?.actual?.variantLevel;
  if (Number.isInteger(own)) return own;
  const planned = plannedTargetOf(log, plans)?.variantLevel;
  return Number.isInteger(planned) ? planned : null;
}

// Body-weight fraction for a log: the resolved variant's, else the
// exercise's own (exercises with no ladder), else null = not computable.
// A variant whose fraction is null ("not comparable by load", e.g. band-
// assisted) stays null rather than falling back.
export function fractionFor(exercise, log, plans) {
  const level = variantLevelFor(log, plans);
  const variant = level != null ? (exercise?.variants ?? []).find((v) => v.level === level) : null;
  if (variant) return variant.bodyweightFraction ?? null;
  return exercise?.bodyweightFraction ?? null;
}

// ---------- per session ----------

// Each set's eRM (null where a set can't be scored), plus why when none can.
export function setValues({ exercise, log, bodyKgOnDay, variantFraction }) {
  const model = loadModelOf(exercise);
  const params = modelParams(exercise);
  if (!isLoadModel(model) || !params) return { values: [], reason: 'model' };
  const reps = repsPerSet(log?.actual);
  if (!reps.length) return { values: [], reason: 'noReps' };
  const kg = weightsPerSet(log.actual);
  const bw = model === 'bw_e1rm';
  if (bw && bodyKgOnDay == null) return { values: reps.map(() => null), reason: 'noBodyweight' };
  if (bw && variantFraction == null) return { values: reps.map(() => null), reason: 'noFraction' };
  let overCap = false;
  let noWeight = false;
  const values = reps.map((r, i) => {
    const w = kg[i];
    if (!bw && !(w > 0)) { noWeight = true; return null; } // null = not recorded, 0 = no load
    const load = effectiveLoadKg({ exercise, variantFraction, bodyKg: bodyKgOnDay, addedKg: bw ? (w ?? 0) : w });
    if (r > params.maxReps) { overCap = true; return null; }
    return ermRef(load, r, params.rRef, params.maxReps);
  });
  const reason = values.some((v) => v != null) ? null : overCap ? 'overCap' : noWeight ? 'noWeight' : 'invalid';
  return { values, reason };
}

// The session's load value: the best set's eRM, kg — optionally scaled to
// goal weight (value × goal ÷ body weight on the day). null when no set can
// be scored; setValues says why.
export function sessionLoadValue({ exercise, log, bodyKgOnDay, variantFraction, goalKg = null, scale = false }) {
  const model = loadModelOf(exercise);
  const { values } = setValues({ exercise, log, bodyKgOnDay, variantFraction });
  let best = -1;
  values.forEach((v, i) => { if (v != null && (best < 0 || v > values[best])) best = i; });
  if (best < 0) return null;
  const reps = repsPerSet(log.actual)[best];
  const kg = weightsPerSet(log.actual)[best];
  const load = effectiveLoadKg({
    exercise, variantFraction, bodyKg: bodyKgOnDay, addedKg: model === 'bw_e1rm' ? (kg ?? 0) : kg,
  });
  let value = values[best];
  const canScale = scale && goalKg > 0 && bodyKgOnDay > 0;
  if (canScale) value *= goalKg / bodyKgOnDay;
  return {
    model,
    value,
    unit: 'kg',
    detail: {
      reps,
      loadKg: load,
      addedKg: model === 'bw_e1rm' ? (kg ?? 0) : kg,
      unscaled: values[best],
      scaled: canScale,
      scaleUnavailable: scale && !canScale,
    },
  };
}

// Fallback trends for sessions with no load value.
export function bestReps(log) {
  const r = repsPerSet(log?.actual);
  return r.length ? Math.max(...r) : null;
}
export function longestHold(log) {
  const a = log?.actual ?? {};
  const sec = longestTimedSec(a) ?? a.durationSec ?? a.movingSec;
  return sec > 0 ? sec : null;
}
