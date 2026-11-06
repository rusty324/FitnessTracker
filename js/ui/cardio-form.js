// The cardio fields shared by the manual log form and the activity editor —
// one implementation, so both store the same canonical shape (js/cardio.js).

import { CARDIO_SPORTS, GEAR_KINDS } from '../config.js';
import {
  distanceUnit, distanceToInput, distanceFromInput,
  elevationUnit, elevationToInput, elevationFromInput, formatElevation,
} from '../units.js';
import { parseHms, formatHms, NO_GEAR, defaultGear, resolveGear, inService } from '../cardio.js';
import { el } from './components.js';

const ENVIRONMENTS = [
  ['', 'Not specified'],
  ['outdoor', 'Outside'],
  ['indoor', 'Treadmill / indoor'],
];

export const gearIcon = (gear) => GEAR_KINDS.find((k) => k.id === gear?.kind)?.icon ?? '🎒';

// <select> of gear for one entry. Values: '' = use the default for this
// sport/date, NO_GEAR, or a gear id. Retired gear is only listed when the
// entry already uses it, so old activities keep showing what they used.
export function gearSelect(gearList, { sport, date, value }) {
  const def = defaultGear(gearList, sport, date);
  const sportLabel = CARDIO_SPORTS.find((s) => s.id === sport)?.label.toLowerCase();
  const options = [
    ['', def ? `Default — ${def.name}` : `Default — none set${sportLabel ? ` for ${sportLabel}` : ''}`],
    [NO_GEAR, 'No gear'],
  ];
  for (const g of gearList) {
    if (g.id !== value && (g.retiredOn || !inService(g, date))) continue;
    options.push([g.id, `${gearIcon(g)} ${g.name}${g.retiredOn ? ' (retired)' : ''}`]);
  }
  if (value && value !== NO_GEAR && !gearList.some((g) => g.id === value)) {
    options.push([value, 'Deleted gear']);
  }
  return el('select', { dataset: { name: 'gearId' } },
    options.map(([v, label]) => el('option', { value: v, selected: (value ?? '') === v }, label)));
}

/**
 * Inputs for one cardio entry.
 * @param {object} values  current cardio fields (canonical units)
 * @param {object} o
 * @param {object[]} o.gear     the gear collection
 * @param {string|null} o.sport cardio sport id, for the gear default
 * @param {string} o.date
 * @returns {{ el: HTMLElement, read: () => ({ values } | { error }) }}
 */
export function cardioFields(values = {}, { gear = [], sport = null, date }) {
  const num = (name, value, step, attrs = {}) => el('input', {
    type: 'number', inputmode: step === 1 ? 'numeric' : 'decimal', step, min: '0', value: value ?? '', dataset: { name }, ...attrs,
  });
  const duration = el('input', {
    type: 'text', inputmode: 'numeric', placeholder: 'h:mm:ss', value: formatHms(values.movingSec), dataset: { name: 'duration' },
  });
  const distance = num('distance', distanceToInput(values.distanceM), 0.01);
  const avgHr = num('avgHr', values.avgHr, 1);
  const maxHr = num('maxHr', values.maxHr, 1);
  const calories = num('calories', values.calories, 1);
  const elevation = num('elevation', elevationToInput(values.elevationM), 1);
  const environment = el('select', { dataset: { name: 'environment' } },
    ENVIRONMENTS.map(([v, label]) => el('option', { value: v, selected: (values.environment ?? '') === v }, label)));
  const gearInput = gearSelect(gear, { sport, date, value: values.gearId });

  const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
  const node = el('div', { class: 'cardio-fields' },
    el('div', { class: 'field-row' },
      field('Duration (h:mm:ss)', duration),
      field(`Distance (${distanceUnit()})`, distance),
    ),
    el('div', { class: 'field-row' },
      field('Avg HR', avgHr),
      field('Max HR', maxHr),
      field('Calories', calories),
    ),
    el('div', { class: 'field-row' },
      field(`Elevation gain (${elevationUnit()})`, elevation),
      field('Where', environment),
    ),
    field('Gear', gearInput),
  );

  // What each converted field showed when the form opened. A field the user
  // didn't touch returns its original value exactly: 10000 m shows as
  // 6.21 mi, and 6.21 mi converts back to 9994 m — saving an untouched form
  // must not invent an edit.
  const shown = { duration: duration.value, distance: distance.value, elevation: elevation.value };
  const unchanged = (input, key) => input.value === shown[key];

  const read = () => {
    const n = (input) => (input.value === '' ? null : parseFloat(input.value));
    const movingSec = unchanged(duration, 'duration') ? values.movingSec ?? null : parseHms(duration.value);
    if (Number.isNaN(movingSec)) return { error: 'Duration should look like 45:00 or 1:05:30' };
    const nums = { distance: n(distance), avgHr: n(avgHr), maxHr: n(maxHr), calories: n(calories), elevation: n(elevation) };
    if (Object.values(nums).some((v) => v != null && (Number.isNaN(v) || v < 0))) {
      return { error: 'Numbers can’t be negative' };
    }
    if (nums.avgHr != null && nums.maxHr != null && nums.maxHr < nums.avgHr) {
      return { error: 'Max HR is lower than average HR' };
    }
    return {
      values: {
        movingSec,
        distanceM: unchanged(distance, 'distance') ? values.distanceM ?? null : distanceFromInput(nums.distance),
        avgHr: nums.avgHr == null ? null : Math.round(nums.avgHr),
        maxHr: nums.maxHr == null ? null : Math.round(nums.maxHr),
        calories: nums.calories == null ? null : Math.round(nums.calories),
        elevationM: unchanged(elevation, 'elevation') ? values.elevationM ?? null : elevationFromInput(nums.elevation),
        environment: environment.value || null,
        gearId: gearInput.value || null, // null = the default
      },
    };
  };
  return { el: node, read };
}

// The secondary line under a cardio entry: what the main summary leaves out.
export function cardioExtras(item, gearList) {
  const parts = [];
  if (item.environment === 'indoor') parts.push(item.sport === 'bike' ? 'Indoor trainer' : item.sport === 'run' || item.sport === 'walk' ? 'Treadmill' : 'Indoor');
  if (item.elevationM) parts.push(`↑ ${formatElevation(item.elevationM)}`);
  if (item.calories) parts.push(`${item.calories} kcal`);
  if (item.maxHr) parts.push(`max ${item.maxHr} bpm`);
  const g = gearList?.length ? resolveGear(gearList, item) : null;
  if (g) parts.push(`${gearIcon(g)} ${g.name}`);
  return parts.join(' · ');
}

