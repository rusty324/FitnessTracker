// Factories, migrations, and traversal helpers for the app's record shapes.
// Plans follow the fitness-tracker-plan v2 structure internally:
//   plan -> weeks[] -> sessions[] -> blocks[] -> items[] (exercise + target)
// plus app-level scheduling fields (startDate, status). Records created by
// the app's first version (flat sessions[], defaultUnit exercises) are
// upgraded transparently by migratePlan/migrateExercise at read time.

import { todayStr } from './dates.js';
import { CATEGORIES, MODALITIES, MEASUREMENT_TYPES } from './config.js';

const uid = () => crypto.randomUUID();

// ---------- factories ----------

export function makePlan({ name = '', type = 'custom', startDate = todayStr() } = {}) {
  return {
    id: uid(),
    name,
    type,
    status: 'active', // 'active' | 'archived'
    startDate, // YYYY-MM-DD; anchors dayOffsets to calendar dates
    description: '',
    goal: '',
    level: null, // 'beginner' | 'intermediate' | 'advanced' | null
    phases: [], // [{id,name,weekStart,weekEnd,objective?,...}]
    weeks: [], // ordered [{index, phaseId?, focus?, isDeload?, note?, sessions:[]}]
  };
}

export function makeWeek(index) {
  return { index, sessions: [] };
}

export function makeSession({ label = '', dayOffset = 0 } = {}) {
  return {
    id: uid(),
    label,
    dayOffset, // days from plan.startDate; scheduling source of truth
    note: '',
    blocks: [],
  };
}

export function makeBlock({ type = 'main', name = '' } = {}) {
  return { id: uid(), type, name, note: '', items: [] };
}

// One prescribed exercise within a block. `id` is internal (logging/matching
// key) and is stripped on export.
export function makeBlockItem({ exerciseId, target = {}, note = '', optional = false } = {}) {
  return { id: uid(), exerciseId, target, note, optional };
}

export function makeExercise({ name = '', category = 'strength', modality = 'other', measurementType = 'reps' } = {}) {
  return {
    id: uid(),
    name,
    archived: false, // hidden from pickers; existing references keep resolving
    shortName: '',
    category, // CATEGORIES
    modality, // MODALITIES
    measurementType, // MEASUREMENT_TYPES
    perSide: false,
    equipment: [],
    primaryTargets: [],
    positions: [], // POSITIONS ids
    description: '',
    cues: [],
    whyItsHere: '',
    safetyNotes: [],
    variants: [], // [{level, name, description?}]
    progressionRule: '',
    videoSearchTerm: '',
  };
}

export function makeLogEntry({
  date = todayStr(),
  planId = null,
  plannedExerciseId = null, // block-item id; null = ad-hoc
  exerciseId = null,
  actual = {},
  notes = '',
  rpe = null,
  source = 'manual',
} = {}) {
  return { id: uid(), date, planId, plannedExerciseId, exerciseId, actual, notes, rpe, source };
}

// A shoe, bike or other item whose distance is tracked. Its mileage is never
// stored: it's computed from the activities that used it (js/cardio.js),
// plus startDistanceM for what it had before it was added here.
export function makeGear({ name = '', kind = 'shoes', sports = [], alertDistanceM = null } = {}) {
  return {
    id: uid(),
    name,
    kind, // 'shoes' | 'bike' | 'other'
    sports, // cardio sport ids (CARDIO_SPORTS) it is the default for
    isDefault: sports.length > 0,
    startDistanceM: 0,
    alertDistanceM, // "time to replace" threshold, or null
    addedOn: todayStr(), // default gear only applies from this date…
    retiredOn: null, // …up to this one
    notes: '',
  };
}

export function makeBodyMetric({
  date = todayStr(),
  weight = null, // kg
  bodyFat = null, // %
  restingHr = null, // bpm
  waist = null, // cm
  notes = '',
} = {}) {
  return { id: uid(), date, weight, bodyFat, restingHr, waist, notes };
}

export function makeMatch({ activityId, status, planId = null, plannedExerciseId = null, sessionId = null } = {}) {
  return { id: `match-${activityId}`, activityId, status, planId, sessionId, plannedExerciseId };
}

// Match records written before the Polar switch keyed on `stravaId`.
export function matchActivityId(m) {
  return m.activityId ?? m.stravaId;
}

// Goals (Fitness Library → Goals). type: 'bodyweight' | 'runTime' | 'exercise'
export function makeGoal({ type = 'bodyweight' } = {}) {
  return {
    id: uid(),
    type,
    targetWeight: null, // kg (bodyweight)
    distanceM: null, // runTime
    targetSec: null, // runTime
    exerciseId: null, // exercise
    target: null, // exercise: same shape as plan targets
    targetDate: null,
    notes: '',
  };
}

// ---------- v1 -> v2 migrations (pure, idempotent) ----------

const V1_CATEGORY_MAP = {
  running: { category: 'cardio', modality: 'run' },
  cycling: { category: 'cardio', modality: 'bike' },
  swimming: { category: 'cardio', modality: 'swim' },
  strength: { category: 'strength', modality: 'other' },
  other: { category: 'other', modality: 'other' },
};

export function migrateExercise(ex) {
  if (ex.measurementType) return ex;
  const m = V1_CATEGORY_MAP[ex.category] ?? V1_CATEGORY_MAP.other;
  return {
    ...makeExercise({}),
    ...ex,
    category: m.category,
    modality: m.modality,
    measurementType: ['distance', 'duration'].includes(ex.defaultUnit) ? ex.defaultUnit : 'reps',
  };
}

export function migratePlan(plan) {
  if (plan.weeks) return plan;
  const weeks = new Map();
  for (const s of plan.sessions ?? []) {
    const index = Math.floor((s.dayOffset ?? 0) / 7) + 1;
    if (!weeks.has(index)) weeks.set(index, makeWeek(index));
    weeks.get(index).sessions.push({
      id: s.id,
      label: s.label ?? '',
      dayOffset: s.dayOffset ?? 0,
      note: '',
      blocks: [{
        id: `${s.id}-main`,
        type: 'main',
        name: '',
        note: '',
        items: (s.plannedExercises ?? [])
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((pe) => ({ id: pe.id, exerciseId: pe.exerciseId, target: pe.target ?? {}, note: '', optional: false })),
      }],
    });
  }
  const { sessions: _dropped, ...rest } = plan;
  return {
    description: '',
    goal: '',
    level: null,
    phases: [],
    ...rest,
    weeks: [...weeks.values()].sort((a, b) => a.index - b.index),
  };
}

// ---------- traversal helpers ----------

// Flat, dayOffset-sorted list of a plan's sessions with their week context.
export function allSessions(plan) {
  const out = [];
  for (const week of plan.weeks ?? []) {
    for (const session of week.sessions ?? []) {
      const dayOffset = session.dayOffset ?? (week.index - 1) * 7 + (session.dayInWeek ?? 0);
      out.push({ plan, week, session, dayOffset });
    }
  }
  return out.sort((a, b) => a.dayOffset - b.dayOffset);
}

// Flat [{block, item}] for a session, in prescription order.
export function sessionItems(session) {
  const out = [];
  for (const block of session.blocks ?? []) {
    for (const item of block.items ?? []) out.push({ block, item });
  }
  return out;
}

export function phaseForWeek(plan, weekIndex) {
  return (plan.phases ?? []).find((p) => weekIndex >= p.weekStart && weekIndex <= p.weekEnd) ?? null;
}

// ---------- referential integrity helpers ----------

// Everything that points at an exercise, so deletion can warn before it
// orphans plans, logs, or goals.
export function exerciseUsage(exerciseId, plans, logs, goals) {
  let planItems = 0;
  const planNames = new Set();
  for (const plan of plans) {
    for (const { session } of allSessions(plan)) {
      for (const { item } of sessionItems(session)) {
        if (item.exerciseId === exerciseId) {
          planItems++;
          planNames.add(plan.name);
        }
      }
    }
  }
  return {
    planItems,
    planNames: [...planNames],
    logs: logs.filter((l) => l.exerciseId === exerciseId).length,
    goals: goals.filter((g) => g.exerciseId === exerciseId).length,
    get any() {
      return this.planItems > 0 || this.logs > 0 || this.goals > 0;
    },
  };
}

// Repoint every reference from one exercise to another. Pure — returns new
// collections, touching only the records that actually referenced fromId.
export function remapExercise(fromId, toId, { plans, logs, goals }) {
  const nextPlans = plans.map((plan) => {
    let touched = false;
    const copy = JSON.parse(JSON.stringify(plan));
    for (const week of copy.weeks ?? []) {
      for (const session of week.sessions ?? []) {
        for (const block of session.blocks ?? []) {
          for (const item of block.items ?? []) {
            if (item.exerciseId === fromId) {
              item.exerciseId = toId;
              touched = true;
            }
          }
        }
      }
    }
    return touched ? copy : plan;
  });
  return {
    plans: nextPlans,
    logs: logs.map((l) => (l.exerciseId === fromId ? { ...l, exerciseId: toId } : l)),
    goals: goals.map((g) => (g.exerciseId === fromId ? { ...g, exerciseId: toId } : g)),
  };
}

export function sanitizeCategory(c) {
  return CATEGORIES.includes(c) ? c : 'other';
}
export function sanitizeModality(m) {
  return MODALITIES.includes(m) ? m : 'other';
}
export function sanitizeMeasurement(m) {
  return MEASUREMENT_TYPES.includes(m) ? m : 'reps';
}
