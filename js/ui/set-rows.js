// Set rows for the gym floor: [set #] [weight − n +] [reps − n +] [✓].
// One component for Today's inline logging and the log form (logEntryModal).
//
// Ghost values: each row shows what you did last time (set i of the last
// session at this variant; with fewer sets then, the last repeats) as muted
// placeholder text — or, with no history, the planned reps. Tapping ✓ on
// fields you haven't touched commits the ghosts: the one-tap "same as last
// time". Fields you edit commit as typed.
//
// Weights are stored in kg and converted only here, at the edge. A typed
// weight is stored with enough precision to show the same number again
// (135 lb -> 61.235 kg -> 135 lb); a weight that was loaded and left alone
// saves its original kg exactly.
//
// Bodyweight exercises hide the weight column ("+ Add weight" shows it, and
// it shows itself if the last session had added weight). Hidden weight is
// stored as 0 kg added — the app's existing "bodyweight" convention.

import { WEIGHT_STEP } from '../config.js';
import { repsPerSet, weightsPerSet, setFields, weightFields } from '../sets.js';
import { weightUnit } from '../units.js';
import { ghostSet } from '../history.js';
import { checkSet } from '../sanity.js';
import { el, toast, undoToast } from './components.js';

const LB_PER_KG = 2.20462262;
const MAX_SETS = 30;

// ---------- units at the edge ----------

const isLb = () => weightUnit() === 'lb';
export function kgToDisplay(kg) {
  if (kg == null) return null;
  const v = isLb() ? kg * LB_PER_KG : kg;
  return Math.round(v * 10) / 10; // 61.235 kg -> 135 lb, never 134.99
}
export function displayToKg(v) {
  if (v == null) return null;
  return isLb() ? Math.round((v / LB_PER_KG) * 1000) / 1000 : v;
}
const fmt = (v) => (v == null ? '' : String(v));

// Stepper size in the display unit.
export function weightStep(exercise) {
  if (exercise?.weightStepKg > 0) return kgToDisplay(exercise.weightStepKg);
  const table = WEIGHT_STEP[isLb() ? 'imperial' : 'metric'];
  return table[exercise?.modality] ?? table.other;
}
const roundTo = (v, step) => Math.round(Math.round(v / step) * step * 1000) / 1000;

export const isBodyweightExercise = (ex) => ex?.modality === 'bodyweight';

// ---------- pure: rows <-> stored shape ----------

// A row: { reps, kg, done, typedReps, typedKg }. reps/kg are the committed
// numbers (null = blank). The typed* flags say the user entered them (vs a
// value loaded from an existing log), which matters only in the log form.

// Rows from a stored `actual` (an existing log), all done.
export function rowsFromActual(actual) {
  const reps = repsPerSet(actual);
  const kg = weightsPerSet(actual);
  return reps.map((r, i) => ({ reps: r, kg: kg.length ? kg[i] ?? null : null, done: true }));
}

// The stored fields for the rows that count: done ones (and in the log form,
// any row with reps typed). showWeight false = bodyweight (0 kg added).
export function actualFromRows(rows, { showWeight, includeTyped = false }) {
  const counted = rows.filter((r) => r.reps != null && (r.done || (includeTyped && r.typedReps)));
  if (!counted.length) return {};
  const reps = counted.map((r) => r.reps);
  const kg = counted.map((r) => (showWeight ? r.kg ?? null : 0));
  return { ...setFields(reps), ...weightFields(kg) };
}

// ---------- the component ----------

/**
 * @param {object} o
 * @param {object} o.exercise
 * @param {object} [o.target]      plan target (planned sets / reps)
 * @param {object} [o.perf]        lastPerformance() result, for ghosts
 * @param {object[]} [o.rows]      starting rows (a draft, or rowsFromActual)
 * @param {boolean} [o.showWeight] starting weight-column visibility
 * @param {object[]} [o.history]   prior sets [{weightKg, reps}] for sanity checks
 * @param {boolean} [o.includeTyped] log form: rows with typed reps count without ✓
 * @param {(i:number)=>void} [o.onCheck]  a set was ticked
 * @param {(state)=>void} [o.onChange]    any change (for drafts)
 */
export function setRows({
  exercise, target = {}, perf = null, rows: startRows = null, showWeight: startShow = null,
  history = [], includeTyped = false, onCheck, onChange,
}) {
  const bodyweight = isBodyweightExercise(exercise);
  const lastHadWeight = (perf?.sets ?? []).some((s) => s.weightKg > 0);
  let showWeight = startShow ?? (!bodyweight || lastHadWeight
    || (startRows ?? []).some((r) => r.kg > 0));
  const planned = Math.min(MAX_SETS, target.sets ?? perf?.sets?.length ?? 1);
  let rows = (startRows?.length ? startRows : Array.from({ length: Math.max(1, planned) }, () => ({})))
    .map((r) => ({ reps: null, kg: null, done: false, ...r }));
  // Ghost overrides (Phase B suggestions replace last-time ghosts).
  let ghostOverride = null;

  const ghostOf = (i) => {
    if (ghostOverride) return ghostOverride(i);
    const g = ghostSet(perf, i);
    return {
      reps: g?.reps ?? target.reps ?? target.repsMin ?? null,
      kg: g ? g.weightKg : null,
      suggested: false,
    };
  };

  const wrap = el('div', { class: 'set-rows' });
  const head = el('div', { class: 'set-row set-head' });
  const list = el('div', {});
  const footer = el('div', { class: 'set-footer' });
  wrap.append(head, list, footer);

  const changed = () => onChange?.(state());

  function renderHead() {
    head.innerHTML = '';
    head.append(
      el('span', { class: 'set-n' }, 'Set'),
      showWeight ? el('span', { class: 'set-col' }, `Weight (${weightUnit()})`) : null,
      el('span', { class: 'set-col' }, 'Reps'),
      el('span', { class: 'set-check-h' }),
    );
    wrap.classList.toggle('no-weight', !showWeight);
  }

  function stepper({ value, ghost, ghostSuggested, step, kind, onInput, onStep, label }) {
    const input = el('input', {
      type: 'text',
      inputmode: kind === 'weight' ? 'decimal' : 'numeric',
      value: fmt(value),
      placeholder: fmt(ghost),
      'aria-label': label,
      class: ghostSuggested && value == null ? 'ghost-suggested' : '',
      dataset: { name: kind },
    });
    input.addEventListener('input', () => onInput(input.value));
    // Select on focus, so typing replaces rather than appends.
    input.addEventListener('focus', () => input.select());
    return el('div', { class: 'stepper' },
      el('button', { class: 'step-btn', type: 'button', 'aria-label': `${label} minus`, onclick: () => onStep(-step) }, '−'),
      input,
      el('button', { class: 'step-btn', type: 'button', 'aria-label': `${label} plus`, onclick: () => onStep(step) }, '+'),
    );
  }

  const parse = (text) => {
    const t = String(text).trim().replace(',', '.');
    if (t === '') return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  };

  function renderRows() {
    list.innerHTML = '';
    rows.forEach((row, i) => {
      const g = ghostOf(i);
      const wStep = weightStep(exercise);
      const warn = el('div', { class: 'set-warn', role: 'status' }, row.warning ?? '');
      const weightCell = showWeight ? stepper({
        kind: 'weight',
        label: `Set ${i + 1} weight`,
        value: kgToDisplay(row.kg),
        ghost: kgToDisplay(g.kg),
        ghostSuggested: g.suggested,
        step: wStep,
        onInput: (text) => {
          const v = parse(text);
          row.kg = v == null ? null : Number.isNaN(v) ? NaN : displayToKg(v);
          row.typedKg = true;
          changed();
        },
        onStep: (d) => {
          const base = kgToDisplay(row.kg) ?? kgToDisplay(g.kg) ?? 0;
          row.kg = displayToKg(Math.max(0, roundTo(base + d, Math.abs(d))));
          row.typedKg = true;
          renderRows();
          changed();
        },
      }) : null;
      const repsCell = stepper({
        kind: 'reps',
        label: `Set ${i + 1} reps`,
        value: row.reps,
        ghost: g.reps,
        ghostSuggested: g.suggested,
        step: 1,
        onInput: (text) => {
          const v = parse(text);
          row.reps = v == null ? null : Number.isNaN(v) ? NaN : v;
          row.typedReps = true;
          changed();
        },
        onStep: (d) => {
          row.reps = Math.max(0, (row.reps ?? g.reps ?? 0) + d);
          row.typedReps = true;
          renderRows();
          changed();
        },
      });
      const check = el('button', {
        class: `set-check${row.done ? ' done' : ''}`,
        type: 'button',
        'aria-label': row.done ? `Set ${i + 1} done — tap to undo` : `Set ${i + 1}: done`,
        'aria-pressed': row.done ? 'true' : 'false',
        onclick: () => toggle(i),
      }, '✓');
      list.append(el('div', { class: `set-row${row.done ? ' is-done' : ''}`, dataset: { set: i + 1 } },
        el('span', { class: 'set-n' }, String(i + 1)),
        weightCell,
        repsCell,
        check,
      ));
      if (row.warning) list.append(warn); // append(null) would print "null"
    });
  }

  // ✓: commit typed values, filling untouched fields from the ghosts.
  function toggle(i) {
    const row = rows[i];
    if (row.done) {
      row.done = false;
      renderRows();
      changed();
      return;
    }
    const g = ghostOf(i);
    const reps = row.reps ?? g.reps;
    const kg = showWeight ? row.kg ?? g.kg ?? null : null;
    if (reps == null) { toast('Enter reps for this set', 'error'); return; }
    const check = checkSet({ weightKg: showWeight ? kg : null, reps, history });
    if (check?.reject) { toast(check.message, 'error'); return; }
    Object.assign(row, { reps, kg, done: true, warning: check?.message ?? null });
    renderRows();
    changed();
    onCheck?.(i);
  }

  function renderFooter() {
    footer.innerHTML = '';
    footer.append(
      rows.length < MAX_SETS && el('button', { class: 'link-btn', type: 'button', onclick: addSet }, '+ Add set'),
      rows.length > 1 && el('button', { class: 'link-btn', type: 'button', onclick: removeSet }, '− Remove set'),
      bodyweight && !showWeight && el('button', {
        class: 'link-btn', type: 'button',
        onclick: () => { showWeight = true; render(); changed(); },
      }, '+ Add weight'),
    );
  }

  function addSet() {
    rows.push({ reps: null, kg: null, done: false });
    render();
    changed();
  }
  // Removing a set: no confirm — an Undo toast instead.
  function removeSet() {
    const i = rows.length - 1;
    const removed = rows.pop();
    render();
    changed();
    undoToast(`Set ${i + 1} removed`, {
      onUndo: () => { rows.splice(i, 0, removed); render(); changed(); },
    });
  }

  function render() {
    renderHead();
    renderRows();
    renderFooter();
  }
  render();

  function state() {
    return { rows: rows.map(({ warning, ...r }) => r), showWeight };
  }

  return {
    el: wrap,
    state,
    // -> { values } | { error }
    read() {
      for (const [i, r] of rows.entries()) {
        const counted = r.done || (includeTyped && r.typedReps);
        if (!counted) continue;
        const check = checkSet({ weightKg: showWeight ? r.kg : null, reps: r.reps, history });
        if (check?.reject) return { error: `Set ${i + 1}: ${check.message}` };
      }
      return { values: actualFromRows(rows, { showWeight, includeTyped }) };
    },
    allDone: () => rows.length > 0 && rows.every((r) => r.done),
    anyDone: () => rows.some((r) => r.done),
    // Phase B: show suggested values as the ghosts (fn(i) -> {reps, kg,
    // suggested}), or null to go back to last time.
    setGhosts(fn) {
      ghostOverride = fn;
      renderRows();
    },
  };
}
