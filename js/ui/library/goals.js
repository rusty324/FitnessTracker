// Library → Goals: bodyweight, run times and exercise targets.
import * as store from '../../storage/store.js';
import { confirmDialog, el, emptyState, openModal, toast } from '../components.js';
import { distanceFromInput, distanceToInput, distanceUnit, formatDistance, formatWeight, weightFromInput, weightToInput, weightUnit } from '../../units.js';
import { weightOn } from '../../rwi.js';
import { formatDate, todayStr } from '../../dates.js';
import { RUN_GOAL_PRESETS } from '../../config.js';
import { pickExercise, targetSummary } from '../plans-tab.js';
import { summarizeActual } from './exercise-progress.js';
import { makeGoal } from '../../models.js';
import { render } from '../library-tab.js';
import { S } from './state.js';

// ---------- Goals ----------

export const fmtTime = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export function renderGoals() {
  const goals = store.get('goals');
  S.root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'Goals'),
    el('button', { class: 'btn small', onclick: () => editGoal(null) }, '+ New goal'),
  ));
  if (!goals.length) {
    S.root.appendChild(emptyState('No goals yet. Add a bodyweight target, a run time, or an exercise goal.'));
    return;
  }
  const exById = new Map(store.get('exercises').map((e) => [e.id, e]));
  for (const g of goals) S.root.appendChild(goalCard(g, exById));
}

export function goalCard(goal, exById) {
  let title = '';
  let progress = '';
  if (goal.type === 'bodyweight') {
    title = `Bodyweight: ${formatWeight(goal.targetWeight)}`;
    const current = weightOn(todayStr(), store.get('metrics'));
    if (current != null) {
      const diff = current - goal.targetWeight;
      progress = `current ${formatWeight(current)} · ${diff > 0 ? formatWeight(Math.abs(diff)) + ' to lose' : diff < 0 ? formatWeight(Math.abs(diff)) + ' to gain' : 'at goal 🎉'}`;
    } else {
      progress = 'no body weight logged yet';
    }
  } else if (goal.type === 'runTime') {
    const preset = RUN_GOAL_PRESETS.find((p) => p.distanceM === goal.distanceM);
    title = `${preset?.label ?? formatDistance(goal.distanceM)} in ${fmtTime(goal.targetSec)}`;
    const best = bestRunEffort(goal.distanceM);
    progress = best
      ? `best so far ${fmtTime(best.sec)} (${formatDate(best.date)})${best.sec <= goal.targetSec ? ' — goal met 🎉' : ` · ${fmtTime(best.sec - goal.targetSec)} to go`}`
      : 'no matching runs logged yet';
  } else {
    const ex = exById.get(goal.exerciseId);
    title = `${ex?.name ?? 'Exercise'}: ${targetSummary(goal.target)}`;
    const last = store.get('logs').filter((l) => l.exerciseId === goal.exerciseId).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    progress = last ? `last: ${summarizeActual(last.actual)} (${formatDate(last.date)})` : 'not logged yet';
  }
  return el('div', { class: 'card tappable', onclick: () => editGoal(goal) },
    el('div', { class: 'list-row', style: 'border:none;padding:0' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, title),
        el('div', { class: 'row-sub' }, progress),
        goal.targetDate && el('div', { class: 'row-sub' }, `by ${formatDate(goal.targetDate, { month: 'short', day: 'numeric', year: 'numeric' })}`),
        goal.notes && el('div', { class: 'row-sub' }, goal.notes),
      ),
      el('span', { class: 'pill accent' }, goal.type === 'runTime' ? 'run time' : goal.type),
    ),
  );
}

// Fastest logged effort whose distance is within ±2.5% of the goal distance,
// across synced activities and manual distance logs.
export function bestRunEffort(distanceM) {
  const tol = distanceM * 0.025;
  let best = null;
  const consider = (d, sec, date) => {
    if (d == null || sec == null) return;
    if (Math.abs(d - distanceM) > tol) return;
    // Normalize to exact goal distance by pace so 5.05 km counts fairly.
    const normalized = sec * (distanceM / d);
    if (!best || normalized < best.sec) best = { sec: Math.round(normalized), date };
  };
  for (const e of store.getActivityEntries()) consider(e.distanceM, e.movingSec, e.date);
  for (const l of store.get('logs')) consider(l.actual?.distanceM, l.actual?.movingSec, l.date);
  return best;
}

export function editGoal(goal) {
  const isNew = !goal;
  const draft = goal ? { ...goal } : makeGoal();
  let pickedExercise = draft.exerciseId ? store.get('exercises').find((e) => e.id === draft.exerciseId) : null;

  const typeSel = el('select', {},
    el('option', { value: 'bodyweight', selected: draft.type === 'bodyweight' }, 'Bodyweight'),
    el('option', { value: 'runTime', selected: draft.type === 'runTime' }, 'Run time'),
    el('option', { value: 'exercise', selected: draft.type === 'exercise' }, 'Exercise'),
  );
  const dateInput = el('input', { type: 'date', value: draft.targetDate ?? '' });
  const notesInput = el('input', { value: draft.notes ?? '', placeholder: 'optional' });
  const fields = el('div', {});
  const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
  const num = (name, value, step = 1) =>
    el('input', { type: 'number', inputmode: 'decimal', step, value: value ?? '', dataset: { name } });

  function renderFields() {
    const type = typeSel.value;
    fields.innerHTML = '';
    if (type === 'bodyweight') {
      fields.append(field(`Target weight (${weightUnit()})`, num('weight', weightToInput(draft.targetWeight) ?? '', 0.5)));
    } else if (type === 'runTime') {
      const presetSel = el('select', { dataset: { name: 'preset' } },
        RUN_GOAL_PRESETS.map((p) => el('option', { value: p.distanceM, selected: draft.distanceM === p.distanceM }, p.label)),
        el('option', { value: 'custom', selected: draft.distanceM != null && !RUN_GOAL_PRESETS.some((p) => p.distanceM === draft.distanceM) }, 'Custom…'),
      );
      const customWrap = el('div', { class: 'field', hidden: presetSel.value !== 'custom' },
        el('label', {}, `Distance (${distanceUnit()})`),
        num('customDist', draft.distanceM ? distanceToInput(draft.distanceM) : '', 0.1));
      presetSel.addEventListener('change', () => { customWrap.hidden = presetSel.value !== 'custom'; });
      const totalSec = draft.targetSec ?? 0;
      fields.append(
        field('Distance', presetSel),
        customWrap,
        el('div', { class: 'field-row' },
          field('Target minutes', num('goalMin', totalSec ? Math.floor(totalSec / 60) : '')),
          field('Seconds', num('goalSec', totalSec ? Math.round(totalSec % 60) : '')),
        ),
      );
    } else {
      const pickBtn = el('button', {
        class: 'btn secondary small',
        onclick: () => pickExercise((ex) => {
          pickedExercise = ex;
          pickBtn.textContent = ex.name;
        }),
      }, pickedExercise?.name ?? 'Pick exercise…');
      fields.append(
        el('div', { class: 'field' }, el('label', {}, 'Exercise'), pickBtn),
        el('div', { class: 'field-row' },
          field('Sets', num('sets', draft.target?.sets ?? '')),
          field('Reps', num('reps', draft.target?.reps ?? '')),
          field(`Weight (${weightUnit()})`, num('exWeight', weightToInput(draft.target?.weight) ?? '', 0.5)),
        ),
        el('div', { class: 'field-row' },
          field('Duration (min)', num('durMin', draft.target?.durationSec ? draft.target.durationSec / 60 : '')),
          field(`Distance (${distanceUnit()})`, num('dist', draft.target?.distanceM ? distanceToInput(draft.target.distanceM) : '', 0.1)),
        ),
      );
    }
  }
  typeSel.addEventListener('change', renderFields);
  renderFields();

  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        const val = (n) => {
          const v = parseFloat(fields.querySelector(`[data-name="${n}"]`)?.value);
          return isNaN(v) ? null : v;
        };
        const type = typeSel.value;
        draft.type = type;
        draft.targetDate = dateInput.value || null;
        draft.notes = notesInput.value.trim();
        if (type === 'bodyweight') {
          const w = val('weight');
          if (w == null) { toast('Enter a target weight', 'error'); return false; }
          draft.targetWeight = weightFromInput(w);
        } else if (type === 'runTime') {
          const presetSel = fields.querySelector('[data-name="preset"]');
          draft.distanceM = presetSel.value === 'custom'
            ? (val('customDist') != null ? distanceFromInput(val('customDist')) : null)
            : Number(presetSel.value);
          const sec = (val('goalMin') ?? 0) * 60 + (val('goalSec') ?? 0);
          if (!draft.distanceM || !sec) { toast('Enter a distance and target time', 'error'); return false; }
          draft.targetSec = Math.round(sec);
        } else {
          if (!pickedExercise) { toast('Pick an exercise', 'error'); return false; }
          draft.exerciseId = pickedExercise.id;
          const target = {};
          if (val('reps') != null) { target.kind = 'reps'; target.reps = val('reps'); if (val('sets') != null) target.sets = val('sets'); if (val('exWeight') != null) target.weight = weightFromInput(val('exWeight')); }
          else if (val('durMin') != null) { target.kind = 'duration'; target.durationSec = Math.round(val('durMin') * 60); }
          else if (val('dist') != null) { target.kind = 'distance'; target.distanceM = distanceFromInput(val('dist')); }
          if (!target.kind) { toast('Enter a target (reps, duration, or distance)', 'error'); return false; }
          draft.target = target;
        }
        store.upsert('goals', draft);
        render();
      },
    },
  ];
  if (!isNew) {
    actions.unshift({
      label: 'Delete',
      class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog('Delete this goal?'))) return false;
        store.remove('goals', draft.id);
        render();
      },
    });
  }
  openModal(isNew ? 'New goal' : 'Edit goal', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Goal type'), typeSel),
    fields,
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Target date (optional)'), dateInput),
      el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
    ),
  ), actions);
}
