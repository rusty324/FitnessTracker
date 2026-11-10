// The schedule: when each planned session actually happens. Pure.
//
// THE ONLY PLACE a planned session's date is worked out. A session's
// nominal date is its plan's start + dayOffset; data/schedule.json can move
// it (the plan slid after missed days), skip it, or add a repeat (the week
// repeated after pain). Everything that shows, counts or matches sessions by
// date goes through effectiveSessionDate() / occurrences() — Today, the plan
// list and calendar, adherence, the activity matcher, the review — and a
// test fails if any other module computes the nominal date itself.
//
// data/schedule.json is a ghsync collection (a list of records), one per
// change:
//   { id: '<planId>:<sessionId>', kind: 'move', planId, sessionId, date }
//   { id: '<planId>:<sessionId>', kind: 'skip', planId, sessionId, date }
//   { id: 'repeat:<planId>:<sessionId>:<date>', kind: 'repeat', planId, sessionId, date }
// The plan itself is never edited.

import { addDays, diffDays } from './dates.js';
import { allSessions } from './models.js';

export const sessionKey = (planId, sessionId) => `${planId}:${sessionId}`;

function nominalDate(plan, dayOffset) {
  return addDays(plan.startDate, dayOffset);
}

const overrideOf = (schedule, key) => schedule.find((r) => r.id === key && (r.kind === 'move' || r.kind === 'skip'));

// The date a session happens on (moved or not). A skipped session keeps the
// date it had when skipped.
export function effectiveSessionDate(plan, session, schedule = [], dayOffset = session.dayOffset) {
  const o = overrideOf(schedule, sessionKey(plan.id, session.id));
  return o?.date ?? nominalDate(plan, dayOffset ?? 0);
}
export const isSkipped = (plan, session, schedule = []) =>
  overrideOf(schedule, sessionKey(plan.id, session.id))?.kind === 'skip';

// Every planned session of the given plans, with its effective date, plus
// repeat occurrences, sorted by date.
// -> [{ plan, week, session, dayOffset, key, date, skipped, repeat }]
export function occurrences(plans, schedule = [], { activeOnly = true } = {}) {
  const out = [];
  for (const plan of plans) {
    if (activeOnly && plan.status !== 'active') continue;
    const repeats = schedule.filter((r) => r.kind === 'repeat' && r.planId === plan.id);
    for (const { session, week, dayOffset } of allSessions(plan)) {
      const key = sessionKey(plan.id, session.id);
      out.push({
        plan, week, session, dayOffset, key,
        date: effectiveSessionDate(plan, session, schedule, dayOffset),
        skipped: isSkipped(plan, session, schedule),
        repeat: false,
      });
      for (const r of repeats.filter((x) => x.sessionId === session.id)) {
        out.push({ plan, week, session, dayOffset, key: r.id, date: r.date, skipped: false, repeat: true });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.dayOffset - b.dayOffset));
}

// Planned sessions dated within [from, to] (skipped ones left out).
export function plannedBetween(plans, from, to, schedule = []) {
  return occurrences(plans, schedule).filter((o) => !o.skipped && o.date >= from && o.date <= to);
}

// The plan item an exercise is next prescribed in (on or after `today`),
// else its most recent one. -> { item, week, plan, date } | null
export function nextPlannedFor(exerciseId, plans, today, schedule = []) {
  let next = null;
  let prev = null;
  for (const o of occurrences(plans, schedule)) {
    if (o.skipped) continue;
    for (const block of o.session.blocks ?? []) {
      for (const item of block.items ?? []) {
        if (item.exerciseId !== exerciseId) continue;
        const hit = { item, week: o.week, plan: o.plan, date: o.date };
        if (o.date >= today) { if (!next || o.date < next.date) next = hit; } else if (!prev || o.date > prev.date) prev = hit;
      }
    }
  }
  return next ?? prev;
}

// ---------- changes (each returns the full new schedule list; one save) ----------

const upsert = (list, rec) => [...list.filter((r) => r.id !== rec.id), rec];

// Slide the plan: this session and every later, not-yet-done session of its
// plan move by the same N days, so spacing is kept and the plan's end
// extends. `isDone(occurrence)` says which ones are finished already.
export function slidePlan({ plan, fromDate, days, schedule, isDone = () => false }) {
  let next = schedule;
  for (const o of occurrences([plan], schedule, { activeOnly: false })) {
    if (o.repeat || o.skipped || o.date < fromDate || isDone(o)) continue;
    next = upsert(next, { id: o.key, kind: 'move', planId: plan.id, sessionId: o.session.id, date: addDays(o.date, days) });
  }
  return next;
}

export function skipSession({ plan, session, schedule }) {
  const key = sessionKey(plan.id, session.id);
  return upsert(schedule, { id: key, kind: 'skip', planId: plan.id, sessionId: session.id, date: effectiveSessionDate(plan, session, schedule) });
}

// Repeat a plan week: every session of later weeks slides 7 days, and this
// week's sessions run again in the week that frees up (same weekdays, so
// spacing is kept). The plan isn't changed; a repeat is its own occurrence.
export function repeatWeek({ plan, weekIndex, schedule, isDone = () => false }) {
  const all = occurrences([plan], schedule, { activeOnly: false }).filter((o) => !o.repeat);
  const thisWeek = all.filter((o) => o.week.index === weekIndex && !o.skipped);
  const later = all.filter((o) => o.week.index > weekIndex);
  if (!thisWeek.length) return schedule;
  let next = schedule;
  const firstLater = later.filter((o) => !o.skipped && !isDone(o)).map((o) => o.date).sort()[0];
  if (firstLater) next = slidePlan({ plan, fromDate: firstLater, days: 7, schedule: next, isDone });
  for (const o of thisWeek) {
    const date = addDays(o.date, 7);
    next = upsert(next, { id: `repeat:${plan.id}:${o.session.id}:${date}`, kind: 'repeat', planId: plan.id, sessionId: o.session.id, date });
  }
  return next;
}

export const daysBetween = (a, b) => diffDays(a, b);
