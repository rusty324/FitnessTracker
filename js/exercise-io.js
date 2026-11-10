// Exercise library files: what an import would do, and the template. Pure.
//
// The point is bulk editing: export the library, edit many exercises in a
// text editor, import it back. So an import UPDATES exercises it matches —
// every field present in the file replaces the library's — and adds the
// rest. Fields a file leaves out are left alone, and a matched exercise
// keeps its id, so logs and plans that point at it stay linked.
//
// Matching, in order: the `id` an export carries; else the name, ignoring
// case, spaces and punctuation ("Push Up" = "push-up").

import { CATEGORIES, MODALITIES, MEASUREMENT_TYPES, POSITIONS, LOAD_MODEL_IDS } from './config.js';

export const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Fields an import may set, and how each is checked.
const strList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const FIELDS = {
  name: (v) => typeof v === 'string' && v.trim() !== '',
  shortName: (v) => typeof v === 'string',
  category: (v) => CATEGORIES.includes(v),
  modality: (v) => MODALITIES.includes(v) || v === 'kettlebell',
  measurementType: (v) => MEASUREMENT_TYPES.includes(v),
  perSide: (v) => typeof v === 'boolean',
  equipment: strList,
  primaryTargets: strList,
  positions: (v) => strList(v) && v.every((p) => POSITIONS.some((x) => x.id === p)),
  description: (v) => typeof v === 'string',
  cues: strList,
  whyItsHere: (v) => typeof v === 'string',
  safetyNotes: strList,
  variants: (v) => Array.isArray(v) && v.every((x) => x && typeof x === 'object'
    && Number.isInteger(x.level) && typeof x.name === 'string'
    && (x.description == null || typeof x.description === 'string')
    && (x.bodyweightFraction == null || typeof x.bodyweightFraction === 'number')
    && (x.gif == null || typeof x.gif === 'string')),
  progressionRule: (v) => typeof v === 'string',
  videoSearchTerm: (v) => typeof v === 'string',
  loadModel: (v) => LOAD_MODEL_IDS.includes(v),
  referenceReps: (v) => Number.isInteger(v) && v >= 1 && v <= 15,
  bodyweightFraction: (v) => typeof v === 'number' && v >= 0 && v <= 1.2,
  weightStepKg: (v) => typeof v === 'number' && v > 0,
  gif: (v) => typeof v === 'string',
  archived: (v) => typeof v === 'boolean',
};
export const IMPORT_FIELDS = Object.keys(FIELDS);

// The definitions in a file: a library export / plan file (exerciseLibrary
// map), a bare map, an array, or one exercise.
export function extractExerciseDefs(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (data.exerciseLibrary && typeof data.exerciseLibrary === 'object') return Object.values(data.exerciseLibrary);
    if (typeof data.name === 'string') return [data];
    const vals = Object.values(data).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (vals.length && vals.every((v) => typeof v.name === 'string')) return vals;
  }
  throw new Error('Expected an exercise library file: an exerciseLibrary map, an array of exercises, or one exercise');
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What importing `defs` into `library` would do. Nothing is changed.
 * -> { creates: [record], updates: [{ before, after, fields }], unchanged: [record],
 *      skipped: [{ name, reason }] }
 * newId: makes ids for new exercises.
 */
export function planExerciseImport(defs, library, { newId = () => crypto.randomUUID(), makeExercise = (n) => ({ name: n }) } = {}) {
  const byId = new Map(library.map((e) => [e.id, e]));
  const byName = new Map(library.map((e) => [normName(e.name), e]));
  const out = { creates: [], updates: [], unchanged: [], skipped: [] };
  const seen = new Set(); // matched / created, so a file can't hit one twice

  for (const def of defs) {
    const label = typeof def?.name === 'string' && def.name.trim() ? def.name.trim() : '(no name)';
    if (!def || typeof def !== 'object' || Array.isArray(def)) { out.skipped.push({ name: label, reason: 'not an exercise object' }); continue; }
    if (!FIELDS.name(def.name)) { out.skipped.push({ name: label, reason: 'no name' }); continue; }
    if (/\(example\)\s*$/i.test(def.name)) { out.skipped.push({ name: label, reason: 'template example — rename it to import' }); continue; }

    // Check every field before applying any, so a bad file changes nothing.
    const picked = {};
    const bad = [];
    for (const [k, ok] of Object.entries(FIELDS)) {
      if (!(k in def) || def[k] == null) continue;
      if (!ok(def[k])) bad.push(k);
      else picked[k] = k === 'name' ? def[k].trim() : def[k];
    }
    if (bad.length) { out.skipped.push({ name: label, reason: `invalid ${bad.join(', ')}` }); continue; }

    const idMatch = typeof def.id === 'string' ? byId.get(def.id) : null;
    const match = idMatch || byName.get(normName(def.name));
    // Matched by name, the name only found it: keep your spelling ("push up"
    // in a file doesn't rename "Push-Up"). Matched by id, a new name renames.
    if (match && !idMatch) delete picked.name;
    const key = match ? match.id : `new:${normName(def.name)}`;
    if (seen.has(key)) { out.skipped.push({ name: label, reason: 'appears twice in the file' }); continue; }
    seen.add(key);

    if (match) {
      const fields = Object.keys(picked).filter((k) => !same(match[k], picked[k]));
      if (fields.length) out.updates.push({ before: match, after: { ...match, ...picked }, fields });
      else out.unchanged.push(match);
    } else {
      const id = typeof def.id === 'string' && def.id && !byId.has(def.id) ? def.id : newId();
      out.creates.push({ ...makeExercise(picked.name), ...picked, id, archived: picked.archived ?? false });
    }
  }
  return out;
}

// The library with an import plan applied (pure: returns a new list).
export function applyExerciseImport(library, plan) {
  const updated = new Map(plan.updates.map((u) => [u.after.id, u.after]));
  return [...library.map((e) => updated.get(e.id) ?? e), ...plan.creates];
}

// A starting point for writing exercises by hand: what each field means and
// the values it accepts, with two examples. Names ending "(example)" are
// skipped on import, so the template can be imported as-is without effect.
export function exerciseTemplate() {
  return {
    format: 'fitness-tracker-exercise-library',
    formatVersion: 2,
    _readme: [
      'Add or edit exercises here, then Library → Import. Every exercise needs a name; everything else is optional.',
      'Exercises already in your library are matched by "id" (exports include it) or by name, and updated with the fields you give. Fields you leave out stay as they are.',
      'To rename an exercise, keep its "id" (from an export) and change the name; matched by name alone, the name is left as it is.',
      'Exercises whose name ends in "(example)" are skipped — rename or copy the examples below.',
      `category: ${CATEGORIES.join(' | ')}`,
      `modality: ${MODALITIES.join(' | ')}`,
      `measurementType: ${MEASUREMENT_TYPES.join(' | ')}`,
      `positions (list): ${POSITIONS.map((p) => p.id).join(' | ')}`,
      `loadModel: ${LOAD_MODEL_IDS.join(' | ')} (leave out to infer from modality)`,
      'equipment, primaryTargets (muscles), cues, safetyNotes: lists of text.',
      'variants: an ordered ladder, level 1 = easiest: { "level": 1, "name": "...", "description": "...", "bodyweightFraction": 0.5, "gif": "https://..." }. Levels are positional: plans and logs refer to them, so don\'t reorder an existing ladder.',
      'gif: a link to an animated GIF (https://...). Uploaded GIFs show here as "media:<id>"; keep those as they are.',
      'Weights are kilograms (weightStepKg), whatever units the app shows.',
    ],
    exerciseLibrary: {
      goblet_squat_example: {
        name: 'Goblet Squat (example)',
        category: 'strength',
        modality: 'dumbbell',
        measurementType: 'reps',
        equipment: ['dumbbell or kettlebell'],
        primaryTargets: ['quads', 'glutes', 'core'],
        positions: ['standing'],
        description: 'Hold one dumbbell vertically at the chest and squat between the knees.',
        cues: ['Elbows inside the knees at the bottom', 'Chest up, heels down'],
        safetyNotes: ['Stop short of any knee pain'],
        loadModel: 'erm_ref',
        referenceReps: 8,
        weightStepKg: 2,
        gif: 'https://example.com/goblet-squat.gif',
      },
      push_up_example: {
        name: 'Incline Push-Up (example)',
        category: 'strength',
        modality: 'bodyweight',
        measurementType: 'reps',
        primaryTargets: ['chest', 'triceps', 'shoulders'],
        positions: ['plank'],
        cues: ['Body in one straight line', 'Elbows about 45° from the body'],
        variants: [
          { level: 1, name: 'Wall Push-Up', description: 'Hands on a wall.', bodyweightFraction: 0.3 },
          { level: 2, name: 'Bench Push-Up', description: 'Hands on a bench.', bodyweightFraction: 0.45, gif: 'https://example.com/bench-push-up.gif' },
        ],
        loadModel: 'bw_e1rm',
      },
    },
  };
}
