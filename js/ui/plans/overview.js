// Plans → the current plan: week N of M, its sessions, and which plan is
// "current" (ft.currentPlan in localStorage).
import * as store from '../../storage/store.js';
import { occurrences } from '../../schedule.js';
import { formatDate, todayStr } from '../../dates.js';
import { doneItemIds, sessionStatus } from '../../sessions.js';
import { blockTypeLabel, editSession, targetSummary } from './session-editor.js';
import { exerciseLinks, renderPlanList } from './list.js';
import { el } from '../components.js';
import { render } from '../plans-tab.js';
import { overdueCard } from '../overdue.js';
import { sessionItems } from '../../models.js';
import { delayDialog, delayLabel } from '../delay.js';
import { S } from './state.js';

// ---------- The current plan (the design's Plans view) ----------
//
// One plan at a time: where you are in it, its weeks, and this week's
// sessions. "Switch plan" opens the list of plans (and their editors).

export const CURRENT_KEY = 'ft.currentPlan';
export function currentPlan() {
  const active = store.get('plans').filter((p) => p.status === 'active');
  if (!active.length) return null;
  let id = null;
  try { id = localStorage.getItem(CURRENT_KEY); } catch { /* blocked */ }
  return active.find((p) => p.id === id)
    // else the plan running today, else the most recently started
    ?? active.find((p) => {
      const dates = occurrences([p], store.get('schedule')).map((o) => o.date);
      return dates.length && dates[0] <= todayStr() && dates.at(-1) >= todayStr();
    })
    ?? [...active].sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
}
export function setCurrentPlan(id) {
  try { localStorage.setItem(CURRENT_KEY, id); } catch { /* blocked */ }
}

// Each week's sessions with their dates and status, in plan order.
export function planWeeks(plan) {
  const today = todayStr();
  const schedule = store.get('schedule');
  const logs = store.get('logs');
  const records = store.get('sessions');
  const doneIds = doneItemIds(logs, store.get('matches'));
  const occ = occurrences([plan], schedule, { activeOnly: false }).filter((o) => !o.repeat);
  return [...(plan.weeks ?? [])].sort((a, b) => a.index - b.index).map((week) => {
    const sessions = occ.filter((o) => o.week === week).map((o) => {
      const st = sessionStatus({ session: o.session, date: o.date, records, doneIds });
      const moved = schedule.some((r) => r.id === o.key && r.kind === 'move');
      const state = o.skipped ? 'skipped' : st.completed ? 'done' : o.date === today ? 'today' : o.date < today ? 'open' : 'planned';
      return { ...o, state, moved };
    });
    const finished = sessions.length > 0 && sessions.every((x) => x.state === 'done' || x.state === 'skipped');
    return { week, sessions, finished };
  });
}

export const STATE_LABEL = { done: 'Done', skipped: 'Skipped', today: 'Today', open: 'Open', planned: 'Planned' };

// "6 × (2m run / 1m 30s walk)" for one item, "6 exercises" for many, a
// warm-up's total minutes.
export function blockSummary(block) {
  const items = block.items ?? [];
  if (!items.length) return '—';
  if (items.length === 1) return targetSummary(items[0].target);
  if (['warmup', 'cooldown'].includes(block.type)) {
    const sec = items.reduce((a, it) => a + (it.target?.durationSec ?? 0) * (it.target?.sets ?? 1) * (it.target?.reps ?? 1), 0);
    if (sec) return `${Math.round(sec / 60)} min`;
  }
  return `${items.length} exercises`;
}

// The plan's own length when it has one (v2 imports do), else a rough
// length from the targets: timed work as
// written, a strength set as ~40 s plus its rest (90 s if none given).
export function estimateMin(session) {
  if (session.estimatedDurationMin) return session.estimatedDurationMin; // the plan's own
  let sec = 0;
  for (const it of (session.blocks ?? []).flatMap((b) => b.items ?? [])) {
    const t = it.target ?? {};
    const sets = t.sets ?? 1;
    if (t.durationSec) sec += t.durationSec * (t.reps ?? 1) * sets + (t.restSec ?? 0) * Math.max(0, sets - 1);
    else if (t.distanceM) sec += (t.distanceM / 1000) * 360;
    else sec += sets * (40 + (t.restSec ?? 90));
  }
  return sec ? Math.max(5, Math.round(sec / 300) * 5) : 0;
}

export function renderOverview(plan) {
  const today = todayStr();
  const lib = new Map(store.get('exercises').map((e) => [e.id, e]));
  const weeks = planWeeks(plan);
  if (!weeks.length) { renderPlanList(); return; }
  const currentIdx = Math.max(0, weeks.findIndex((w) => !w.finished));
  const current = weeks.findIndex((w) => !w.finished) === -1 ? weeks.length - 1 : currentIdx;
  const doneCount = weeks.filter((w) => w.finished).length;
  const shownIdx = Math.min(weeks.length - 1, Math.max(0, S.viewWeek != null
    ? weeks.findIndex((w) => w.week.index === S.viewWeek) : current));
  const shown = weeks[shownIdx];

  // Header: the plan, how far along, Switch plan.
  S.root.appendChild(el('div', { class: 'plan-head' },
    el('div', { class: 'plan-head-main' },
      el('h2', { class: 'page-h1' }, plan.name),
      el('div', { class: 'plan-progress' },
        el('span', {}, `Week ${weeks[current].week.index} of ${weeks.length}`),
        el('span', { class: 'progress-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': weeks.length, 'aria-valuenow': doneCount,
          'aria-label': `${doneCount} of ${weeks.length} weeks done` },
        el('span', { class: 'progress-fill', style: `width:${Math.round((doneCount / weeks.length) * 100)}%` })),
        el('span', {}, `${doneCount} week${doneCount === 1 ? '' : 's'} done`))),
    el('div', { class: 'plan-head-actions' },
      el('button', { class: 'btn ghost', type: 'button', dataset: { action: 'switch-plan' }, onclick: () => { S.view = { name: 'list' }; render(); } }, 'Switch plan'),
      el('button', { class: 'link-btn', type: 'button', dataset: { action: 'edit-plan' }, onclick: () => { S.view = { name: 'plan', planId: plan.id }; render(); } }, 'Edit plan'))));

  // Weeks: a sidebar on desktop, a scrolling row on a phone.
  const lo = S.weeksExpanded ? 0 : Math.max(0, current - 2);
  const hi = S.weeksExpanded ? weeks.length : Math.min(weeks.length, current + 6);
  const weekBtn = (w, i) => {
    const mark = w.finished ? 'done' : i === current ? 'current' : 'upcoming';
    return el('button', {
      type: 'button', class: `week-btn${i === shownIdx ? ' active' : ''}`, dataset: { week: w.week.index },
      'aria-current': i === shownIdx ? 'true' : null,
      onclick: () => { S.viewWeek = w.week.index; render(); },
    }, el('span', { class: `week-mark ${mark}`, 'aria-hidden': 'true' }, mark === 'done' ? '✓' : ''), `Week ${w.week.index}`);
  };
  const side = el('aside', { class: 'week-side', 'aria-label': 'Weeks' },
    el('section', { class: 'card week-card' },
      el('div', { class: 'side-head' }, el('span', {}, 'Weeks')),
      el('div', { class: 'week-list' },
        weeks.slice(lo, hi).map((w, k) => weekBtn(w, lo + k)),
        !S.weeksExpanded && weeks.length > hi - lo && el('button', { type: 'button', class: 'link-btn', onclick: () => { S.weeksExpanded = true; render(); } },
          `${weeks.length - (hi - lo)} more weeks`))));

  const main = el('div', { class: 'col-main' });
  const overdue = overdueCard(today, { plan, onNotNow: () => render() });
  if (overdue) main.appendChild(overdue);
  main.appendChild(el('div', { class: 'week-title' }, `Week ${shown.week.index}`,
    shown.week.isDeload ? el('span', { class: 'pill', style: 'margin-left:8px' }, 'deload') : null,
    shown.week.focus ? el('span', { class: 'row-sub', style: 'margin-left:8px' }, shown.week.focus) : null));
  main.appendChild(el('div', { class: 'session-cards' }, shown.sessions.map((o, k) => el('section', {
    class: `card session-card tappable state-${o.state}`, dataset: { session: o.session.id },
    onclick: () => editSession(plan, o.session),
  },
  el('div', { class: 'session-card-top' },
    el('span', { class: 'row-sub' }, `Session ${k + 1}`),
    el('span', { class: `status-pill ${o.state}` }, STATE_LABEL[o.state])),
  el('div', { class: 'session-card-title' }, o.session.label || 'Session'),
  el('div', { class: 'row-sub' }, `${formatDate(o.date, { weekday: 'short', month: 'short', day: 'numeric' })}`
    + `${o.moved ? ' · moved' : ''}${estimateMin(o.session) ? ` · ~${estimateMin(o.session)} min` : ''}`),
  el('div', { class: 'session-blocks' }, (o.session.blocks ?? []).map((b) => el('div', { class: 'block-row' },
    el('span', {}, b.name || blockTypeLabel(b.type)),
    el('span', { class: 'muted' }, blockSummary(b))))),
  exerciseLinks(sessionItems(o.session).map(({ item }) => item.exerciseId), lib, 'session-exercises'),
  // Today's or a later one, not yet done: push it back a day.
  ['today', 'planned'].includes(o.state) && el('button', {
    class: 'link-btn move-btn', type: 'button', dataset: { action: 'move-later' },
    onclick: (e) => { e.stopPropagation(); delayDialog(o); },
  }, delayLabel(o.date))))));
  const after = weeks[shownIdx + 1];
  if (after) {
    const ds = after.sessions.map((x) => x.date).sort();
    main.appendChild(el('button', { type: 'button', class: 'card next-week-row', dataset: { action: 'next-week' },
      onclick: () => { S.viewWeek = after.week.index; render(); } },
    el('span', { class: 'next-week-name' }, `Week ${after.week.index}`),
    el('span', { class: 'muted' }, `${after.sessions.length} session${after.sessions.length === 1 ? '' : 's'}`
      + (ds.length ? ` · ${formatDate(ds[0], { month: 'short', day: 'numeric' })} – ${formatDate(ds.at(-1), { month: 'short', day: 'numeric' })}` : ''), ' ›')));
  }
  S.root.appendChild(el('div', { class: 'two-col plan-layout' }, side, main));
}
