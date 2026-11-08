// Search and filters for the exercise library. Pure functions: what an
// exercise targets, what it needs, where it's done — derived from the fields
// it already has, so imported and hand-made exercises filter the same way.

import { MUSCLE_GROUPS, WEIGHT_TYPES, POSITIONS } from './config.js';

// Equipment that's needed, not "optional: lifting belt" or "mat optional".
const required = (ex) => (ex.equipment ?? []).filter((e) => !/optional/i.test(e));

// Muscle group ids from the free-text primaryTargets ("latissimus dorsi" ->
// back, "glute medius" -> glutes, "legs" -> quads + hamstrings).
export function muscleGroupsOf(ex) {
  const targets = (ex.primaryTargets ?? []).map((t) => t.toLowerCase());
  return MUSCLE_GROUPS.filter((g) => targets.some((t) => g.match.test(t))).map((g) => g.id);
}

// Weight type ids. An exercise can need more than one ("dumbbell or
// kettlebell"); one that needs none of them is bodyweight.
export function weightTypesOf(ex) {
  const gear = required(ex).join(' | ').toLowerCase();
  const found = WEIGHT_TYPES
    .filter((w) => w.match && (ex.modality === w.modality || w.match.test(gear)))
    .map((w) => w.id);
  return found.length ? found : ['bodyweight'];
}

export function positionsOf(ex) {
  const known = new Set(POSITIONS.map((p) => p.id));
  return (ex.positions ?? []).filter((p) => known.has(p));
}

// Every word of the query must appear somewhere in the exercise's name,
// short name, muscles, equipment, category or modality.
export function matchesSearch(ex, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [ex.name, ex.shortName, ex.category, ex.modality, ...(ex.primaryTargets ?? []), ...(ex.equipment ?? [])]
    .filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}

// filters: { query, muscle, weight, position } — '' means any; NOT_SET
// matches exercises with nothing recorded, so gaps are easy to find and fill.
export const NOT_SET = '__none';

function matchesOne(values, wanted) {
  if (!wanted) return true;
  if (wanted === NOT_SET) return values.length === 0;
  return values.includes(wanted);
}

export function matchesFilters(ex, { query = '', muscle = '', weight = '', position = '' } = {}) {
  return matchesSearch(ex, query)
    && matchesOne(muscleGroupsOf(ex), muscle)
    && matchesOne(weightTypesOf(ex), weight)
    && matchesOne(positionsOf(ex), position);
}

export const isFiltering = (f) => !!(f.query?.trim() || f.muscle || f.weight || f.position);
