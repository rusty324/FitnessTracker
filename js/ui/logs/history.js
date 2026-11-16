// Logs → History: manual logs and synced/imported activities, editing an
// activity, and confirming or rejecting its match to the plan.
import { activePlans, activitiesWithStatus, actualSummary, exById, render, runMatcher } from '../logs-tab.js';
import * as store from '../../storage/store.js';
import { confirmDialog, el, emptyState, exerciseLink, openModal, toast } from '../components.js';
import { importActivitiesModal, logEntryModal } from './today.js';
import { hasCardioData, isCardioExercise, sportOf } from '../../cardio.js';
import { cardioExtras, cardioFields } from '../cardio-form.js';
import { formatDate } from '../../dates.js';
import { allSessions, makeMatch, matchActivityId, sessionItems } from '../../models.js';
import { findCandidates } from '../../matcher.js';
import { targetSummary } from '../plans-tab.js';
import { S } from './state.js';

// ---------- History ----------

export function renderHistory() {
  const lib = exById();
  const plans = store.get('plans');
  const planById = new Map(plans.map((p) => [p.id, p]));

  const fromIn = el('input', { type: 'date', value: S.histFilter.from, onchange: (e) => { S.histFilter.from = e.target.value; render(); } });
  const toIn = el('input', { type: 'date', value: S.histFilter.to, onchange: (e) => { S.histFilter.to = e.target.value; render(); } });
  const planSel = el('select', { onchange: (e) => { S.histFilter.planId = e.target.value; render(); } },
    el('option', { value: '' }, 'All plans'),
    plans.map((p) => el('option', { value: p.id, selected: S.histFilter.planId === p.id }, p.name)),
    el('option', { value: 'adhoc', selected: S.histFilter.planId === 'adhoc' }, 'Ad-hoc only'),
  );
  S.root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'History'),
    el('button', { class: 'btn small secondary', onclick: () => importActivitiesModal() }, 'Import GPX/TCX'),
  ));
  S.root.appendChild(el('div', { class: 'card' },
    el('div', { class: 'field-row' },
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'From'), fromIn),
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'To'), toIn),
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Plan'), planSel),
    ),
  ));

  const inRange = (d) => (!S.histFilter.from || d >= S.histFilter.from) && (!S.histFilter.to || d <= S.histFilter.to);

  // Merge manual logs and synced activities into one timeline.
  const items = [];
  for (const log of store.get('logs')) {
    if (!inRange(log.date)) continue;
    if (S.histFilter.planId === 'adhoc' && log.planId) continue;
    if (S.histFilter.planId && S.histFilter.planId !== 'adhoc' && log.planId !== S.histFilter.planId) continue;
    items.push({ kind: 'log', date: log.date, log });
  }
  if (!S.histFilter.planId || S.histFilter.planId === 'adhoc') {
    for (const entry of activitiesWithStatus()) {
      if (!inRange(entry.date)) continue;
      if (S.histFilter.planId === 'adhoc' && entry.matchStatus === 'confirmed') continue;
      items.push({ kind: 'activity', date: entry.date, entry });
    }
  } else {
    for (const entry of activitiesWithStatus()) {
      if (inRange(entry.date) && entry.matchStatus === 'confirmed' && entry.match.planId === S.histFilter.planId) {
        items.push({ kind: 'activity', date: entry.date, entry });
      }
    }
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (!items.length) {
    S.root.appendChild(emptyState('No entries in this range.'));
    return;
  }
  const card = el('div', { class: 'card' });
  const gear = store.get('gear');
  for (const item of items) {
    card.appendChild(item.kind === 'log' ? logRow(item.log, lib, planById, gear) : activityRow(item.entry, lib, planById, gear));
  }
  S.root.appendChild(card);
}

export function logRow(log, lib, planById, gear = []) {
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

export function activityRow(entry, lib, planById, gear = []) {
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
export const SPORT_OPTIONS = [
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
export function activityEditModal(entry) {
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

export function describeMatch(match, planById, lib) {
  const plan = planById.get(match.planId);
  if (!plan) return 'a deleted plan';
  const session = allSessions(plan).map((s) => s.session).find((s) => s.id === match.sessionId);
  const item = session && sessionItems(session).map((x) => x.item).find((i) => i.id === match.plannedExerciseId);
  const ex = item && lib.get(item.exerciseId);
  return [plan.name, session?.label, ex?.name].filter(Boolean).join(' · ') || plan.name;
}

export function decideMatch(entry, status) {
  const matches = store.get('matches').slice();
  const i = matches.findIndex((m) => matchActivityId(m) === entry.id);
  if (i >= 0) matches[i] = { ...matches[i], status };
  else matches.push(makeMatch({ activityId: entry.id, status }));
  store.save('matches', matches);
  toast(status === 'confirmed' ? 'Linked to plan' : 'Left as ad-hoc');
}

// Manual picker for ambiguous/unmatched entries: shows nearby candidates.
export function manualLink(entry) {
  const lib = exById();
  const candidates = findCandidates(entry, activePlans(), lib, 7, store.get('schedule')); // wide window for manual review
  const list = el('div', {});
  let modal;
  if (!candidates.length) {
    list.appendChild(el('p', { class: 'muted' },
      'No planned exercises of a matching type within a week of this activity.'));
  }
  for (const c of candidates.slice(0, 12)) {
    const date = c.date;
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
