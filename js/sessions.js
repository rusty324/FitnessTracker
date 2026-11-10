// When a planned session counts as completed — the one definition used by
// Today, the weekly dots, the review, and overdue detection:
//   - you tapped "Finish session" (a data/sessions.json record of kind
//     'full' or 'minimum' for that date and session), or
//   - every non-optional exercise in it has a linked log or a confirmed
//     synced activity — the same per-exercise test adherence has always used.
// Pure.

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
