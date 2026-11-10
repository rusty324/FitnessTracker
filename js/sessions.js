// When a planned session counts as completed — the one definition used by
// Today, the weekly dots, the review, and overdue detection:
//   - you tapped "Finish session" (a data/sessions.json record of kind
//     'full' or 'minimum' for that date and session), or
//   - every non-optional exercise in it has a linked log or a confirmed
//     synced activity — the same per-exercise test adherence has always used.
// Pure.

import { addDays } from './dates.js';
import { allSessions, sessionItems } from './models.js';

export const sessionRecordId = (date, plannedSessionId) => `${date}:${plannedSessionId ?? 'adhoc'}`;

// Planned item ids that have a linked log or a confirmed activity match.
export function doneItemIds(logs = [], matches = []) {
  const done = new Set();
  for (const l of logs) if (l.plannedExerciseId) done.add(l.plannedExerciseId);
  for (const m of matches) if (m.status === 'confirmed' && m.plannedExerciseId) done.add(m.plannedExerciseId);
  return done;
}

// -> { completed, kind: 'full' | 'minimum' | null, done, planned }
export function sessionStatus({ session, date, records = [], doneIds }) {
  const rec = records.find((r) => r.id === sessionRecordId(date, session.id));
  const items = (session.blocks ?? []).flatMap((b) => b.items ?? []).filter((it) => !it.optional);
  const done = items.filter((it) => doneIds.has(it.id)).length;
  const finished = rec?.kind === 'full' || rec?.kind === 'minimum';
  return {
    completed: finished || (items.length > 0 && done === items.length),
    kind: finished ? rec.kind : null,
    done,
    planned: items.length,
  };
}

// ---------- the schedule ----------


// A planned session's calendar date: its plan's start + dayOffset.
export const sessionDate = (plan, dayOffset) => addDays(plan.startDate, dayOffset);

// Every planned session of the active plans dated within [from, to].
// -> [{ plan, week, session, date }]
export function plannedBetween(plans, from, to) {
  const out = [];
  for (const plan of plans.filter((p) => p.status === 'active')) {
    for (const { session, week, dayOffset } of allSessions(plan)) {
      const date = sessionDate(plan, dayOffset);
      if (date >= from && date <= to) out.push({ plan, week, session, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The plan item an exercise is next prescribed in (on or after `today`, in
// an active plan), else its most recent one. -> { item, week, plan, date } | null
export function nextPlannedFor(exerciseId, plans, today) {
  let next = null;
  let prev = null;
  for (const plan of plans.filter((p) => p.status === 'active')) {
    for (const { session, week, dayOffset } of allSessions(plan)) {
      const date = sessionDate(plan, dayOffset);
      for (const { item } of sessionItems(session)) {
        if (item.exerciseId !== exerciseId) continue;
        const hit = { item, week, plan, date };
        if (date >= today) { if (!next || date < next.date) next = hit; } else if (!prev || date > prev.date) prev = hit;
      }
    }
  }
  return next ?? prev;
}
