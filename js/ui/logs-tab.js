// Logs tab: Today (log against the active plan), History (synced activities
// with match suggestions, plus GPX/TCX import), Metrics (weight/pace charts
// + adherence), Heatmap.

import * as store from '../storage/store.js';
import { makeLogEntry, makeBodyMetric, makeMatch, matchActivityId, allSessions, sessionItems } from '../models.js';
import { findSuggestions, findCandidates } from '../matcher.js';
import { sportMapping, BODY_METRICS } from '../config.js';
import {
  todayStr, addDays, diffDays, formatDate, formatDateLong, formatDuration,
} from '../dates.js';
import {
  formatWeight, formatDistance, formatPace, paceChartValue, paceUnit,
  weightUnit, weightToInput, weightFromInput,
  distanceUnit, distanceToInput, resolveMetric,
} from '../units.js';
import { lineChart, datePoints } from '../charts.js';
import { isCardioExercise, hasCardioData, sportOf, defaultGear } from '../cardio.js';
import { el, openModal, confirmDialog, toast, emptyState, filePicker, exerciseLink } from './components.js';
import { cardioFields, cardioExtras } from './cardio-form.js';
import { setsForm } from './sets-form.js';
import { formatSets } from '../sets.js';
import { variantLevelFor } from '../load.js';
import { pickExercise, targetSummary } from './plans-tab.js';

let root = null;
let ctx = null;
let unsub = null;
let sub = 'today'; // 'today' | 'history' | 'metrics' | 'heatmap'
let histFilter = { from: addDays(todayStr(), -30), to: todayStr(), planId: '' };
let adherenceDays = 30;
let heatmapMod = null;

export function mount(elRoot, appCtx) {
  root = elRoot;
  ctx = appCtx;
  unsub = store.onChange((e) => {
    if (e.type === 'changed') render();
  });
  runMatcher();
  render();
}

export function unmount() {
  unsub?.();
  destroyHeatmap();
  root = null;
}

// Idempotent: render() runs on every store change, and destroying a Leaflet
// map twice throws ("Map container is being reused"), which used to abort
// whatever write triggered the re-render.
function destroyHeatmap() {
  const mod = heatmapMod;
  heatmapMod = null;
  mod?.destroy?.();
}

// Persist fresh suggestions so they survive reloads and are never recomputed
// once the user confirms/rejects them.
function runMatcher() {
  const activities = store.getActivityEntries();
  if (!activities.length) return;
  const matches = store.get('matches');
  const fresh = findSuggestions(activities, store.get('plans'), matches, store.get('exercises'));
  if (fresh.length) {
    const records = matches.concat(fresh.map((f) => makeMatch({ ...f, status: 'suggested' })));
    store.save('matches', records);
  }
}

function render() {
  if (!root) return;
  destroyHeatmap();
  root.innerHTML = '';
  const segs = [
    ['today', 'Today'],
    ['history', 'History'],
    ['metrics', 'Metrics'],
  ];
  // Heatmap used to be a fourth sub-tab; it now lives at the bottom of
  // Metrics, so an old remembered 'heatmap' lands there.
  if (sub === 'heatmap') sub = 'metrics';
  ctx?.setTitle?.(segs.find(([id]) => id === sub)?.[1] ?? 'Logs');
  root.appendChild(el('div', { class: 'segmented' },
    segs.map(([id, label]) =>
      el('button', { class: sub === id ? 'active' : '', onclick: () => { sub = id; render(); } }, label)),
  ));
  if (store.encryption().locked) {
    root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'list-row', style: 'border:none;padding:0' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, '🔒 Some synced data is encrypted'),
          el('div', { class: 'row-sub' }, 'Enter your password in Settings to unlock it on this device.'),
        ),
        el('button', { class: 'btn small', onclick: () => ctx?.openSettings?.() }, 'Unlock'),
      ),
    ));
  }
  if (sub === 'today') renderToday();
  else if (sub === 'history') renderHistory();
  else renderMetrics();
}

// ---------- helpers ----------

function exById() {
  return new Map(store.get('exercises').map((e) => [e.id, e]));
}

function activePlans() {
  return store.get('plans').filter((p) => p.status === 'active');
}

// Synced activities decorated with their computed matchStatus (overlay merge).
function activitiesWithStatus() {
  const matches = new Map(store.get('matches').map((m) => [matchActivityId(m), m]));
  return store.getActivityEntries().map((entry) => {
    const m = matches.get(entry.id);
    return {
      ...entry,
      matchStatus: m?.status ?? 'unmatched',
      match: m ?? null,
    };
  });
}

export function actualSummary(actual) {
  if (!actual) return '';
  const parts = [];
  const sets = formatSets(actual); // includes the weight(s)
  if (sets) parts.push(sets);
  if (actual.distanceM) parts.push(formatDistance(actual.distanceM));
  if (actual.movingSec) parts.push(formatDuration(actual.movingSec));
  if (actual.distanceM && actual.movingSec) parts.push(formatPace(actual.distanceM, actual.movingSec));
  if (actual.durationSec) parts.push(formatDuration(actual.durationSec));
  if (actual.avgHr) parts.push(`${Math.round(actual.avgHr)} bpm`);
  return parts.join(' · ');
}

// ---------- Today ----------

function renderToday() {
  const today = todayStr();
  const lib = exById();
  const logs = store.get('logs');
  const loggedByPe = new Map(
    logs.filter((l) => l.date === today && l.plannedExerciseId).map((l) => [l.plannedExerciseId, l]),
  );

  root.appendChild(el('h2', {}, formatDateLong(today)));
  root.appendChild(weighInCard(today));

  let anyPlanned = false;
  for (const plan of activePlans()) {
    for (const { session, week, dayOffset } of allSessions(plan)) {
      if (addDays(plan.startDate, dayOffset) !== today) continue;
      anyPlanned = true;
      const card = el('div', { class: 'card' },
        el('div', { class: 'row-title' }, session.label || plan.name),
        el('div', { class: 'row-sub' },
          `${plan.name} · week ${week.index}${week.isDeload ? ' (deload)' : ''}`
          + `${session.estimatedDurationMin ? ` · ~${session.estimatedDurationMin} min` : ''}`),
        session.note && el('div', { class: 'row-sub' }, session.note),
      );
      for (const block of session.blocks ?? []) {
        if ((session.blocks?.length ?? 0) > 1 || block.name || block.rounds) {
          card.appendChild(el('div', { class: 'row-sub', style: 'margin-top:8px;font-weight:600' },
            (block.name || blockLabel(block.type)) + (block.rounds ? ` — ${block.rounds} rounds` : '')));
          if (block.note) card.appendChild(el('div', { class: 'row-sub' }, block.note));
        }
        for (const item of block.items ?? []) {
          card.appendChild(plannedRow(plan, session, item, lib.get(item.exerciseId), loggedByPe.get(item.id)));
        }
      }
      if (!sessionItems(session).length) card.appendChild(el('p', { class: 'muted' }, 'Session has no exercises.'));
      root.appendChild(card);
    }
  }
  if (!anyPlanned) {
    root.appendChild(el('div', { class: 'card' },
      el('p', { class: 'muted', style: 'margin:0' }, 'Nothing planned for today.'),
    ));
  }
  root.appendChild(el('button', { class: 'btn', onclick: () => adhocLog() }, '+ Log ad-hoc activity'));
}

// One-tap daily weigh-in. Prefills the last known weight; merges into
// today's metric record if one already exists (no duplicate same-day rows).
function weighInCard(today) {
  const metrics = store.get('metrics');
  const todays = metrics.find((m) => m.date === today);

  if (todays?.weight != null) {
    return el('div', { class: 'card' },
      el('div', { class: 'list-row', style: 'border:none;padding:0' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, `${formatWeight(todays.weight)} `, el('span', { class: 'pill ok' }, 'weighed in')),
          metricSummary(todays) !== formatWeight(todays.weight) && el('div', { class: 'row-sub' }, metricSummary(todays)),
        ),
        el('button', { class: 'btn small secondary', onclick: () => logBodyMetric(todays) }, 'Edit'),
      ),
    );
  }

  const last = [...metrics].filter((m) => m.weight != null).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const input = el('input', {
    type: 'number', inputmode: 'decimal', step: 0.1,
    value: weightToInput(last?.weight) ?? '', placeholder: weightUnit(), 'aria-label': `Weight (${weightUnit()})`,
  });
  const save = () => {
    const w = parseFloat(input.value);
    if (isNaN(w)) { toast('Enter a weight', 'error'); return; }
    const kg = weightFromInput(w);
    const entry = todays ? { ...todays, weight: kg } : makeBodyMetric({ date: today, weight: kg });
    store.upsert('metrics', entry);
    toast('Weight logged');
  };
  return el('div', { class: 'card' },
    el('div', { class: 'row-sub', style: 'margin-bottom:6px' }, 'Morning weigh-in'),
    el('div', { class: 'log-inputs', style: 'margin:0' },
      input,
      el('button', { class: 'btn small', onclick: save }, 'Log'),
      el('button', { class: 'btn small secondary', onclick: () => logBodyMetric(todays ?? null) }, 'More…'),
    ),
  );
}

// Import activity files exported from any device. Polar's API only reaches
// back 30 days, so this is how history and other devices get in.
function importActivitiesModal() {
  const fileInput = filePicker({ multiple: true });
  const statusEl = el('div', {});
  let modal;

  const run = async () => {
    const files = [...(fileInput.files ?? [])];
    if (!files.length) { toast('Choose one or more .gpx or .tcx files', 'error'); return; }
    statusEl.innerHTML = '';
    statusEl.appendChild(el('p', { class: 'muted' }, `Parsing ${files.length} file${files.length === 1 ? '' : 's'}…`));
    const { parseActivityFile, ParseError } = await import('../gps.js');
    const parsed = [];
    const failures = [];
    for (const f of files) {
      try {
        parsed.push(await parseActivityFile(f.name, await f.text()));
      } catch (e) {
        failures.push(e instanceof ParseError ? e.message : `${f.name}: ${e.message}`);
      }
    }
    // Nothing is written unless at least one file parsed cleanly.
    if (!parsed.length) {
      statusEl.innerHTML = '';
      statusEl.appendChild(el('p', { class: 'muted' }, failures.join(' · ')));
      toast('No files could be read', 'error');
      return;
    }
    const added = await store.addImportedActivities(parsed);
    modal.close();
    const withRoutes = parsed.filter((p) => p.gpsPolyline).length;
    toast(added
      ? `Imported ${added} activit${added === 1 ? 'y' : 'ies'}${withRoutes ? `, ${withRoutes} with GPS` : ''}`
      : 'Nothing new — those activities are already imported');
    if (failures.length) toast(`Skipped ${failures.length}: ${failures[0]}`, 'error');
    render();
  };

  modal = openModal('Import activities', el('div', {},
    el('p', { class: 'muted' },
      'Add activities from a .gpx or .tcx export — Polar Flow, Garmin Connect, or anything else that exports. ',
      'Pick several at once. Re-importing the same file does nothing, so it is safe to retry.'),
    el('div', { class: 'field' }, el('label', {}, 'Files'), fileInput),
    statusEl,
    el('p', { class: 'muted' },
      'On iPhone, choose “Browse” to reach Files or iCloud Drive. If your export arrived as a .zip, ',
      'long-press it in Files and tap Uncompress first, then pick the .gpx or .tcx inside.'),
    el('p', { class: 'muted' },
      'Routes are stored for the heatmap. Distance and duration come from the file when stated, ',
      'and are otherwise computed from the track. FIT files are not supported.'),
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    { label: 'Import', class: 'btn', onClick: () => { run(); return false; }, keepOpen: true },
  ]);
}

function blockLabel(type) {
  return { warmup: 'Warm-up', main: 'Main', strength: 'Strength', accessory: 'Accessory', cooldown: 'Cool-down' }[type] ?? 'Block';
}

function plannedRow(plan, session, pe, ex, existing) {
  const row = el('div', { class: 'list-row' });
  const main = el('div', { class: 'row-main' },
    el('div', { class: 'row-title' }, ex ? exerciseLink(ex) : '?',
      pe.optional ? el('span', { class: 'pill', style: 'margin-left:6px' }, 'optional') : ''),
    el('div', { class: 'row-sub' }, `Target: ${targetSummary(pe.target)}`),
    pe.note && el('div', { class: 'row-sub' }, pe.note),
  );
  if (existing) {
    main.appendChild(el('div', { class: 'row-sub' },
      el('span', { class: 'pill ok' }, 'done'), ' ', actualSummary(existing.actual),
      existing.rpe ? ` · RPE ${existing.rpe}` : ''));
    row.append(main, el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => logEntryModal({ existing, plan, pe, ex }) }, 'Edit'),
    ));
  } else {
    row.append(main, el('div', { class: 'row-actions' },
      el('button', { class: 'btn small', onclick: () => logEntryModal({ plan, session, pe, ex }) }, 'Log'),
    ));
  }
  return row;
}

// Which form an already-recorded entry needs, read from the data itself.
// null when there's nothing recorded yet, so callers fall back to the plan
// target or the exercise's measurement type.
function inferKind(actual) {
  if (!actual) return null;
  if (actual.distanceM != null || actual.movingSec != null) return 'distance';
  if (actual.durationSec != null) return 'duration';
  if (['sets', 'reps', 'setReps', 'weight', 'setWeights'].some((k) => actual[k] != null)) return 'reps';
  return null;
}

// Picker state round-trips through the modal's Back button so a mis-click
// returns to the same search + scroll position instead of starting over.
function adhocLog(restore) {
  pickExercise((ex, pickerState) => logEntryModal({ ex, onBack: () => adhocLog(pickerState) }), restore);
}

// Shared entry modal for planned, ad-hoc, and edit flows.
function logEntryModal({ existing = null, plan = null, session = null, pe = null, ex = null, onBack = null }) {
  const entry = existing
    ? JSON.parse(JSON.stringify(existing))
    : makeLogEntry({
        planId: plan?.id ?? null,
        plannedExerciseId: pe?.id ?? null,
        exerciseId: ex?.id ?? null,
      });

  // What the entry already holds wins: the form must be able to represent
  // existing data even when the exercise it referenced has been deleted,
  // because Save rebuilds `actual` from whichever fields are shown.
  // Cardio (by exercise category/modality, a distance target, or cardio data
  // already in the entry) gets the full cardio form. Non-cardio intervals are
  // logged as a completed duration, comparable with other timed work.
  const a = entry.actual ?? {};
  const t = pe?.target ?? {};
  const inferred = existing ? inferKind(existing.actual) : null;
  const cardio = hasCardioData(a)
    || (inferred !== 'reps' && (isCardioExercise(ex) || t.kind === 'distance' || ex?.measurementType === 'distance'));
  let kind = cardio ? 'cardio'
    : inferred ?? t.kind ?? (ex?.measurementType === 'duration' ? 'duration' : 'reps');
  if (kind === 'intervals') kind = 'duration';
  const dateInput = el('input', { type: 'date', value: entry.date });
  const fields = el('div', { class: 'field-row' });
  let cardioForm = null;
  let repsForm = null;
  const num = (name, value, step = 1) =>
    el('input', { type: 'number', inputmode: 'decimal', step, value: value ?? '', dataset: { name } });
  const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);

  if (kind === 'reps') {
    // A bodyweight exercise starts as bodyweight-only; untick for a weighted set.
    repsForm = setsForm(existing ? a : {}, t, { bodyweight: ex?.modality === 'bodyweight' });
    fields.append(field('Sets', repsForm.sets));
  } else if (kind === 'cardio') {
    // Older cardio logs held minutes only (durationSec); show that as the
    // duration so re-saving keeps it. A new entry starts from the plan target.
    cardioForm = cardioFields({
      ...a,
      movingSec: a.movingSec ?? a.durationSec ?? (existing ? null : t.durationSec ?? t.totalSec ?? null),
      distanceM: a.distanceM ?? (existing ? null : t.distanceM ?? null),
    }, { gear: store.get('gear'), sport: sportOf(entry, ex), date: entry.date });
  } else {
    const prefillSec = a.durationSec ?? t.durationSec ?? t.totalSec;
    fields.append(field('Duration (min)', num('min', prefillSec ? +(prefillSec / 60).toFixed(1) : '', 1)));
  }

  // Which rung of the exercise's ladder this was (drives the load metrics,
  // js/load.js). Prefilled from the plan's target, else the level last
  // logged; an existing entry shows what it resolves to. Left untouched on
  // an existing entry, nothing new is written.
  let variantSel = null;
  let variantShown = '';
  if (ex?.variants?.length) {
    const lastLevel = () => store.get('logs')
      .filter((l) => l.exerciseId === ex.id && l.id !== entry.id && Number.isInteger(l.actual?.variantLevel))
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))[0]?.actual.variantLevel ?? null;
    const level = existing
      ? variantLevelFor(existing, store.get('plans'))
      : (Number.isInteger(t.variantLevel) ? t.variantLevel : lastLevel());
    variantSel = el('select', { dataset: { name: 'variant' } },
      el('option', { value: '', selected: level == null }, '— not recorded'),
      [...ex.variants].sort((x, y) => x.level - y.level).map((v) =>
        el('option', { value: v.level, selected: v.level === level }, `L${v.level} · ${v.name}`)));
    variantShown = variantSel.value;
  }

  const rpeInput = num('rpe', entry.rpe, 1);
  rpeInput.setAttribute('min', 1);
  rpeInput.setAttribute('max', 10);
  const notesInput = el('textarea', {}, entry.notes ?? '');

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Date'), dateInput),
    variantSel ? el('div', { class: 'field' }, el('label', {}, 'Variant'), variantSel) : null,
    cardioForm ? cardioForm.el : fields,
    repsForm ? el('div', { class: 'field' }, repsForm.table) : null,
    el('div', { class: 'field' }, el('label', {}, 'RPE (1–10, optional)'), rpeInput),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
  );

  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        const val = (n) => {
          const v = parseFloat(body.querySelector(`[data-name="${n}"]`)?.value);
          return isNaN(v) ? null : v;
        };
        const actual = {};
        if (kind === 'reps') {
          const r = repsForm.read();
          if (r.error) { toast(r.error, 'error'); return false; }
          Object.assign(actual, r.values);
        } else if (kind === 'cardio') {
          const r = cardioForm.read();
          if (r.error) { toast(r.error, 'error'); return false; }
          for (const [k, v] of Object.entries(r.values)) if (v != null) actual[k] = v;
          // "Default" is pinned to the gear that's the default right now, so
          // adding new shoes later doesn't move runs already logged in the old
          // ones. With no default set it stays open, and gear added later
          // with an earlier "in use since" date picks it up.
          if (actual.gearId == null) {
            const d = defaultGear(store.get('gear'), sportOf(entry, ex), dateInput.value || todayStr());
            if (d) actual.gearId = d.id;
          }
        } else if (val('min') != null) {
          actual.durationSec = Math.round(val('min') * 60);
        }
        if (variantSel) {
          if (existing && variantSel.value === variantShown) {
            if (a.variantLevel != null) actual.variantLevel = a.variantLevel;
          } else if (variantSel.value !== '') {
            actual.variantLevel = Number(variantSel.value);
          }
        } else if (a.variantLevel != null) {
          actual.variantLevel = a.variantLevel; // exercise deleted or its ladder removed
        }
        Object.assign(entry, {
          date: dateInput.value || todayStr(),
          actual,
          rpe: val('rpe'),
          notes: notesInput.value.trim(),
        });
        store.upsert('logs', entry);
        toast('Logged');
      },
    },
  ];
  if (existing) {
    actions.unshift({
      label: 'Delete',
      class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog('Delete this log entry?'))) return false;
        store.remove('logs', entry.id);
      },
    });
  }
  if (onBack) {
    actions.unshift({ label: '‹ Back', class: 'btn secondary', onClick: () => onBack() });
  }
  openModal(ex?.name ?? 'Log activity', body, actions);
}

// ---------- History ----------

function renderHistory() {
  const lib = exById();
  const plans = store.get('plans');
  const planById = new Map(plans.map((p) => [p.id, p]));

  const fromIn = el('input', { type: 'date', value: histFilter.from, onchange: (e) => { histFilter.from = e.target.value; render(); } });
  const toIn = el('input', { type: 'date', value: histFilter.to, onchange: (e) => { histFilter.to = e.target.value; render(); } });
  const planSel = el('select', { onchange: (e) => { histFilter.planId = e.target.value; render(); } },
    el('option', { value: '' }, 'All plans'),
    plans.map((p) => el('option', { value: p.id, selected: histFilter.planId === p.id }, p.name)),
    el('option', { value: 'adhoc', selected: histFilter.planId === 'adhoc' }, 'Ad-hoc only'),
  );
  root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'History'),
    el('button', { class: 'btn small secondary', onclick: () => importActivitiesModal() }, 'Import GPX/TCX'),
  ));
  root.appendChild(el('div', { class: 'card' },
    el('div', { class: 'field-row' },
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'From'), fromIn),
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'To'), toIn),
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Plan'), planSel),
    ),
  ));

  const inRange = (d) => (!histFilter.from || d >= histFilter.from) && (!histFilter.to || d <= histFilter.to);

  // Merge manual logs and synced activities into one timeline.
  const items = [];
  for (const log of store.get('logs')) {
    if (!inRange(log.date)) continue;
    if (histFilter.planId === 'adhoc' && log.planId) continue;
    if (histFilter.planId && histFilter.planId !== 'adhoc' && log.planId !== histFilter.planId) continue;
    items.push({ kind: 'log', date: log.date, log });
  }
  if (!histFilter.planId || histFilter.planId === 'adhoc') {
    for (const entry of activitiesWithStatus()) {
      if (!inRange(entry.date)) continue;
      if (histFilter.planId === 'adhoc' && entry.matchStatus === 'confirmed') continue;
      items.push({ kind: 'activity', date: entry.date, entry });
    }
  } else {
    for (const entry of activitiesWithStatus()) {
      if (inRange(entry.date) && entry.matchStatus === 'confirmed' && entry.match.planId === histFilter.planId) {
        items.push({ kind: 'activity', date: entry.date, entry });
      }
    }
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (!items.length) {
    root.appendChild(emptyState('No entries in this range.'));
    return;
  }
  const card = el('div', { class: 'card' });
  const gear = store.get('gear');
  for (const item of items) {
    card.appendChild(item.kind === 'log' ? logRow(item.log, lib, planById, gear) : activityRow(item.entry, lib, planById, gear));
  }
  root.appendChild(card);
}

function logRow(log, lib, planById, gear = []) {
  const ex = lib.get(log.exerciseId);
  const plan = planById.get(log.planId);
  const extras = isCardioExercise(ex) || hasCardioData(log.actual)
    ? cardioExtras({ ...log.actual, date: log.date, sport: sportOf(log, ex) }, gear)
    : '';
  return el('div', { class: 'list-row' },
    el('div', { class: 'row-main tappable', onclick: () => logEntryModal({ existing: log, ex }) },
      el('div', { class: 'row-title' }, ex ? exerciseLink(ex) : 'Activity'),
      el('div', { class: 'row-sub' },
        `${formatDate(log.date)} · ${actualSummary(log.actual)}${log.rpe ? ` · RPE ${log.rpe}` : ''}`),
      extras && el('div', { class: 'row-sub' }, extras),
      log.notes && el('div', { class: 'row-sub' }, log.notes),
      // Below the text, not beside it: a long plan name in a no-wrap pill
      // beside the text squeezed the text column to one character wide.
      el('div', { class: 'row-plan' },
        el('span', { class: `pill wrap ${plan ? 'accent' : ''}` }, plan ? plan.name : 'ad-hoc')),
    ),
  );
}

function activityRow(entry, lib, planById, gear = []) {
  const extras = cardioExtras({ ...entry, sport: sportOf(entry, null) }, gear);
  const statusPill = {
    unmatched: ['pill', 'unlinked'],
    suggested: ['pill warn', 'suggested'],
    confirmed: ['pill ok', 'linked'],
    rejected: ['pill', 'ad-hoc'],
  }[entry.matchStatus];

  const row = el('div', { class: 'list-row' },
    el('div', { class: 'row-main tappable', onclick: () => activityEditModal(entry) },
      el('div', { class: 'row-title' }, entry.name || entry.type, ' ',
        el('span', { class: 'pill' }, entry.source ?? 'synced'),
        entry.edited ? el('span', { class: 'pill', style: 'margin-left:4px' }, 'edited') : ''),
      el('div', { class: 'row-sub' }, `${formatDate(entry.date)} · ${actualSummary(entry)}`),
      extras && el('div', { class: 'row-sub' }, extras),
      entry.notes && el('div', { class: 'row-sub' }, entry.notes),
    ),
    el('span', { class: statusPill[0] }, statusPill[1]),
  );

  if (entry.matchStatus === 'suggested') {
    const target = describeMatch(entry.match, planById, lib);
    return el('div', {}, row, el('div', { class: 'list-row', style: 'border-top:none;padding-top:0' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-sub' }, `Suggested match: ${target}`)),
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn small', onclick: () => decideMatch(entry, 'confirmed') }, 'Confirm'),
        el('button', { class: 'btn small secondary', onclick: () => decideMatch(entry, 'rejected') }, 'Reject'),
      ),
    ));
  }
  if (entry.matchStatus === 'unmatched') {
    return el('div', {}, row, el('div', { class: 'list-row', style: 'border-top:none;padding-top:0' },
      el('div', { class: 'row-main' }),
      el('button', { class: 'btn small secondary', onclick: () => manualLink(entry) }, 'Link to plan…'),
    ));
  }
  if (entry.matchStatus === 'confirmed') {
    row.querySelector('.row-main').appendChild(
      el('div', { class: 'row-sub' }, `↳ ${describeMatch(entry.match, planById, lib)}`),
    );
  }
  return row;
}

// Sports offered when correcting an activity. Values are SPORT_TYPE_MAP keys,
// so a correction also fixes how the matcher classifies the activity.
const SPORT_OPTIONS = [
  ['running', 'Running'],
  ['trail_running', 'Trail running'],
  ['treadmill_running', 'Treadmill running'],
  ['walking', 'Walking'],
  ['hiking', 'Hiking'],
  ['cycling', 'Cycling'],
  ['indoor_cycling', 'Indoor cycling'],
  ['swimming', 'Swimming'],
  ['rowing', 'Rowing'],
  ['strength_training', 'Strength training'],
  ['other_outdoor', 'Other (outdoor)'],
  ['other_indoor', 'Other (indoor)'],
];

// Correct a synced or imported activity. Edits are kept in a browser-owned
// overlay (store.editActivity), so nothing here writes the sync workflow's
// files and a later re-sync can't undo the correction.
function activityEditModal(entry) {
  const name = el('input', { type: 'text', value: entry.name ?? '' });
  const options = SPORT_OPTIONS.some(([v]) => v === entry.type)
    ? SPORT_OPTIONS
    : [[entry.type ?? '', entry.type || 'Unknown'], ...SPORT_OPTIONS];
  const type = el('select', {}, options.map(([v, label]) =>
    el('option', { value: v, selected: v === entry.type }, label)));
  const date = el('input', { type: 'date', value: entry.date });
  const cardio = cardioFields(entry, { gear: store.get('gear'), sport: sportOf(entry, null), date: entry.date });
  const notes = el('textarea', { placeholder: 'How it felt, conditions, anything worth keeping' }, entry.notes ?? '');
  let modal;

  const save = async () => {
    const r = cardio.read();
    if (r.error) { toast(r.error, 'error'); return false; }
    if (!date.value) { toast('Pick a date', 'error'); return false; }
    // editActivity stores only what differs from the synced record, so a
    // field left as it came (gear left on "Default" included) isn't an edit.
    await store.editActivity(entry.id, {
      name: name.value.trim() || null,
      type: type.value || null,
      date: date.value,
      ...r.values,
      notes: notes.value.trim() || null,
    });
    modal.close();
    toast('Activity updated');
    runMatcher();
    render();
  };

  const del = async () => {
    if (!await confirmDialog(`Remove “${entry.name || entry.type}” from your history?`)) return false;
    // Drop its match too, or a confirmed link would keep counting towards
    // adherence for an activity that no longer exists.
    const matches = store.get('matches').filter((m) => matchActivityId(m) !== entry.id);
    if (matches.length !== store.get('matches').length) await store.save('matches', matches);
    const how = await store.removeActivity(entry.id);
    modal.close();
    toast(how === 'deleted' ? 'Activity deleted' : 'Activity hidden from history');
    render();
  };

  const actions = [{ label: 'Cancel', class: 'btn secondary', onClick: () => {} }];
  if (entry.edited) {
    actions.push({
      label: 'Reset',
      class: 'btn secondary',
      onClick: async () => { await store.resetActivity(entry.id); toast('Reverted to the original'); render(); },
    });
  }
  actions.push({ label: 'Delete', class: 'btn danger', onClick: del, keepOpen: true });
  actions.push({ label: 'Save', class: 'btn', onClick: save, keepOpen: true });

  modal = openModal('Edit activity', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Name'), name),
    el('div', { class: 'field' }, el('label', {}, 'Sport'), type),
    el('div', { class: 'field' }, el('label', {}, 'Date'), date),
    cardio.el,
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notes),
    el('p', { class: 'muted' }, entry.gpsPolyline
      ? 'The GPS route is kept as recorded. Edits are stored separately from the synced file, so re-syncing won’t undo them.'
      : 'Edits are stored separately from the synced file, so re-syncing won’t undo them.'),
  ), actions);
}

function describeMatch(match, planById, lib) {
  const plan = planById.get(match.planId);
  if (!plan) return 'a deleted plan';
  const session = allSessions(plan).map((s) => s.session).find((s) => s.id === match.sessionId);
  const item = session && sessionItems(session).map((x) => x.item).find((i) => i.id === match.plannedExerciseId);
  const ex = item && lib.get(item.exerciseId);
  return [plan.name, session?.label, ex?.name].filter(Boolean).join(' · ') || plan.name;
}

function decideMatch(entry, status) {
  const matches = store.get('matches').slice();
  const i = matches.findIndex((m) => matchActivityId(m) === entry.id);
  if (i >= 0) matches[i] = { ...matches[i], status };
  else matches.push(makeMatch({ activityId: entry.id, status }));
  store.save('matches', matches);
  toast(status === 'confirmed' ? 'Linked to plan' : 'Left as ad-hoc');
}

// Manual picker for ambiguous/unmatched entries: shows nearby candidates.
function manualLink(entry) {
  const lib = exById();
  const candidates = findCandidates(entry, activePlans(), lib, 7); // wide window for manual review
  const list = el('div', {});
  let modal;
  if (!candidates.length) {
    list.appendChild(el('p', { class: 'muted' },
      'No planned exercises of a matching type within a week of this activity.'));
  }
  for (const c of candidates.slice(0, 12)) {
    const date = addDays(c.plan.startDate, c.session.dayOffset);
    list.appendChild(el('div', { class: 'list-row tappable', onclick: () => {
      modal.close();
      const matches = store.get('matches').slice();
      const rec = makeMatch({
        activityId: entry.id, status: 'confirmed',
        planId: c.planId, sessionId: c.sessionId, plannedExerciseId: c.plannedExerciseId,
      });
      const i = matches.findIndex((m) => matchActivityId(m) === entry.id);
      if (i >= 0) matches[i] = rec;
      else matches.push(rec);
      store.save('matches', matches);
      toast('Linked to plan');
    } },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, c.exercise.name),
        el('div', { class: 'row-sub' },
          `${c.plan.name} · ${c.session.label || 'session'} · ${formatDate(date)} · target ${targetSummary(c.plannedExercise.target)}`),
      ),
    ));
  }
  modal = openModal(`Link “${entry.name || entry.type}”`, list, [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    { label: 'Mark as ad-hoc', class: 'btn secondary', onClick: () => decideMatch(entry, 'rejected') },
  ]);
}

// ---------- Metrics ----------

function renderMetrics() {
  const metrics = [...store.get('metrics')].sort((a, b) => (a.date < b.date ? -1 : 1));

  // Adherence over the selected window.
  const { done, planned } = adherence(adherenceDays);
  const pct = planned ? Math.round((done / planned) * 100) : null;
  root.appendChild(el('div', { class: 'stat-row' },
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-value' }, pct == null ? '—' : `${pct}%`),
      el('div', { class: 'stat-label' }, `adherence · ${done}/${planned} planned`),
    ),
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-value' }, String(logCount(adherenceDays))),
      el('div', { class: 'stat-label' }, `activities · last ${adherenceDays}d`),
    ),
  ));
  root.appendChild(el('div', { class: 'segmented' },
    [7, 30, 90].map((d) => el('button', {
      class: adherenceDays === d ? 'active' : '',
      onclick: () => { adherenceDays = d; render(); },
    }, `${d} days`)),
  ));

  // Body metrics: weight chart always, other metrics only once they have
  // enough data to draw a trend.
  root.appendChild(el('div', { class: 'list-row' },
    el('h3', {}, 'Body weight'),
    el('button', { class: 'btn small', onclick: () => logBodyMetric() }, '+ Log metrics'),
  ));
  const weightGoal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
  for (const m of BODY_METRICS) {
    const res = resolveMetric(m);
    const points = datePoints(
      metrics.filter((r) => r[m.id] != null),
      (r) => res.toInput(r[m.id]),
      (r) => `${r.date}: ${res.toInput(r[m.id])} ${res.unit}`,
    );
    if (m.id !== 'weight' && points.length < 2) continue;
    if (m.id !== 'weight') root.appendChild(el('h3', {}, m.label));
    const refLine = m.id === 'weight' && weightGoal
      ? { value: res.toInput(weightGoal.targetWeight), label: `goal ${res.toInput(weightGoal.targetWeight)} ${res.unit}` }
      : null;
    root.appendChild(lineChart({
      points,
      yLabel: res.unit,
      yFormat: (v) => (res.step >= 1 ? String(Math.round(v)) : v.toFixed(1)),
      refLine,
    }));
  }

  // Running pace + distance from all sources
  const runs = runningActivities();
  root.appendChild(el('h3', {}, 'Running pace'));
  root.appendChild(lineChart({
    points: datePoints(runs.filter((r) => r.distanceM && r.movingSec),
      (r) => paceChartValue(r.distanceM, r.movingSec),
      (r) => `${r.date}: ${formatPace(r.distanceM, r.movingSec)} · ${formatDistance(r.distanceM)}`),
    yLabel: `min${paceUnit()} (lower = faster)`,
    yFormat: (v) => v.toFixed(1),
    invertY: true,
  }));
  root.appendChild(el('h3', {}, 'Running distance'));
  root.appendChild(lineChart({
    points: datePoints(runs.filter((r) => r.distanceM),
      (r) => distanceToInput(r.distanceM),
      (r) => `${r.date}: ${formatDistance(r.distanceM)}`),
    yLabel: distanceUnit(),
    yFormat: (v) => v.toFixed(1),
  }));

  if (metrics.length) {
    const card = el('div', { class: 'card' }, el('h3', {}, 'Recent entries'));
    for (const m of [...metrics].reverse().slice(0, 10)) {
      card.appendChild(el('div', { class: 'list-row' },
        el('div', { class: 'row-main tappable', onclick: () => logBodyMetric(m) },
          el('div', { class: 'row-title' }, metricSummary(m) || '—'),
          el('div', { class: 'row-sub' }, formatDate(m.date, { month: 'short', day: 'numeric', year: 'numeric' }), m.notes ? ` · ${m.notes}` : ''),
        ),
      ));
    }
    root.appendChild(card);
  }
  root.appendChild(heatmapSection());
}

function runningActivities() {
  const out = [];
  for (const e of store.getActivityEntries()) {
    if (sportMapping(e.type).modality === 'run') out.push(e);
  }
  const lib = exById();
  for (const l of store.get('logs')) {
    const ex = lib.get(l.exerciseId);
    if (ex?.modality === 'run' && l.actual?.distanceM) {
      out.push({ date: l.date, distanceM: l.actual.distanceM, movingSec: l.actual.movingSec });
    }
  }
  return out;
}

function logCount(days) {
  const from = addDays(todayStr(), -days);
  return store.get('logs').filter((l) => l.date >= from).length
    + store.getActivityEntries().filter((e) => e.date >= from).length;
}

// Planned exercises due in [today-days, today] vs. those actually completed
// (a linked manual log, or a confirmed activity match).
function adherence(days) {
  const from = addDays(todayStr(), -days);
  const to = todayStr();
  const loggedPe = new Set(store.get('logs').filter((l) => l.plannedExerciseId).map((l) => l.plannedExerciseId));
  const confirmedPe = new Set(store.get('matches').filter((m) => m.status === 'confirmed' && m.plannedExerciseId).map((m) => m.plannedExerciseId));
  let planned = 0;
  let done = 0;
  for (const plan of activePlans()) {
    for (const { session, dayOffset } of allSessions(plan)) {
      const d = addDays(plan.startDate, dayOffset);
      if (d < from || d > to) continue;
      for (const { item } of sessionItems(session)) {
        if (item.optional) continue; // skipping optional work isn't non-adherence
        planned++;
        if (loggedPe.has(item.id) || confirmedPe.has(item.id)) done++;
      }
    }
  }
  return { done, planned };
}

function logBodyMetric(existing = null) {
  const entry = existing ? { ...existing } : makeBodyMetric();
  const dateIn = el('input', { type: 'date', value: entry.date });
  const inputs = new Map(BODY_METRICS.map((m) => {
    const res = resolveMetric(m);
    return [m.id, el('input', {
      type: 'number', inputmode: 'decimal', step: res.step,
      value: res.toInput(entry[m.id]) ?? '',
    })];
  }));
  const notesIn = el('input', { value: entry.notes ?? '', placeholder: 'optional' });
  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        const values = {};
        for (const m of BODY_METRICS) {
          const v = parseFloat(inputs.get(m.id).value);
          values[m.id] = isNaN(v) ? null : resolveMetric(m).fromInput(v);
        }
        if (Object.values(values).every((v) => v == null)) {
          toast('Enter at least one measurement', 'error');
          return false;
        }
        Object.assign(entry, values, { date: dateIn.value || todayStr(), notes: notesIn.value.trim() });
        store.upsert('metrics', entry);
      },
    },
  ];
  if (existing) {
    actions.unshift({
      label: 'Delete', class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog('Delete this entry?'))) return false;
        store.remove('metrics', entry.id);
      },
    });
  }
  const metricFields = BODY_METRICS.map((m) =>
    el('div', { class: 'field' }, el('label', {}, `${m.label} (${resolveMetric(m).unit})`), inputs.get(m.id)));
  openModal('Body metrics', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Date'), dateIn),
    el('div', { class: 'field-row' }, metricFields.slice(0, 2)),
    el('div', { class: 'field-row' }, metricFields.slice(2)),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesIn),
  ), actions);
}

// Summary like "82.0 kg · 15.2 % · 48 bpm" for the entries list,
// in the user's display units.
function metricSummary(entry) {
  return BODY_METRICS
    .filter((m) => entry[m.id] != null)
    .map((m) => {
      const res = resolveMetric(m);
      return `${res.toInput(entry[m.id])} ${res.unit}`;
    })
    .join(' · ');
}

// ---------- Heatmap ----------

// A section at the bottom of Metrics. Leaflet and the routes load only when
// the section scrolls near the screen, so opening Metrics stays quick.
function heatmapSection() {
  const container = el('div', { class: 'heatmap-container' }, el('p', { class: 'muted', style: 'padding:16px' }, 'Map loads when you scroll here…'));
  const section = el('div', { class: 'heatmap-section' }, el('h3', {}, 'Routes heatmap'), container);
  let started = false;
  const start = () => {
    if (started || !container.isConnected) return;
    started = true;
    observer?.disconnect();
    renderHeatmap(container);
  };
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) start(); }, { rootMargin: '300px' })
    : null;
  if (observer) observer.observe(container);
  else setTimeout(start, 0);
  return section;
}

async function renderHeatmap(container) {
  container.innerHTML = '';
  container.appendChild(el('p', { class: 'muted', style: 'padding:16px' }, 'Loading map…'));
  const entries = store.getActivityEntries().filter((e) => e.gpsPolyline);
  if (!entries.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('No GPS routes yet. Sync Polar, or import a GPX/TCX file from History.'));
    return;
  }
  const mod = await import('./heatmap-view.js');
  if (!container.isConnected) return; // switched away while Leaflet loaded
  const instance = await mod.show(container, entries);
  // A re-render may have replaced the container while the map was building.
  if (container.isConnected) heatmapMod = instance;
  else instance.destroy();
}
