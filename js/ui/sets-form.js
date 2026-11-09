// Sets as a table — reps, weight, and a bodyweight toggle per set — so
// 5 sets planned at 20 × 50 kg can be logged as they actually went:
// 20 @ 50, 20 @ 50, 18 @ 45, 15 @ bodyweight, …
//
// The "All sets" row fills every set (reps, weight, or bodyweight); Sets adds
// or removes rows; editing a row records just that set. A set with blank
// reps is one that wasn't done. Bodyweight is stored as 0 kg added load.

import { repsPerSet, weightsPerSet, setFields, weightFields } from '../sets.js';
import { weightUnit, weightToInput, weightFromInput } from '../units.js';
import { el } from './components.js';

const MAX_SETS = 30;

/**
 * @param {object} actual  the entry's logged values ({} for a new entry)
 * @param {object} target  the plan target, if any
 * @param {object} [o]
 * @param {boolean} [o.bodyweight] new entries start as bodyweight-only
 *   (a bodyweight exercise with no planned weight)
 */
export function setsForm(actual = {}, target = {}, { bodyweight = false } = {}) {
  const isNew = !Object.keys(actual).length;
  const loggedReps = repsPerSet(actual);
  const loggedWeights = weightsPerSet(actual);
  const range = target.repsMin != null && target.repsMax != null ? `${target.repsMin}–${target.repsMax}` : '';
  const count = Math.min(MAX_SETS, loggedReps.length
    || actual.sets
    || (isNew ? target.sets ?? (target.reps != null ? 1 : 0) : 0));
  const newWeight = bodyweight && target.weight == null ? 0 : target.weight ?? null;
  // What each set starts with: what's logged, or for a new entry the plan.
  const startOf = (i) => ({
    reps: loggedReps[i] ?? (isNew ? target.reps ?? null : null),
    kg: loggedWeights.length ? loggedWeights[i] ?? null : isNew ? newWeight : null,
  });

  const num = (attrs) => el('input', { type: 'number', inputmode: 'decimal', min: 0, ...attrs });
  const setsInput = num({ inputmode: 'numeric', step: 1, value: count || '', max: MAX_SETS, dataset: { name: 'sets' } });

  // ---------- rows ----------
  const rows = [];
  const removed = []; // rows removed by lowering Sets, restored if it goes back up
  const tbody = el('tbody', {});

  const setBodyweight = (row, on) => {
    row.bw.checked = on;
    if (on) {
      if (row.weight.value !== '') row.stash = row.weight.value;
      row.weight.value = '';
    } else if (row.weight.disabled && row.weight.value === '') {
      row.weight.value = row.stash ?? '';
    }
    row.weight.disabled = on;
    row.weight.placeholder = on ? 'BW' : '';
  };

  // { reps, kg } in canonical units, or { reps, shown, bw } restored from a
  // removed row.
  const addRow = (start) => {
    const n = rows.length + 1;
    const shown = start.kg ? String(weightToInput(start.kg)) : '';
    const row = {
      reps: num({ inputmode: 'numeric', step: 1, value: start.reps ?? '', placeholder: range, 'aria-label': `Set ${n} reps`, dataset: { set: n } }),
      weight: num({ step: 0.5, value: start.shown ?? shown, 'aria-label': `Set ${n} weight`, dataset: { setWeight: n } }),
      bw: el('input', { type: 'checkbox', 'aria-label': `Set ${n} bodyweight only`, dataset: { setBw: n } }),
      // What the weight showed when the row was made, and in kg: unchanged,
      // it saves as exactly that kg (50 kg shows as 110.2 lb, which converts
      // back to 49.99).
      shown: start.shown ?? shown,
      kg: start.kg ?? null,
      stash: null,
    };
    if (start.bw ?? start.kg === 0) setBodyweight(row, true);
    row.reps.addEventListener('input', syncAll);
    row.weight.addEventListener('input', syncAll);
    row.bw.addEventListener('change', () => { setBodyweight(row, row.bw.checked); syncAll(); });
    row.tr = el('tr', {},
      el('th', { scope: 'row' }, `Set ${n}`),
      el('td', {}, row.reps), el('td', {}, row.weight), el('td', { class: 'bw' }, row.bw));
    rows.push(row);
    tbody.append(row.tr);
  };

  // ---------- the "All sets" row ----------
  const allReps = num({ inputmode: 'numeric', step: 1, 'aria-label': 'Reps for every set', dataset: { name: 'reps' } });
  const allWeight = num({ step: 0.5, 'aria-label': 'Weight for every set', dataset: { name: 'weight' } });
  const allBw = el('input', { type: 'checkbox', 'aria-label': 'Bodyweight only, every set', dataset: { name: 'bw' } });

  // Shows the shared value, or says the sets vary. With no sets yet there's
  // nothing to summarise: the All row keeps what's been typed or ticked, and
  // sets added next start from it.
  function syncAll() {
    if (!rows.length) {
      allBw.indeterminate = false;
      allWeight.disabled = allBw.checked;
      allWeight.placeholder = allBw.checked ? 'BW' : '';
      return;
    }
    const reps = rows.map((r) => r.reps.value);
    const sameReps = reps.length && reps.every((x) => x !== '' && x === reps[0]);
    allReps.value = sameReps ? reps[0] : '';
    allReps.placeholder = sameReps || reps.every((x) => x === '') ? range : 'varies';

    const allBodyweight = rows.length > 0 && rows.every((r) => r.bw.checked);
    allBw.checked = allBodyweight;
    allBw.indeterminate = !allBodyweight && rows.some((r) => r.bw.checked);
    allWeight.disabled = allBodyweight;
    const w = rows.map((r) => (r.bw.checked ? 'bw' : r.weight.value));
    const sameW = w.length && w.every((x) => x !== '' && x === w[0]) && w[0] !== 'bw';
    allWeight.value = sameW ? w[0] : '';
    allWeight.placeholder = allBodyweight ? 'BW' : sameW || w.every((x) => x === '') ? '' : 'varies';
  }

  allReps.addEventListener('input', () => {
    for (const r of rows) r.reps.value = allReps.value;
    allReps.placeholder = range;
  });
  allWeight.addEventListener('input', () => {
    allBw.checked = false;
    for (const r of rows) {
      setBodyweight(r, false);
      r.weight.value = allWeight.value;
    }
    syncAll();
  });
  allBw.addEventListener('change', () => {
    for (const r of rows) setBodyweight(r, allBw.checked);
    syncAll();
  });

  const resize = (n) => {
    while (rows.length > n) {
      const r = rows.pop();
      removed.push({ reps: r.reps.value, shown: r.weight.disabled ? r.stash ?? '' : r.weight.value, bw: r.bw.checked, kg: r.kg });
      r.tr.remove();
    }
    while (rows.length < n) addRow(removed.length ? removed.pop() : freshRow());
    syncAll();
  };

  // A set added by raising Sets copies the one before it; the first copies
  // the All row, or for a new entry the plan (bodyweight for a bodyweight
  // exercise).
  const freshRow = () => {
    const last = rows.at(-1);
    if (last) {
      return { reps: allReps.value || last.reps.value, shown: last.weight.disabled ? last.stash ?? '' : last.weight.value, bw: last.bw.checked, kg: null };
    }
    const s = isNew ? startOf(0) : { reps: null, kg: null };
    const weight = allBw.checked ? { bw: true, kg: null }
      : allWeight.value ? { shown: allWeight.value, bw: false, kg: null }
        : { kg: s.kg === 0 ? null : s.kg, bw: false };
    return { reps: allReps.value || (s.reps ?? ''), ...weight };
  };

  for (let i = 0; i < count; i++) addRow(startOf(i));
  // A new bodyweight entry with no sets yet still shows as bodyweight.
  if (!count) allBw.checked = isNew && newWeight === 0;
  syncAll();

  // A half-typed Sets value (cleared to retype) doesn't remove anything.
  setsInput.addEventListener('input', () => {
    const n = parseInt(setsInput.value, 10);
    if (Number.isFinite(n) && n >= 0) resize(Math.min(MAX_SETS, n));
  });

  const table = el('table', { class: 'sets-table' },
    el('thead', {}, el('tr', {},
      el('th', {}, ''), el('th', { scope: 'col' }, 'Reps'), el('th', { scope: 'col' }, `Weight (${weightUnit()})`),
      el('th', { scope: 'col', class: 'bw', title: 'Bodyweight only — no added weight' }, 'BW'))),
    el('tbody', { class: 'all-sets' }, el('tr', {},
      el('th', { scope: 'row' }, 'All sets'), el('td', {}, allReps), el('td', {}, allWeight), el('td', { class: 'bw' }, allBw))),
    tbody,
  );

  const read = () => {
    const done = rows.filter((r) => r.reps.value !== '');
    const reps = done.map((r) => Number(r.reps.value));
    if (reps.some((x) => !Number.isInteger(x) || x < 0)) return { error: 'Reps should be whole numbers' };
    const weightOf = (r) => {
      if (r.bw.checked) return 0;
      if (r.weight.value === '') return null;
      return r.weight.value === r.shown && r.kg != null ? r.kg : weightFromInput(Number(r.weight.value));
    };
    // Sets with no reps recorded keep their weight, as the form always allowed.
    const weighed = (done.length ? done : rows).map(weightOf);
    if (weighed.some((w) => w != null && (Number.isNaN(w) || w < 0))) return { error: 'Weights can’t be negative' };
    if (done.length) return { values: { ...setFields(reps), ...weightFields(weighed) } };
    const n = parseInt(setsInput.value, 10);
    return { values: { ...(Number.isFinite(n) ? { sets: n } : {}), ...weightFields(weighed) } };
  };

  return { sets: setsInput, table, read };
}
