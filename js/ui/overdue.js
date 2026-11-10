// The open-session card: a planned session whose date has passed, that isn't
// completed or skipped. Shown on Today and on Plans. Its choices write
// data/schedule.json (js/schedule.js); logs are never touched.

import * as store from '../storage/store.js';
import { el, toast } from './components.js';
import { formatDate, diffDays, addDays } from '../dates.js';
import { occurrences, slidePlan, skipSession } from '../schedule.js';
import { sessionStatus, doneItemIds } from '../sessions.js';
import { hasRun } from '../pain.js';

// ---------- Overdue sessions (js/schedule.js) ----------
//
// A planned session is overdue when its date has passed, it isn't completed
// and it wasn't skipped. Today offers the earliest one: slide the plan (it
// and every later session move by the same N days — spacing kept, the plan
// ends later), skip it, or not now (for this visit). Your logs are never
// touched, and there's no guilt copy.

let notNow = null; // `${date}|${key}` dismissed for this visit only

// onNotNow: redraw the caller's view once "Not now" hides the card.
export function overdueCard(today, { onNotNow = () => {}, plan: onlyPlan = null } = {}) {
  const plans = store.get('plans');
  const schedule = store.get('schedule');
  const records = store.get('sessions');
  const logs = store.get('logs');
  const doneIds = doneItemIds(logs, store.get('matches'));
  const isDone = (o) => sessionStatus({ session: o.session, date: o.date, records, doneIds, repeat: o.repeat, logs }).completed;
  const o = occurrences(onlyPlan ? [onlyPlan] : plans, schedule)
    .find((x) => !x.skipped && !x.repeat && x.date < today && !isDone(x) && notNow !== `${today}|${x.key}`);
  if (!o) return null;
  const n = diffDays(o.date, today);
  const wd = (d, long = false) => formatDate(d, { weekday: long ? 'long' : 'short' });
  const what = hasRun(o.session, new Map(store.get('exercises').map((e) => [e.id, e]))) ? 'run' : 'session';
  const moving = occurrences([o.plan], schedule, { activeOnly: false })
    .filter((x) => !x.repeat && !x.skipped && x.date >= o.date && !isDone(x));
  // Labels often name their week already ("Week 1 · Session 2 — Run/Walk").
  const label = (x) => (/week/i.test(x.session.label ?? '') ? x.session.label : `Week ${x.week.index} · ${x.session.label || 'Session'}`);
  return el('div', { class: 'card overdue-card', dataset: { overdue: o.key } },
    el('div', { class: 'overdue-title' }, `${wd(o.date, true)}’s ${what} is still open`),
    el('div', { class: 'row-sub' }, [label(o), o.session.estimatedDurationMin ? `about ${o.session.estimatedDurationMin} min` : null].filter(Boolean).join(' · ')),
    el('p', { class: 'overdue-text' }, 'Slide the plan to start it today, or skip it. Your logs and weights are untouched either way.'),
    el('div', { class: 'slide-preview' },
      el('div', { class: 'row-sub', style: 'font-weight:650' }, `If you slide ${n} day${n === 1 ? '' : 's'}`),
      moving.slice(0, 3).map((x) => el('div', { class: 'list-row' },
        el('div', { class: 'row-main' }, label(x)),
        el('div', {}, el('span', { class: 'muted' }, `${wd(x.date)} → `), el('strong', {}, wd(addDays(x.date, n)))))),
      moving.length > 3 && el('div', { class: 'row-sub', style: 'margin-top:6px' },
        `…and every later session moves ${n} day${n === 1 ? '' : 's'} too. Spacing stays the same.`)),
    el('button', { class: 'btn block large', dataset: { action: 'slide' }, onclick: () => {
      store.save('schedule', slidePlan({ plan: o.plan, fromDate: o.date, days: n, schedule, isDone }));
      toast(`Plan slid ${n} day${n === 1 ? '' : 's'}`);
    } }, 'Slide plan'),
    el('button', { class: 'btn block ghost', style: 'margin-top:8px', dataset: { action: 'skip' }, onclick: () => {
      store.save('schedule', skipSession({ plan: o.plan, session: o.session, schedule }));
      toast('Skipped');
    } }, 'Skip it'),
    el('button', { class: 'link-btn block-link', dataset: { action: 'not-now' }, onclick: () => { notNow = `${today}|${o.key}`; onNotNow(); } }, 'Not now'),
  );
}

