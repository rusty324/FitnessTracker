// Pain flags (data/sessions.json, encrypted: health data) and what follows
// from them. Pure.
//
// After a session you may answer None / Niggle / Pain, with where. The rules
// are the plan's own progressionPolicy.injuryRule, shown verbatim — the app
// never paraphrases medical guidance:
//   - a niggle in the same region in two consecutive sessions counts as pain;
//   - pain on a session with a run, in a shin, knee, hip or ankle: the
//     injury rule, and an offer to repeat the week;
//   - pain in two consecutive weeks: the rule's stop-and-see-someone line
//     instead of the repeat offer;
//   - any pain holds that session's exercises' next progression suggestion.

import { addDays } from './dates.js';

export const PAIN_REGIONS = [
  ['shin', 'Shin'], ['knee', 'Knee'], ['hip', 'Hip'], ['ankle', 'Ankle'],
  ['other', 'Other'], ['lower_back', 'Lower back'], ['shoulder', 'Shoulder'],
];
export const RUN_REGIONS = ['shin', 'knee', 'hip', 'ankle'];
export const CLINICIAN_LINE = 'Sharp pain, swelling, or anything lasting more than a week: see a clinician.';

const finished = (r) => r.kind === 'full' || r.kind === 'minimum';
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1));

// The level a session's flag counts as, after escalation: a niggle that
// shares a region with a niggle (or pain) on the previous finished session
// is pain. -> 'none' | 'niggle' | 'pain' | null (not answered)
export function effectivePain(record, records) {
  const p = record?.pain;
  if (!p) return null;
  if (p.level !== 'niggle') return p.level;
  const prev = records.filter((r) => finished(r) && byDate(r, record) < 0).sort(byDate).at(-1);
  const shared = (prev?.pain?.regions ?? []).some((x) => (p.regions ?? []).includes(x));
  return shared && (prev.pain.level === 'niggle' || prev.pain.level === 'pain') ? 'pain' : 'niggle';
}

// Pain (after escalation) in the calendar week of `date` AND the week before.
export function painTwoWeeksRunning(records, date, weekStart) {
  const start = weekStart(date);
  const prevStart = addDays(start, -7);
  const painIn = (s) => records.some((r) => r.date >= s && r.date <= addDays(s, 6) && effectivePain(r, records) === 'pain');
  return painIn(start) && painIn(prevStart);
}

// Does a session include a run? (The injury rule is about running.)
export function hasRun(session, exById) {
  return (session.blocks ?? []).some((b) => (b.items ?? []).some((it) => {
    const ex = exById.get(it.exerciseId);
    return ex?.modality === 'run' || /\brun\b/i.test(ex?.name ?? '');
  }));
}

// The sentence of the injury rule about stopping (verbatim), else the rule.
export function stopLine(injuryRule) {
  if (!injuryRule) return null;
  const sentences = injuryRule.match(/[^.!?]+[.!?]+/g) ?? [injuryRule];
  return sentences.find((s) => /consecutive weeks|see a (physician|clinician|doctor)/i.test(s))?.trim() ?? injuryRule;
}

// Phase B: hold an exercise's suggestion when the last finished session
// containing it was flagged pain (after escalation).
export function painHoldFor(exerciseId, records, plans) {
  const sessionsWith = new Set();
  for (const plan of plans) {
    for (const w of plan.weeks ?? []) {
      for (const s of w.sessions ?? []) {
        if ((s.blocks ?? []).some((b) => (b.items ?? []).some((it) => it.exerciseId === exerciseId))) sessionsWith.add(s.id);
      }
    }
  }
  const last = records.filter((r) => finished(r) && sessionsWith.has(r.plannedSessionId)).sort(byDate).at(-1);
  return !!last && effectivePain(last, records) === 'pain';
}
