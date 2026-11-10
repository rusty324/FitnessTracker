// Exercise search + filters (muscle group, weights, position), shared by the
// Fitness Library list and the exercise picker (ad-hoc logging, plan
// editing), so both find exercises the same way.

import { MUSCLE_GROUPS, WEIGHT_TYPES, POSITIONS } from '../config.js';
import { muscleGroupsOf, weightTypesOf, positionsOf, NOT_SET } from '../exercise-filters.js';
import { el } from './components.js';

export const emptyFilters = () => ({ query: '', muscle: '', weight: '', position: '' });

export const labelOf = (list, id, short = false) => {
  const item = list.find((x) => x.id === id);
  return (short ? item?.short : null) ?? item?.label ?? id;
};

// "Strength · Chest, Triceps · Barbell · Lying" — what the filters see.
export function describeExercise(ex) {
  const groups = muscleGroupsOf(ex).map((id) => labelOf(MUSCLE_GROUPS, id)).join(', ');
  const weights = weightTypesOf(ex).map((id) => labelOf(WEIGHT_TYPES, id, true)).join(' / ');
  const positions = positionsOf(ex).map((id) => labelOf(POSITIONS, id, true)).join(' / ');
  const category = ex.category ? ex.category[0].toUpperCase() + ex.category.slice(1) : '';
  return [category, groups, weights, positions].filter(Boolean).join(' · ');
}

/**
 * Search box + three filter menus. `filters` is mutated in place; onChange
 * runs after every change (callers redraw only their list, so the search box
 * keeps focus while typing).
 * @param {object[]} exercises  the exercises the counts are over
 */
export function filterBar({ exercises, filters, onChange, placeholder = 'Search name, muscle, equipment…' }) {
  // A filter menu: "All muscles", then each option with how many exercises
  // it matches, then "Not set" for gaps to fill in.
  const menu = (key, label, anyLabel, options, valuesOf, withNotSet = true) => {
    const count = (id) => exercises.filter((ex) => (id === NOT_SET ? valuesOf(ex).length === 0 : valuesOf(ex).includes(id))).length;
    const opt = (value, text, n) => el('option', {
      value, selected: filters[key] === value, disabled: n === 0 && filters[key] !== value,
    }, `${text} (${n})`);
    return el('select', {
      'aria-label': label,
      dataset: { filter: key },
      onchange: (e) => { filters[key] = e.target.value; onChange(); },
    },
      el('option', { value: '', selected: !filters[key] }, anyLabel),
      options.map((o) => opt(o.id, o.label, count(o.id))),
      withNotSet && opt(NOT_SET, 'Not set', count(NOT_SET)),
    );
  };
  const search = el('input', {
    type: 'search', value: filters.query, placeholder, autocomplete: 'off',
    'aria-label': 'Search exercises', dataset: { filter: 'query' },
  });
  search.addEventListener('input', () => { filters.query = search.value; onChange(); });
  const selects = [
    menu('muscle', 'Muscle group', 'All muscles', MUSCLE_GROUPS, muscleGroupsOf),
    // Weights can't be "not set": an exercise needing none is bodyweight.
    menu('weight', 'Weights', 'All weights', WEIGHT_TYPES, weightTypesOf, false),
    menu('position', 'Position', 'All positions', POSITIONS, positionsOf),
  ];
  return { el: el('div', { class: 'filter-bar' }, search, el('div', { class: 'filter-row' }, selects)), search };
}
