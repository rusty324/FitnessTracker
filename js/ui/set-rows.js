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
//
// Timed work (planks, holds, stretches) uses the same rows with time per rep
// in place of weight: [set #] [time − m:ss +] [reps − n +] [✓], stored as
// timed sets (js/sets.js). The time field types like a timer (iPhone's
// number pad has no colon): "45" is 0:45, "130" is 1:30.

import { WEIGHT_STEP } from '../config.js';
import { repsPerSet, weightsPerSet, setFields, weightFields, timedPerSet, timedFields, holdText } from '../sets.js';
import { parseHms, formatHms } from '../cardio.js';
import { timerEntry } from './cardio-form.js';
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
// Exercises whose sets carry a load by default. Everything else — bodyweight,
// mobility, stretches, bands, 'other' — hides the weight column until
// "+ Add weight" (or a last session with added weight) shows it.
const LOADED_MODALITIES = ['barbell', 'dumbbell', 'machine', 'kettlebell'];
export const isLoadedExercise = (ex) => LOADED_MODALITIES.includes(ex?.modality);

// ---------- pure: rows <-> stored shape ----------

// A row: { reps, kg, done, typedReps, typedKg }. reps/kg are the committed
// numbers (null = blank). The typed* flags say the user entered them (vs a
// value loaded from an existing log), which matters only in the log form.

// Rows from a stored `actual` (an existing log), all done. Timed rows carry
// sec (time per rep) instead of kg.
export function rowsFromActual(actual, { timed = false } = {}) {
  if (timed) return timedPerSet(actual).map((t) => ({ reps: t.reps, sec: t.sec, done: true }));
  const reps = repsPerSet(actual);
  const kg = weightsPerSet(actual);
  return reps.map((r, i) => ({ reps: r, kg: kg.length ? kg[i] ?? null : null, done: true }));
}

// The stored fields for the rows that count: done ones (and in the log form,
// any row with reps typed). showWeight false = bodyweight (0 kg added).
export function actualFromRows(rows, { showWeight, includeTyped = false, timed = false }) {
  if (timed) {
    const counted = rows.filter((r) => r.reps != null && r.sec != null && (r.done || (includeTyped && (r.typedReps || r.typedSec))));
    return timedFields(counted.map((r) => ({ reps: r.reps, sec: r.sec })));
  }
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
 * @param {boolean} [o.timed]      time per rep instead of weight (holds, stretches)
 * @param {(i:number)=>void} [o.onCheck]  a set was ticked
 * @param {(state)=>void} [o.onChange]    any change (for drafts)
 */
export function setRows({
  exercise, target = {}, perf = null, rows: startRows = null, showWeight: startShow = null,
  history = [], includeTyped = false, onCheck, onChange, lastColumn = false, timed = false,
}) {
  const lastHadWeight = (perf?.sets ?? []).some((s) => s.weightKg > 0);
  let showWeight = !timed && (startShow ?? (isLoadedExercise(exercise) || lastHadWeight
    || (startRows ?? []).some((r) => r.kg > 0)));
  const planned = Math.min(MAX_SETS, target.sets ?? perf?.sets?.length ?? 1);
  let rows = (startRows?.length ? startRows : Array.from({ length: Math.max(1, planned) }, () => ({})))
    .map((r) => ({ reps: null, kg: null, sec: null, done: false, ...r }));
  // Ghost overrides (Phase B suggestions replace last-time ghosts).
  let ghostOverride = null;

  const ghostOf = (i) => {
    if (ghostOverride) return ghostOverride(i);
    const g = ghostSet(perf, i);
    // A timed target's reps default to one hold per set.
    return {
      reps: g?.reps ?? target.reps ?? target.repsMin ?? (timed ? 1 : null),
      kg: g ? g.weightKg : null,
      sec: g?.durationSec ?? target.durationSec ?? null,
      suggested: false,
    };
  };

  // lastColumn (desktop): each row also shows what that set was last time.
  const wrap = el('div', { class: `set-rows${lastColumn ? ' with-last' : ''}${timed ? ' timed' : ''}` });
  const lastText = (i) => {
    const g = ghostSet(perf, i);
    if (!g) return '—';
    if (timed) return g.reps > 1 ? `${g.reps} × ${holdText(g.durationSec)}` : holdText(g.durationSec);
    return g.weightKg > 0 ? `${kgToDisplay(g.weightKg)} × ${g.reps}` : `${g.reps ?? '—'}`;
  };
  const head = el('div', { class: 'set-row set-head' });
  const list = el('div', {});
  const footer = el('div', { class: 'set-footer' });
  wrap.append(head, list, footer);

  const changed = () => onChange?.(state());

  function renderHead() {
    head.replaceChildren(...[
      el('span', { class: 'set-n' }, 'Set'),
      lastColumn && el('span', { class: 'set-col set-last' }, 'Last'),
      showWeight && el('span', { class: 'set-col' }, `Weight (${weightUnit()})`),
      timed && el('span', { class: 'set-col' }, 'Time'),
      el('span', { class: 'set-col' }, 'Reps'),
      el('span', { class: 'set-check-h' }),
    ].filter(Boolean)); // append(null) would print "null"
    wrap.classList.toggle('no-weight', !showWeight && !timed);
  }

  function stepper({ value, ghost, ghostSuggested, ghostArrow, step, kind, onInput, onStep, label }) {
    const input = el('input', {
      type: 'text',
      inputmode: kind === 'weight' ? 'decimal' : 'numeric',
      value: fmt(value),
      placeholder: fmt(ghost),
      'aria-label': label,
      class: ghostSuggested && value == null ? 'ghost-suggested' : '',
      dataset: { name: kind },
    });
    if (kind === 'time') timerEntry(input); // registered first: formats, then onInput reads
    input.addEventListener('input', () => onInput(input.value));
    // Select on focus, so typing replaces rather than appends.
    input.addEventListener('focus', () => input.select());
    // A suggested value (Phase B) wears its arrow as a small badge above the
    // number (in the placeholder it would crowd out "135" on a phone).
    const arrow = ghostSuggested && ghostArrow && ghost != null ? ghostArrow : null;
    return el('div', { class: 'stepper', dataset: arrow ? { arrow } : {} },
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
        ghostArrow: g.arrow,
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
      // Time per rep: ±5 s under a minute, ±15 s above.
      const timeStep = (base, d) => (base + (d > 0 ? 0 : -1) < 60 ? 5 : 15) * Math.sign(d);
      const timeCell = timed ? stepper({
        kind: 'time',
        label: `Set ${i + 1} time`,
        value: row.sec == null ? null : Number.isNaN(row.sec) ? null : formatHms(row.sec),
        ghost: g.sec == null ? null : formatHms(g.sec),
        step: 1,
        onInput: (text) => {
          const v = parseHms(text);
          row.sec = v == null ? null : Number.isNaN(v) ? NaN : v;
          row.typedSec = true;
          changed();
        },
        onStep: (d) => {
          const base = row.sec ?? g.sec ?? 0;
          const st = timeStep(base, d);
          row.sec = Math.max(0, Math.round((base + st) / Math.abs(st)) * Math.abs(st));
          row.typedSec = true;
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
        ghostArrow: g.arrow,
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
        lastColumn && el('span', { class: 'set-last' }, lastText(i)),
        weightCell,
        timeCell,
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
    const sec = timed ? row.sec ?? g.sec ?? null : null;
    if (reps == null) { toast('Enter reps for this set', 'error'); return; }
    if (timed && sec == null) { toast('Enter a time for this set', 'error'); return; }
    const check = checkSet({ weightKg: showWeight ? kg : null, reps, durationSec: sec, history });
    if (check?.reject) { toast(check.message, 'error'); return; }
    Object.assign(row, { reps, kg, done: true, warning: check?.message ?? null }, timed ? { sec } : {});
    renderRows();
    changed();
    onCheck?.(i);
  }

  function renderFooter() {
    footer.innerHTML = '';
    // Through el(), which skips false/null children: Node.append() would
    // print them as the text "false" / "null".
    footer.replaceChildren(el('div', { class: 'set-footer-inner' },
      rows.length < MAX_SETS && el('button', { class: 'link-btn', type: 'button', onclick: addSet }, '+ Add set'),
      rows.length > 1 && el('button', { class: 'link-btn', type: 'button', onclick: removeSet }, '− Remove set'),
      !showWeight && !timed && el('button', {
        class: 'link-btn', type: 'button',
        onclick: () => { showWeight = true; render(); changed(); },
      }, '+ Add weight'),
    ));
  }

  function addSet() {
    rows.push({ reps: null, kg: null, sec: null, done: false });
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
    return { rows: rows.map(({ warning, ...r }) => r), showWeight, ...(timed ? { timed: true } : {}) };
  }

  return {
    el: wrap,
    state,
    // -> { values } | { error }
    read() {
      for (const [i, r] of rows.entries()) {
        const counted = r.done || (includeTyped && (r.typedReps || (timed && r.typedSec)));
        if (!counted) continue;
        // The log form: a typed time with reps left blank is one rep.
        if (timed && r.reps == null && r.sec != null) r.reps = 1;
        if (timed && r.sec == null && r.reps != null) return { error: `Set ${i + 1}: enter a time` };
        const check = checkSet({ weightKg: showWeight ? r.kg : null, reps: r.reps, durationSec: timed ? r.sec : null, history });
        if (check?.reject) return { error: `Set ${i + 1}: ${check.message}` };
      }
      return { values: actualFromRows(rows, { showWeight, includeTyped, timed }) };
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
