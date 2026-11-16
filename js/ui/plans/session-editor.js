// Plans → the session editor (blocks and items) and the target editor (v2
// target shape).
import { allSessions, makeBlock, makeBlockItem, makeSession, makeWeek } from '../../models.js';
import { confirmDialog, el, openModal, toast } from '../components.js';
import * as store from '../../storage/store.js';
import { effectiveSessionDate, sessionKey } from '../../schedule.js';
import { pickExercise } from './exercise-editor.js';
import { formatDuration, parseDateStr } from '../../dates.js';
import { render } from '../plans-tab.js';
import { distanceFromInput, distanceToInput, distanceUnit, formatDistance, formatPaceValue, formatWeight, paceFromInput, paceToInput, paceUnit, weightFromInput, weightToInput, weightUnit } from '../../units.js';
import { TARGET_KINDS } from '../../config.js';
import { timerEntry } from '../cardio-form.js';
import { formatHms, parseHms } from '../../cardio.js';

// ---------- Session editor (blocks + items) ----------

export function editSession(plan, session) {
  const isNew = !session;
  const draft = session ? JSON.parse(JSON.stringify(session)) : makeSession({ dayOffset: nextOffset(plan) });
  if (!draft.blocks.length) draft.blocks.push(makeBlock({ type: 'main' }));

  const labelInput = el('input', { value: draft.label, placeholder: 'e.g. Week 1 · Day 2, Tempo run' });
  // The date shown is when the session happens (js/schedule.js). For a
  // session the plan slid, changing it updates that move rather than the plan.
  const schedule = store.get('schedule');
  const moveRec = session ? schedule.find((r) => r.id === sessionKey(plan.id, session.id) && r.kind === 'move') : null;
  const shownDate = session ? effectiveSessionDate(plan, session, schedule) : effectiveSessionDate(plan, draft, []);
  const dateInput = el('input', { type: 'date', value: shownDate });
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
        if (dateInput.value && dateInput.value !== shownDate) {
          if (moveRec) store.upsert('schedule', { ...moveRec, date: dateInput.value });
          else draft.dayOffset = Math.round((parseDateStr(dateInput.value) - parseDateStr(plan.startDate)) / 86400000);
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
export function placeSession(plan, session) {
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

export function blockTypeLabel(type) {
  return { warmup: 'Warm-up', main: 'Main', strength: 'Strength', accessory: 'Accessory', cooldown: 'Cool-down' }[type] ?? 'Block';
}

export function nextOffset(plan) {
  const max = allSessions(plan).reduce((m, s) => Math.max(m, s.dayOffset), -1);
  return max + 1;
}

export function swap(arr, i, j) {
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

export function defaultTarget(ex) {
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
    // sets × reps × time per rep: "2 × 20s", "3 × 5 × 10s", "30m".
    const base = target.durationSec ? formatDuration(target.durationSec) : 'duration';
    const reps = target.reps > 1 ? `${target.reps} × ` : '';
    const sets = target.sets > 1 ? `${target.sets} × ` : reps ? '1 × ' : '';
    return `${sets}${reps}${base}${extra}`;
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

export function editTarget(item, ex, done) {
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
      // Time per rep types like a timer (no colon on iPhone's number pad).
      fields.append(el('div', { class: 'field-row' },
        field('Sets', num('sets', t.sets ?? 1)),
        field('Reps per set', num('reps', t.reps ?? 1)),
        field('Time per rep (m:ss)', timerEntry(el('input', { type: 'text', inputmode: 'numeric', value: formatHms(t.durationSec ?? 1800), dataset: { name: 'time' } }))),
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
          if (val('reps') != null && val('reps') > 1) target.reps = Math.round(val('reps'));
          const sec = parseHms(fields.querySelector('[data-name="time"]')?.value);
          if (Number.isNaN(sec)) { toast('Time per rep: use m:ss, e.g. 0:30', 'error'); return false; }
          target.durationSec = sec;
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
