// Training Plans tab: v2 plan structure (weeks -> sessions -> blocks ->
// items), calendar view, and import/export in the fitness-tracker-plan v2
// schema. The exercise library UI lives in the Fitness Library tab; the
// picker/editor helpers here are shared with it and with the Logs tab.

import * as store from '../storage/store.js';
import {
  makePlan, makeWeek, makeSession, makeBlock, makeBlockItem, makeExercise,
  migrateExercise, allSessions, sessionItems, phaseForWeek,
  sanitizeCategory, sanitizeModality, sanitizeMeasurement,
} from '../models.js';
import { CATEGORIES, MODALITIES, MEASUREMENT_TYPES, TARGET_KINDS } from '../config.js';
import { todayStr, addDays, toDateStr, parseDateStr, formatDate, formatDuration } from '../dates.js';
import {
  formatWeight, formatDistance, formatPaceValue, paceUnit,
  weightUnit, weightToInput, weightFromInput,
  distanceUnit, distanceToInput, distanceFromInput, paceToInput, paceFromInput,
} from '../units.js';
import { el, openModal, confirmDialog, toast, emptyState, downloadJson, filePicker } from './components.js';
import { loadManifest, loadPreset } from '../presets.js';

let root = null;
let unsub = null;
let view = { name: 'list' }; // {name:'list'} | {name:'plan', planId} | {name:'calendar'}
let calMonth = null;

export function mount(elRoot) {
  root = elRoot;
  unsub = store.onChange((e) => {
    if (e.type === 'changed') render();
  });
  render();
}

export function unmount() {
  unsub?.();
  root = null;
}

function render() {
  if (!root) return;
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'segmented' },
    segBtn('Plans', view.name === 'list' || view.name === 'plan', () => { view = { name: 'list' }; render(); }),
    segBtn('Calendar', view.name === 'calendar', () => { view = { name: 'calendar' }; render(); }),
  ));
  if (view.name === 'plan') renderPlanDetail(view.planId);
  else if (view.name === 'calendar') renderCalendar();
  else renderPlanList();
}

function segBtn(label, active, onclick) {
  return el('button', { class: active ? 'active' : '', onclick }, label);
}

// ---------- Plan list ----------

function renderPlanList() {
  const plans = store.get('plans');
  const active = plans.filter((p) => p.status === 'active');
  const archived = plans.filter((p) => p.status !== 'active');

  root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'Training plans'),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => importPlanModal() }, 'Import'),
      el('button', { class: 'btn small', onclick: () => editPlanMeta(null) }, '+ New plan'),
    ),
  ));

  if (!plans.length) {
    root.appendChild(emptyState('No plans yet. Create one, or Import a .plan.json file.'));
    return;
  }
  for (const p of active) root.appendChild(planCard(p));
  if (archived.length) {
    root.appendChild(el('h3', { class: 'muted' }, 'Archived'));
    for (const p of archived) root.appendChild(planCard(p));
  }
}

function planCard(plan) {
  const sessions = allSessions(plan);
  const weeks = plan.weeks?.length ?? 0;
  const sub = [
    `${weeks} week${weeks === 1 ? '' : 's'}`,
    `${sessions.length} session${sessions.length === 1 ? '' : 's'}`,
    `starts ${formatDate(plan.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}`,
  ].join(' · ');
  return el('div', {
    class: 'card tappable',
    onclick: () => { view = { name: 'plan', planId: plan.id }; render(); },
  },
    el('div', { class: 'list-row', style: 'border:none;padding:0' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, plan.name),
        plan.goal && el('div', { class: 'row-sub' }, `🎯 ${plan.goal}`),
        el('div', { class: 'row-sub' }, sub),
      ),
      el('div', { class: 'row-actions' },
        plan.level && el('span', { class: 'pill' }, plan.level),
        el('span', { class: `pill ${plan.status === 'active' ? 'accent' : ''}` }, plan.type),
      ),
    ),
  );
}

function editPlanMeta(plan) {
  const isNew = !plan;
  const draft = plan ? JSON.parse(JSON.stringify(plan)) : makePlan();
  const nameInput = el('input', { value: draft.name, placeholder: 'e.g. 10k progression, Push/Pull/Legs' });
  const typeInput = el('input', { value: draft.type, placeholder: 'strength / running / …' });
  const goalInput = el('input', { value: draft.goal ?? '', placeholder: 'e.g. Complete a 10K distance' });
  const dateInput = el('input', { type: 'date', value: draft.startDate });
  const statusSel = el('select', {},
    el('option', { value: 'active', selected: draft.status === 'active' }, 'Active'),
    el('option', { value: 'archived', selected: draft.status === 'archived' }, 'Archived'),
  );
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
    el('div', { class: 'field' }, el('label', {}, 'Goal (optional)'), goalInput),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Type'), typeInput),
      el('div', { class: 'field' }, el('label', {}, 'Start date'), dateInput),
    ),
    !isNew && el('div', { class: 'field' }, el('label', {}, 'Status'), statusSel),
  );
  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: isNew ? 'Create' : 'Save',
      class: 'btn',
      onClick: () => {
        if (!nameInput.value.trim()) { toast('Give the plan a name', 'error'); return false; }
        Object.assign(draft, {
          name: nameInput.value.trim(),
          type: typeInput.value.trim() || 'custom',
          goal: goalInput.value.trim(),
          startDate: dateInput.value || todayStr(),
          status: isNew ? 'active' : statusSel.value,
        });
        store.upsert('plans', draft);
        if (isNew) view = { name: 'plan', planId: draft.id };
        render();
      },
    },
  ];
  if (!isNew) {
    actions.unshift({
      label: 'Delete',
      class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog(`Delete plan “${plan.name}” and all its sessions?`))) return false;
        store.remove('plans', plan.id);
        view = { name: 'list' };
        render();
      },
    });
  }
  openModal(isNew ? 'New plan' : 'Edit plan', body, actions);
}

// ---------- Plan detail (grouped by week) ----------

function renderPlanDetail(planId) {
  const plan = store.get('plans').find((p) => p.id === planId);
  if (!plan) { view = { name: 'list' }; render(); return; }
  const exercises = new Map(store.get('exercises').map((e) => [e.id, e]));

  root.appendChild(el('div', { class: 'list-row' },
    el('div', { class: 'row-main' },
      el('button', { class: 'btn small secondary', onclick: () => { view = { name: 'list' }; render(); } }, '‹ Plans'),
    ),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => exportPlan(plan) }, 'Export'),
      el('button', { class: 'btn small secondary', onclick: () => editPlanMeta(plan) }, 'Edit'),
    ),
  ));
  root.appendChild(el('h2', {}, plan.name, ' ', el('span', { class: 'pill accent' }, plan.type)));
  if (plan.goal) root.appendChild(el('p', { class: 'muted' }, `🎯 ${plan.goal}`));
  if (plan.description) root.appendChild(el('p', { class: 'muted' }, plan.description));
  if (plan.assumptions?.length) {
    root.appendChild(el('div', { class: 'card' },
      el('h3', {}, 'Assumptions'),
      el('ul', { style: 'margin:0;padding-left:18px' }, plan.assumptions.map((a) => el('li', { class: 'muted' }, a))),
    ));
  }

  for (const week of plan.weeks ?? []) {
    const phase = phaseForWeek(plan, week.index);
    root.appendChild(el('div', { class: 'list-row', style: 'border:none;margin-top:8px' },
      el('div', { class: 'row-main' },
        el('h3', { style: 'margin:0' },
          `Week ${week.index}`,
          week.isDeload ? el('span', { class: 'pill warn', style: 'margin-left:8px' }, 'deload') : '',
          phase ? el('span', { class: 'pill', style: 'margin-left:8px' }, phase.name) : '',
        ),
        week.focus && el('div', { class: 'row-sub' }, week.focus),
      ),
    ));
    for (const session of week.sessions) {
      root.appendChild(sessionCard(plan, week, session, exercises));
    }
  }
  if (!plan.weeks?.length) root.appendChild(el('p', { class: 'muted' }, 'No sessions yet.'));
  root.appendChild(el('button', { class: 'btn', onclick: () => editSession(plan, null) }, '+ Add session'));
}

function sessionCard(plan, week, session, exercises) {
  const dayOffset = session.dayOffset ?? (week.index - 1) * 7 + (session.dayInWeek ?? 0);
  const date = addDays(plan.startDate, dayOffset);
  const items = sessionItems(session);
  const exNames = items.map(({ item }) => exercises.get(item.exerciseId)?.shortName || exercises.get(item.exerciseId)?.name || '?').join(', ');
  return el('div', { class: 'card' },
    el('div', { class: 'list-row', style: 'border:none;padding:0' },
      el('div', { class: 'row-main tappable', onclick: () => editSession(plan, session) },
        el('div', { class: 'row-title' }, session.label || 'Session'),
        el('div', { class: 'row-sub' },
          `${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}`
          + `${session.sessionType ? ` · ${session.sessionType}` : ''}`
          + `${session.estimatedDurationMin ? ` · ~${session.estimatedDurationMin} min` : ''}`),
        exNames && el('div', { class: 'row-sub' }, exNames),
        session.note && el('div', { class: 'row-sub' }, session.note),
      ),
    ),
  );
}

// ---------- Session editor (blocks + items) ----------

function editSession(plan, session) {
  const isNew = !session;
  const draft = session ? JSON.parse(JSON.stringify(session)) : makeSession({ dayOffset: nextOffset(plan) });
  if (!draft.blocks.length) draft.blocks.push(makeBlock({ type: 'main' }));

  const labelInput = el('input', { value: draft.label, placeholder: 'e.g. Week 1 · Day 2, Tempo run' });
  const dateInput = el('input', { type: 'date', value: addDays(plan.startDate, draft.dayOffset ?? 0) });
  const blocksEl = el('div', {});

  function renderBlocks() {
    const lib = new Map(store.get('exercises').map((e) => [e.id, e]));
    blocksEl.innerHTML = '';
    draft.blocks.forEach((block, bi) => {
      const header = el('div', { class: 'list-row' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' },
            block.name || blockTypeLabel(block.type),
            block.rounds ? ` · ${block.rounds} rounds` : ''),
          block.note && el('div', { class: 'row-sub' }, block.note),
        ),
        draft.blocks.length > 1 && el('button', {
          class: 'icon-btn', 'aria-label': 'Remove block',
          onclick: () => { draft.blocks.splice(bi, 1); renderBlocks(); },
        }, '✕'),
      );
      const itemsEl = el('div', {});
      block.items.forEach((item, i) => {
        const ex = lib.get(item.exerciseId);
        itemsEl.appendChild(el('div', { class: 'list-row' },
          el('div', { class: 'row-main' },
            el('div', { class: 'row-title' }, ex?.name ?? 'Unknown exercise', item.optional ? el('span', { class: 'pill', style: 'margin-left:6px' }, 'optional') : ''),
            el('div', { class: 'row-sub' }, targetSummary(item.target)),
            item.note && el('div', { class: 'row-sub' }, item.note),
          ),
          el('div', { class: 'row-actions' },
            el('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { swap(block.items, i, i - 1); renderBlocks(); } }, '↑'),
            el('button', { class: 'icon-btn', 'aria-label': 'Edit target', onclick: () => editTarget(item, ex, renderBlocks) }, '✎'),
            el('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { block.items.splice(i, 1); renderBlocks(); } }, '✕'),
          ),
        ));
      });
      blocksEl.append(header, itemsEl,
        el('button', {
          class: 'btn secondary small',
          style: 'margin-bottom:10px',
          onclick: () => pickExercise((ex) => {
            const item = makeBlockItem({ exerciseId: ex.id, target: defaultTarget(ex) });
            editTarget(item, ex, () => { block.items.push(item); renderBlocks(); });
          }),
        }, '+ Add exercise'),
      );
    });
    blocksEl.appendChild(el('button', {
      class: 'btn secondary small',
      onclick: () => {
        const name = prompt('Block name (e.g. Warm-up, Strength circuit):') ?? '';
        const b = makeBlock({ type: 'other', name: name.trim() });
        draft.blocks.push(b);
        renderBlocks();
      },
    }, '+ Add block'));
  }
  renderBlocks();

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Label'), labelInput),
    el('div', { class: 'field' }, el('label', {}, 'Date'), dateInput),
    el('h3', {}, 'Blocks'),
    blocksEl,
  );

  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: isNew ? 'Add session' : 'Save',
      class: 'btn',
      onClick: () => {
        draft.label = labelInput.value.trim();
        if (dateInput.value) {
          draft.dayOffset = Math.round((parseDateStr(dateInput.value) - parseDateStr(plan.startDate)) / 86400000);
        }
        placeSession(plan, draft);
        store.upsert('plans', plan);
        render();
      },
    },
  ];
  if (!isNew) {
    actions.unshift({
      label: 'Delete',
      class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog('Delete this session?'))) return false;
        for (const w of plan.weeks) w.sessions = w.sessions.filter((s) => s.id !== draft.id);
        plan.weeks = plan.weeks.filter((w) => w.sessions.length);
        store.upsert('plans', plan);
        render();
      },
    });
  }
  openModal(isNew ? 'New session' : 'Edit session', body, actions);
}

// Insert/replace a session in the week derived from its dayOffset.
function placeSession(plan, session) {
  for (const w of plan.weeks) w.sessions = w.sessions.filter((s) => s.id !== session.id);
  const index = Math.floor(Math.max(0, session.dayOffset) / 7) + 1;
  let week = plan.weeks.find((w) => w.index === index);
  if (!week) {
    week = makeWeek(index);
    plan.weeks.push(week);
    plan.weeks.sort((a, b) => a.index - b.index);
  }
  week.sessions.push(session);
  week.sessions.sort((a, b) => (a.dayOffset ?? 0) - (b.dayOffset ?? 0));
  plan.weeks = plan.weeks.filter((w) => w.sessions.length);
}

function blockTypeLabel(type) {
  return { warmup: 'Warm-up', main: 'Main', strength: 'Strength', accessory: 'Accessory', cooldown: 'Cool-down' }[type] ?? 'Block';
}

function nextOffset(plan) {
  const max = allSessions(plan).reduce((m, s) => Math.max(m, s.dayOffset), -1);
  return max + 1;
}

function swap(arr, i, j) {
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function defaultTarget(ex) {
  if (ex.measurementType === 'distance') return { kind: 'distance', distanceM: 5000 };
  if (ex.measurementType === 'duration') return { kind: 'duration', durationSec: 1800 };
  if (ex.measurementType === 'intervals') return { kind: 'intervals', rounds: 6, workSec: 60, recoverySec: 60 };
  return { kind: 'reps', sets: 3, reps: 10 };
}

// ---------- Target summary + editor (v2 target shape) ----------

export function targetSummary(target) {
  if (!target?.kind) return 'no target';
  const extras = [];
  if (target.holdSec) extras.push(`${target.holdSec}s hold`);
  if (target.tempo) extras.push(target.tempo);
  if (target.rpe) extras.push(`RPE ${target.rpe}`);
  if (target.variantLevel) extras.push(`L${target.variantLevel}`);
  if (target.perSide) extras.push('per side');
  if (target.restSec) extras.push(`rest ${formatDuration(target.restSec)}`);
  const extra = extras.length ? ` · ${extras.join(' · ')}` : '';

  if (target.kind === 'reps') {
    const reps = target.reps ?? (target.repsMin != null ? `${target.repsMin}–${target.repsMax}` : '?');
    const w = target.weight ? ` @ ${formatWeight(target.weight)}` : '';
    return `${target.sets ?? 1} × ${reps}${w}${extra}`;
  }
  if (target.kind === 'duration') {
    const base = target.durationSec ? formatDuration(target.durationSec) : 'duration';
    return `${target.sets && target.sets > 1 ? `${target.sets} × ` : ''}${base}${extra}`;
  }
  if (target.kind === 'distance') {
    const dist = target.distanceM ? formatDistance(target.distanceM) : 'distance';
    const pace = target.paceSecPerKm ? ` @ ${formatPaceValue(target.paceSecPerKm)}` : '';
    return `${dist}${pace}${extra}`;
  }
  if (target.kind === 'intervals') {
    const work = formatDuration(target.workSec ?? 60);
    const rec = target.recoverySec ? ` / ${formatDuration(target.recoverySec)} ${target.recoveryModality ?? 'rest'}` : '';
    return `${target.rounds ?? '?'} × (${work} ${target.workModality ?? 'work'}${rec})${extra}`;
  }
  return 'no target';
}

function editTarget(item, ex, done) {
  const t = item.target ?? defaultTarget(ex);
  const kindSel = el('select', {},
    TARGET_KINDS.map((k) => el('option', { value: k.id, selected: t.kind === k.id }, k.label)),
  );
  const fields = el('div', {});
  const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
  const num = (name, value, step = 1) =>
    el('input', { type: 'number', inputmode: 'decimal', step, value: value ?? '', dataset: { name } });

  function renderFields() {
    const kind = kindSel.value;
    fields.innerHTML = '';
    if (kind === 'reps') {
      fields.append(
        el('div', { class: 'field-row' },
          field('Sets', num('sets', t.sets ?? 3)),
          field('Reps', num('reps', t.reps ?? 10)),
          field(`Weight (${weightUnit()})`, num('weight', weightToInput(t.weight) ?? '', 0.5)),
        ),
        el('div', { class: 'field-row' },
          field('Rep range min', num('repsMin', t.repsMin ?? '')),
          field('Rep range max', num('repsMax', t.repsMax ?? '')),
          field('Hold (s)', num('hold', t.holdSec ?? '')),
        ),
      );
    } else if (kind === 'distance') {
      fields.append(
        el('div', { class: 'field-row' },
          field(`Distance (${distanceUnit()})`, num('km', distanceToInput(t.distanceM ?? 5000), 0.1)),
          field(`Pace (min${paceUnit()})`, num('pace', paceToInput(t.paceSecPerKm) ?? '', 0.05)),
        ),
      );
    } else if (kind === 'duration') {
      fields.append(el('div', { class: 'field-row' },
        field('Sets', num('sets', t.sets ?? 1)),
        field('Duration (min)', num('min', t.durationSec ? t.durationSec / 60 : 30)),
      ));
    } else {
      fields.append(
        el('div', { class: 'field-row' },
          field('Rounds', num('rounds', t.rounds ?? 6)),
          field('Work (s)', num('work', t.workSec ?? 60)),
          field('Recovery (s)', num('rec', t.recoverySec ?? 60)),
        ),
      );
    }
    fields.append(el('div', { class: 'field-row' },
      field('Rest between sets (s)', num('rest', t.restSec ?? '')),
      field('Target RPE', num('rpe', t.rpe ?? '', 0.5)),
      ex?.variants?.length ? field(`Variant level (1–${ex.variants.length})`, num('variant', t.variantLevel ?? '')) : el('div', {}),
    ));
  }
  kindSel.addEventListener('change', renderFields);
  renderFields();

  openModal(`Target — ${ex?.name ?? ''}`, el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Target type'), kindSel),
    fields,
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        const val = (n) => {
          const v = parseFloat(fields.querySelector(`[data-name="${n}"]`)?.value);
          return isNaN(v) ? null : v;
        };
        const kind = kindSel.value;
        const target = { kind };
        if (kind === 'reps') {
          if (val('sets') != null) target.sets = val('sets');
          if (val('reps') != null) target.reps = val('reps');
          if (val('repsMin') != null && val('repsMax') != null) {
            target.repsMin = val('repsMin');
            target.repsMax = val('repsMax');
            delete target.reps;
          }
          if (val('weight') != null) target.weight = weightFromInput(val('weight'));
          if (val('hold') != null) target.holdSec = Math.round(val('hold'));
        } else if (kind === 'distance') {
          target.distanceM = distanceFromInput(val('km'));
          if (val('pace') != null) target.paceSecPerKm = paceFromInput(val('pace'));
        } else if (kind === 'duration') {
          if (val('sets') != null && val('sets') > 1) target.sets = val('sets');
          target.durationSec = val('min') != null ? Math.round(val('min') * 60) : null;
        } else {
          target.rounds = val('rounds') ?? 6;
          target.workSec = val('work') != null ? Math.round(val('work')) : 60;
          if (val('rec') != null) target.recoverySec = Math.round(val('rec'));
          target.totalSec = target.rounds * (target.workSec + (target.recoverySec ?? 0));
        }
        if (val('rest') != null) target.restSec = Math.round(val('rest'));
        if (val('rpe') != null) target.rpe = val('rpe');
        if (val('variant') != null) target.variantLevel = Math.round(val('variant'));
        item.target = target;
        done();
      },
    },
  ]);
}

// ---------- Exercise picker + editor (shared with Logs and Library tabs) ----------

// onPick(exercise, pickerState) — pickerState captures the search query and
// scroll position so callers can offer a "back" that reopens the picker
// exactly where the user left it (pass it back as `restore`).
// Archived exercises are hidden here but still resolve everywhere else;
// excludeId omits one more (used when picking a replacement for it).
export function pickExercise(onPick, restore = {}, { excludeId = null } = {}) {
  const search = el('input', { placeholder: 'Search exercises…', autocomplete: 'off', value: restore.query ?? '' });
  const list = el('div', {});
  let modal;

  const pickerState = () => ({ query: search.value, scroll: list.closest('.modal')?.scrollTop ?? 0 });

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const lib = store.get('exercises')
      .filter((e) => !e.archived && e.id !== excludeId)
      .filter((e) => !q || e.name.toLowerCase().includes(q));
    list.innerHTML = '';
    for (const ex of lib.slice(0, 30)) {
      list.appendChild(el('div', { class: 'list-row tappable', onclick: () => {
        const state = pickerState();
        modal.close();
        onPick(ex, state);
      } },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, ex.name),
          el('div', { class: 'row-sub' }, `${ex.category} · ${ex.modality} · ${ex.measurementType}`),
        ),
      ));
    }
    if (!lib.length) {
      list.appendChild(el('p', { class: 'muted' }, q ? `No match for “${search.value}”.` : 'Library is empty.'));
    }
  }
  search.addEventListener('input', renderList);
  renderList();

  modal = openModal('Pick exercise', el('div', {},
    el('div', { class: 'field' }, search),
    list,
    el('button', {
      class: 'btn secondary small',
      onclick: () => {
        const state = pickerState();
        modal.close();
        editExercise(null, (ex) => onPick(ex, state), search.value.trim());
      },
    }, '+ New exercise'),
  ), [{ label: 'Cancel', class: 'btn secondary', onClick: () => {} }]);
  if (restore.scroll) {
    const modalEl = list.closest('.modal');
    if (modalEl) modalEl.scrollTop = restore.scroll;
  } else {
    setTimeout(() => search.focus(), 50);
  }
}

export function editExercise(ex, onSaved, prefillName = '') {
  const isNew = !ex;
  const draft = ex ? { ...migrateExercise(ex) } : makeExercise({ name: prefillName });
  const nameInput = el('input', { value: draft.name, placeholder: 'e.g. Back squat, Easy run' });
  const catSel = el('select', {}, CATEGORIES.map((c) => el('option', { value: c, selected: draft.category === c }, c)));
  const modSel = el('select', {}, MODALITIES.map((m) => el('option', { value: m, selected: draft.modality === m }, m)));
  const measSel = el('select', {}, MEASUREMENT_TYPES.map((u) => el('option', { value: u, selected: draft.measurementType === u }, u)));
  const descInput = el('textarea', { placeholder: 'How to perform the movement (optional)' }, draft.description ?? '');
  openModal(isNew ? 'New exercise' : 'Edit exercise', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Category'), catSel),
      el('div', { class: 'field' }, el('label', {}, 'Modality'), modSel),
      el('div', { class: 'field' }, el('label', {}, 'Measured by'), measSel),
    ),
    el('div', { class: 'field' }, el('label', {}, 'Description'), descInput),
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        if (!nameInput.value.trim()) { toast('Name required', 'error'); return false; }
        Object.assign(draft, {
          name: nameInput.value.trim(),
          category: catSel.value,
          modality: modSel.value,
          measurementType: measSel.value,
          description: descInput.value.trim(),
        });
        store.upsert('exercises', draft);
        onSaved?.(draft);
      },
    },
  ]);
}

// ---------- Import / export (fitness-tracker-plan v2 schema) ----------

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'exercise';

// Drop empty optional fields so exported files stay tidy.
function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

// Serialize one library record as a v2-schema exercise definition.
export function exerciseDef(ex) {
  const def = prune({
    name: ex?.name ?? 'Unknown exercise',
    shortName: ex?.shortName,
    category: sanitizeCategory(ex?.category),
    modality: ex?.modality,
    measurementType: sanitizeMeasurement(ex?.measurementType),
    perSide: ex?.perSide || undefined,
    equipment: ex?.equipment,
    primaryTargets: ex?.primaryTargets,
    cues: ex?.cues,
    whyItsHere: ex?.whyItsHere,
    safetyNotes: ex?.safetyNotes,
    variants: ex?.variants,
    progressionRule: ex?.progressionRule,
    videoSearchTerm: ex?.videoSearchTerm,
  });
  def.description = ex?.description ?? ''; // required by schema
  return def;
}

export function serializePlan(plan) {
  const lib = new Map(store.get('exercises').map((e) => [e.id, e]));
  const idToKey = new Map();
  const exerciseLibrary = {};
  const keyFor = (exerciseId) => {
    if (idToKey.has(exerciseId)) return idToKey.get(exerciseId);
    const ex = lib.get(exerciseId);
    let key = slug(ex?.name ?? 'exercise');
    while (exerciseLibrary[key]) key += '_2';
    exerciseLibrary[key] = exerciseDef(ex);
    idToKey.set(exerciseId, key);
    return key;
  };

  const weeks = (plan.weeks ?? []).map((w) => prune({
    index: w.index,
    phaseId: w.phaseId,
    focus: w.focus,
    isDeload: w.isDeload || undefined,
    note: w.note,
    sessions: w.sessions.map((s) => prune({
      id: s.id,
      label: s.label || 'Session',
      dayOffset: s.dayOffset ?? (w.index - 1) * 7,
      sessionType: s.sessionType,
      estimatedDurationMin: s.estimatedDurationMin,
      note: s.note,
      blocks: (s.blocks ?? []).map((b) => prune({
        type: b.type,
        name: b.name,
        note: b.note,
        rounds: b.rounds,
        items: (b.items ?? []).map((item) => prune({
          exerciseId: keyFor(item.exerciseId),
          target: item.target ?? { kind: 'reps', reps: 1 },
          note: item.note,
          optional: item.optional || undefined,
        })),
      })),
    })),
  }));

  return {
    format: 'fitness-tracker-plan',
    formatVersion: 2,
    plan: prune({
      id: slug(plan.name),
      name: plan.name,
      description: plan.description,
      goal: plan.goal,
      level: plan.level,
      durationWeeks: Math.max(1, ...(plan.weeks ?? []).map((w) => w.index)),
      tags: plan.type && plan.type !== 'custom' ? [plan.type] : undefined,
      assumptions: plan.assumptions,
    }),
    ...(plan.settings ? { settings: plan.settings } : {}),
    ...(plan.progressionPolicy ? { progressionPolicy: plan.progressionPolicy } : {}),
    ...(plan.formCues ? { formCues: plan.formCues } : {}),
    ...(plan.phases?.length ? { phases: plan.phases } : {}),
    exerciseLibrary,
    weeks,
  };
}

function exportPlan(plan) {
  const fileSlug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan';
  downloadJson(`${fileSlug}.plan.json`, serializePlan(plan));
  toast('Exported — edit the file as a template and re-import it anytime');
}

// Accepts v2 schema files (weeks/exerciseLibrary) and legacy v1 templates
// (flat sessions with inline exercises). Exercises are matched to the
// library by name (case-insensitive); missing ones are created.
export function importPlan(data, startDate) {
  if (!data || typeof data !== 'object') throw new Error('Not a plan file');
  if (data.formatVersion === 2 || data.weeks) return importPlanV2(data, startDate);
  if (typeof data.name === 'string' && Array.isArray(data.sessions)) return importPlanV1(data, startDate);
  throw new Error('Unrecognized plan format — expected fitness-tracker-plan v1 or v2');
}

export function libraryUpserter() {
  const library = store.get('exercises').slice();
  const byName = new Map(library.map((e) => [e.name.toLowerCase(), e]));
  let changed = false;
  const stats = { created: 0, enriched: 0 };
  return {
    stats,
    // def: v2 exercise definition (or minimal {name,...}). Returns record id.
    resolve(def) {
      const name = (def.name ?? '').trim() || 'Exercise';
      let rec = byName.get(name.toLowerCase());
      const wasNew = !rec;
      if (!rec) {
        rec = {
          ...makeExercise({ name }),
          category: sanitizeCategory(def.category),
          modality: sanitizeModality(def.modality),
          measurementType: sanitizeMeasurement(def.measurementType ?? def.defaultUnit),
        };
        library.push(rec);
        byName.set(name.toLowerCase(), rec);
        changed = true;
        stats.created++;
      }
      // Enrich empty fields from the richer imported definition — user edits win.
      let enriched = false;
      for (const k of ['shortName', 'description', 'whyItsHere', 'progressionRule', 'videoSearchTerm']) {
        if (def[k] && !rec[k]) { rec[k] = def[k]; changed = true; enriched = true; }
      }
      for (const k of ['cues', 'safetyNotes', 'variants', 'equipment', 'primaryTargets']) {
        if (def[k]?.length && !rec[k]?.length) { rec[k] = def[k]; changed = true; enriched = true; }
      }
      if (def.perSide && !rec.perSide) { rec.perSide = true; changed = true; enriched = true; }
      // Importing a plan that uses an archived exercise puts it back in play.
      if (rec.archived) { rec.archived = false; changed = true; enriched = true; }
      if (enriched && !wasNew) stats.enriched++;
      return rec.id;
    },
    commit() {
      if (changed) store.save('exercises', library);
    },
  };
}

function importPlanV2(data, startDate) {
  if (data.format !== 'fitness-tracker-plan') throw new Error('Not a fitness-tracker-plan file');
  if (!data.plan?.name || !Array.isArray(data.weeks) || !data.exerciseLibrary) {
    throw new Error('Plan file is missing plan/name, exerciseLibrary, or weeks');
  }
  const lib = libraryUpserter();
  const keyToId = new Map();
  for (const [key, def] of Object.entries(data.exerciseLibrary)) {
    keyToId.set(key, lib.resolve(def));
  }
  const resolveExercise = (key) => {
    const id = keyToId.get(key);
    if (!id) throw new Error(`Plan references unknown exercise "${key}"`);
    return id;
  };

  // Materialize block templates at import: a session block with templateId
  // inherits the template's fields, its own fields winning.
  const templates = data.blockTemplates ?? {};
  const materialize = (block) => {
    const base = block.templateId ? templates[block.templateId] ?? {} : {};
    const merged = { ...base, ...prune(block) };
    return {
      ...makeBlock({ type: merged.type ?? 'main', name: merged.name ?? '' }),
      note: merged.note ?? '',
      ...(merged.rounds ? { rounds: merged.rounds } : {}),
      items: (merged.items ?? []).map((item) => ({
        ...makeBlockItem({
          exerciseId: resolveExercise(item.exerciseId),
          target: item.target ?? {},
          note: item.note ?? '',
          optional: !!item.optional,
        }),
      })),
    };
  };

  const plan = {
    ...makePlan({ name: data.plan.name, type: data.plan.tags?.[0] ?? 'custom', startDate }),
    description: data.plan.description ?? '',
    goal: data.plan.goal ?? '',
    level: data.plan.level ?? null,
    assumptions: data.plan.assumptions ?? [],
    settings: data.settings,
    progressionPolicy: data.progressionPolicy,
    formCues: data.formCues,
    phases: data.phases ?? [],
    weeks: data.weeks.map((w) => ({
      index: w.index,
      ...(w.phaseId ? { phaseId: w.phaseId } : {}),
      ...(w.focus ? { focus: w.focus } : {}),
      ...(w.isDeload ? { isDeload: true } : {}),
      ...(w.note ? { note: w.note } : {}),
      sessions: (w.sessions ?? []).map((s, si) => ({
        ...makeSession({
          label: s.label ?? '',
          dayOffset: s.dayOffset ?? (w.index - 1) * 7 + (s.dayInWeek ?? si),
        }),
        ...(s.sessionType ? { sessionType: s.sessionType } : {}),
        ...(s.estimatedDurationMin ? { estimatedDurationMin: s.estimatedDurationMin } : {}),
        note: s.note ?? '',
        blocks: (s.blocks ?? []).map(materialize),
      })),
    })),
  };
  lib.commit();
  store.upsert('plans', plan);
  return plan;
}

// Legacy v1 template: { name, type, sessions: [{label, dayOffset, exercises:[{name,category,defaultUnit,target}]}] }
function importPlanV1(data, startDate) {
  const lib = libraryUpserter();
  const plan = makePlan({ name: data.name, type: data.type || 'custom', startDate });
  for (const s of data.sessions) {
    const session = makeSession({
      label: typeof s.label === 'string' ? s.label : '',
      dayOffset: Number.isFinite(Number(s.dayOffset)) ? Number(s.dayOffset) : 0,
    });
    const block = makeBlock({ type: 'main' });
    for (const def of s.exercises ?? s.plannedExercises ?? []) {
      block.items.push(makeBlockItem({
        exerciseId: lib.resolve(def),
        target: def.target && typeof def.target === 'object' ? def.target : {},
      }));
    }
    session.blocks.push(block);
    placeSession(plan, session);
  }
  lib.commit();
  store.upsert('plans', plan);
  return plan;
}

function importPlanModal() {
  const textarea = el('textarea', {
    placeholder: 'Paste a plan JSON here, or pick a file below…',
    style: 'min-height:140px;font-family:monospace;font-size:0.8rem',
  });
  const fileInput = filePicker({
    onchange: () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      f.text().then((t) => { textarea.value = t; }).catch(() => toast('Could not read file', 'error'));
    },
  });
  const dateInput = el('input', { type: 'date', value: todayStr() });

  // Starter plans bundled with the site; tapping one imports it directly
  // using the start date above, without round-tripping through the textarea.
  const presetList = el('div', {}, el('p', { class: 'muted' }, 'Loading starter plans…'));
  let modal;
  loadManifest().then((manifest) => {
    presetList.innerHTML = '';
    for (const p of manifest.plans ?? []) {
      presetList.appendChild(el('div', { class: 'list-row tappable', onclick: async () => {
        try {
          const data = await loadPreset(p.file);
          const plan = importPlan(data, dateInput.value || todayStr());
          modal.close();
          toast(`Imported “${plan.name}”`);
          view = { name: 'plan', planId: plan.id };
          render();
        } catch (e) {
          toast(e.message, 'error');
        }
      } },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, p.name),
          el('div', { class: 'row-sub' },
            [p.weeks && `${p.weeks} week${p.weeks === 1 ? '' : 's'}`,
              p.sessions && `${p.sessions} sessions`, p.level].filter(Boolean).join(' · ')),
          p.description && el('div', { class: 'row-sub' }, p.description),
        ),
      ));
    }
    if (!manifest.plans?.length) presetList.appendChild(el('p', { class: 'muted' }, 'No starter plans available.'));
  }).catch(() => {
    presetList.innerHTML = '';
    presetList.appendChild(el('p', { class: 'muted' }, 'Starter plans unavailable offline.'));
  });

  modal = openModal('Import plan', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Start date (day 0 of the plan)'), dateInput),
    el('h3', {}, 'Starter plans'),
    presetList,
    el('h3', {}, 'Or paste your own'),
    el('div', { class: 'field' }, textarea),
    el('div', { class: 'field' }, el('label', {}, 'Or choose a file'), fileInput),
    el('p', { class: 'muted' },
      'Accepts fitness-tracker-plan v2 files (and older v1 templates). ',
      'Exercises are matched to your library by name; missing ones are created with their full descriptions.'),
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Import',
      class: 'btn',
      onClick: () => {
        let data;
        try {
          data = JSON.parse(textarea.value);
        } catch {
          toast('That isn’t valid JSON', 'error');
          return false;
        }
        try {
          const plan = importPlan(data, dateInput.value || todayStr());
          toast(`Imported “${plan.name}”`);
          view = { name: 'plan', planId: plan.id };
          render();
        } catch (e) {
          toast(e.message, 'error');
          return false;
        }
      },
    },
  ]);
}

// ---------- Calendar ----------

function renderCalendar() {
  if (!calMonth) {
    const now = new Date();
    calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const plans = store.get('plans').filter((p) => p.status === 'active');
  const byDate = new Map();
  for (const p of plans) {
    for (const { session, dayOffset, week } of allSessions(p)) {
      const d = addDays(p.startDate, dayOffset);
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push({ plan: p, session, week });
    }
  }

  const monthName = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  root.appendChild(el('div', { class: 'cal-header' },
    el('button', { class: 'btn small secondary', onclick: () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); render(); } }, '‹'),
    el('h2', { style: 'margin:0' }, monthName),
    el('button', { class: 'btn small secondary', onclick: () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); render(); } }, '›'),
  ));

  const grid = el('div', { class: 'cal-grid' });
  for (const dow of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    grid.appendChild(el('div', { class: 'cal-dow' }, dow));
  }
  const firstDow = (calMonth.getDay() + 6) % 7;
  const start = new Date(calMonth);
  start.setDate(1 - firstDow);
  const today = todayStr();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = toDateStr(d);
    const cell = el('div', {
      class: `cal-cell${d.getMonth() !== calMonth.getMonth() ? ' other-month' : ''}${ds === today ? ' today' : ''}`,
    }, el('span', { class: 'cal-day-num' }, d.getDate()));
    for (const { plan, session } of byDate.get(ds) ?? []) {
      cell.appendChild(el('span', { class: 'cal-dot', title: `${plan.name}: ${session.label}` },
        session.label || plan.name));
    }
    grid.appendChild(cell);
  }
  root.appendChild(grid);
  if (!plans.length) root.appendChild(el('p', { class: 'muted', style: 'margin-top:12px' }, 'No active plans to show.'));
}
