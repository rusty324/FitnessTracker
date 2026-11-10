// When a planned session counts as completed — the one definition used by
// Today, the weekly dots, the review, and overdue detection:
//   - you tapped "Finish session" (a data/sessions.json record of kind
//     'full' or 'minimum' for that date and session), or
//   - at least one exercise in it has a linked log or a confirmed synced
//     activity. Deliberately lenient: before Finish existed, sessions were
//     logged piecemeal (stretches often not at all), and a strict "every
//     exercise" rule flagged sessions you did as still open — where Slide
//     plan would then have pushed the whole plan back.
// Pure.

export const sessionRecordId = (date, plannedSessionId) => `${date}:${plannedSessionId ?? 'adhoc'}`;

// Planned item ids that have a linked log or a confirmed activity match.
export function doneItemIds(logs = [], matches = []) {
  const done = new Set();
  for (const l of logs) if (l.plannedExerciseId) done.add(l.plannedExerciseId);
  for (const m of matches) if (m.status === 'confirmed' && m.plannedExerciseId) done.add(m.plannedExerciseId);
  return done;
}

// A repeat occurrence (js/schedule.js) shares the session's plan items, so
// it counts only what happened on its own date: logs dated that day, and a
// Finish record for that date. A normal occurrence takes any Finish record
// for the session (it may be finished on another day than planned).
// -> { completed, kind: 'full' | 'minimum' | null, done, planned }
export function sessionStatus({ session, date, records = [], doneIds, repeat = false, logs = [] }) {
  const finished = (r) => r.kind === 'full' || r.kind === 'minimum';
  const rec = repeat
    ? records.find((r) => r.id === sessionRecordId(date, session.id) && finished(r))
    : records.find((r) => r.plannedSessionId === session.id && !r.repeat && finished(r))
      ?? records.find((r) => r.id === sessionRecordId(date, session.id) && !r.repeat);
  if (repeat) doneIds = doneItemIds(logs.filter((l) => l.date === date), []); // a synced run links to the original, not the repeat
  const all = (session.blocks ?? []).flatMap((b) => b.items ?? []);
  const items = all.filter((it) => !it.optional);
  const done = items.filter((it) => doneIds.has(it.id)).length;
  const anyLogged = all.some((it) => doneIds.has(it.id));
  const isFinished = !!rec && finished(rec);
  return {
    completed: isFinished || anyLogged,
    kind: isFinished ? rec.kind : null,
    done,
    planned: items.length,
  };
}
