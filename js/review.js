// The weekly review: what happened, and one thing to do about it. Pure —
// everything is derived from stored facts at read time; nothing is saved.
//
// weeklyReview() -> { week, sessions, prs, volume, cardio, weight,
//                     suggestionsReady, recommendation }

import { PR_MIN_REPS, MUSCLE_GROUPS, CARDIO_SPORTS } from './config.js';
import { addDays } from './dates.js';
import { setsOf } from './history.js';
import { variantLevelFor, plannedTargetOf } from './load.js';
import { cardioItems, isCardioExercise } from './cardio.js';
import { muscleGroupsOf } from './exercise-filters.js';
import { suggestNext, sessionsOf, rangeOf } from './progression.js';
import { sessionStatus, doneItemIds } from './sessions.js';
import { plannedBetween, nextPlannedFor } from './schedule.js';
import { trendSeries, trendSlope, rateLabel, weightPoints } from './trend.js';
import { effectivePain, painHoldFor } from './pain.js';

const DOW = { sun: 0, mon: 1 };

// The first day of the week containing `date`, weeks starting on `startDay`.
export function weekStartOf(date, startDay = 'mon') {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const back = (dow - (DOW[startDay] ?? 1) + 7) % 7;
  return addDays(date, -back);
}

// Planned vs completed sessions in [start, end] (the one completed rule,
// js/sessions.js), split by how they were finished.
export function sessionCounts({ start, end, plans, logs, matches, records, schedule = [] }) {
  const doneIds = doneItemIds(logs, matches);
  const planned = plannedBetween(plans, start, end, schedule);
  let completed = 0;
  let full = 0;
  let minimum = 0;
  const each = planned.map(({ session, date, plan, week, repeat }) => {
    const st = sessionStatus({ session, date, records, doneIds, repeat, logs });
    if (st.completed) {
      completed++;
      if (st.kind === 'minimum') minimum++;
      else full++;
    }
    return { date, plan, week, session, ...st };
  });
  return { planned: planned.length, completed, full, minimum, each };
}

// ---------- personal bests (each only versus history before the week) ----------

const kgKey = (kg) => (kg == null ? 'none' : Math.round(kg * 100) / 100);

function strengthPRs({ start, end, logs, exercises, plans }) {
  const inWeek = (l) => l.date >= start && l.date <= end;
  const before = (l) => l.date < start;
  const out = [];
  for (const ex of exercises) {
    if (isCardioExercise(ex)) continue;
    const mine = logs.filter((l) => l.exerciseId === ex.id && setsOf(l).length && setsOf(l)[0].reps != null);
    const now = mine.filter(inWeek);
    const prior = mine.filter(before);
    if (!now.length || !prior.length) continue; // a first time isn't a "best"
    const flat = (ls) => ls.flatMap((l) => setsOf(l).map((s) => ({ ...s, level: variantLevelFor(l, plans), lo: rangeOf(plannedTargetOf(l, plans))?.[0] ?? 1 })));
    const N = flat(now);
    const P = flat(prior);
    const nameOf = (lvl) => ex.variants?.find((v) => v.level === lvl)?.name ?? `level ${lvl}`;

    // Weight: heaviest for PR_MIN_REPS+ reps.
    const heavy = (S) => Math.max(-1, ...S.filter((s) => s.weightKg > 0 && s.reps >= PR_MIN_REPS).map((s) => s.weightKg));
    if (heavy(N) > 0 && heavy(P) > 0 && heavy(N) > heavy(P)) {
      out.push({ kind: 'weight', exercise: ex, value: heavy(N), was: heavy(P), minReps: PR_MIN_REPS });
      continue;
    }
    // Variant: the highest level done at the target's low rep count.
    const top = (S) => Math.max(-1, ...S.filter((s) => s.level != null && s.reps >= s.lo).map((s) => s.level));
    if (ex.variants?.length && top(N) > 0 && top(P) > 0 && top(N) > top(P)) {
      out.push({ kind: 'variant', exercise: ex, value: top(N), was: top(P), valueName: nameOf(top(N)), wasName: nameOf(top(P)) });
      continue;
    }
    // Reps: most reps at the same weight and variant.
    let best = null;
    for (const s of N) {
      const same = P.filter((p) => kgKey(p.weightKg) === kgKey(s.weightKg) && p.level === s.level);
      if (!same.length) continue;
      const was = Math.max(...same.map((p) => p.reps));
      if (s.reps > was && (!best || s.reps - was > best.value - best.was)) {
        best = { kind: 'reps', exercise: ex, value: s.reps, was, weightKg: s.weightKg, level: s.level, levelName: s.level != null ? nameOf(s.level) : null };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

function cardioPRs({ start, end, items }) {
  const out = [];
  const label = (sport) => CARDIO_SPORTS.find((s) => s.id === sport)?.label ?? 'Cardio';
  for (const sport of new Set(items.map((i) => i.sport).filter(Boolean))) {
    const mine = items.filter((i) => i.sport === sport);
    const now = mine.filter((i) => i.date >= start && i.date <= end);
    const prior = mine.filter((i) => i.date < start);
    const time = (i) => i.movingSec ?? i.durationSec ?? 0;
    for (const [get, kind] of [[(i) => i.distanceM ?? 0, 'distance'], [time, 'duration']]) {
      const nv = Math.max(0, ...now.map(get));
      const p = Math.max(0, ...prior.map(get));
      if (nv > 0 && p > 0 && nv > p) out.push({ kind, sport, sportLabel: label(sport), value: nv, was: p });
    }
  }
  return out;
}

// ---------- the review ----------

/**
 * @param {object} o
 * @param {string} o.weekStart  YYYY-MM-DD (first day of the week)
 * @param {string} o.today
 * @param {'metric'|'imperial'} [o.units]
 */
export function weeklyReview({
  weekStart, today, plans = [], logs = [], activities = [], metrics = [], goals = [],
  sessionsRecords = [], matches = [], exercises = [], units = 'metric', schedule = [],
}) {
  const start = weekStart;
  const end = addDays(weekStart, 6);
  const asOf = end < today ? end : today;
  const counts = (s, e) => sessionCounts({ start: s, end: e, plans, logs, matches, records: sessionsRecords, schedule });

  const sessions = counts(start, end);
  const prev = counts(addDays(start, -7), addDays(start, -1));

  // Personal bests.
  const items = cardioItems({ logs, activities, exercises, matches });
  const prs = [...strengthPRs({ start, end, logs, exercises, plans }), ...cardioPRs({ start, end, items })];

  // Hard sets per muscle group (display only), vs the week before.
  const lib = new Map(exercises.map((e) => [e.id, e]));
  const setsByGroup = (s, e) => {
    const m = new Map();
    for (const l of logs) {
      if (l.date < s || l.date > e) continue;
      const ex = lib.get(l.exerciseId);
      if (!ex || isCardioExercise(ex)) continue;
      const n = setsOf(l).filter((x) => x.reps != null).length;
      if (!n) continue;
      for (const g of muscleGroupsOf(ex)) m.set(g, (m.get(g) ?? 0) + n);
    }
    return m;
  };
  const nowSets = setsByGroup(start, end);
  const prevSets = setsByGroup(addDays(start, -7), addDays(start, -1));
  const volume = MUSCLE_GROUPS
    .map((g) => ({ group: g.id, label: g.label, sets: nowSets.get(g.id) ?? 0, prev: prevSets.get(g.id) ?? 0 }))
    .filter((v) => v.sets || v.prev)
    .map((v) => ({ ...v, delta: v.sets - v.prev }))
    .sort((a, b) => b.sets - a.sets);

  // Cardio this week.
  const weekItems = items.filter((i) => i.date >= start && i.date <= end);
  const cardio = {
    sessions: weekItems.length,
    distanceM: weekItems.reduce((a, i) => a + (i.distanceM ?? 0), 0),
    movingSec: weekItems.reduce((a, i) => a + (i.movingSec ?? i.durationSec ?? 0), 0),
  };

  // Weight: trend at the start and end of the week, and the 28-day rate.
  const pts = weightPoints(metrics);
  const series = trendSeries(pts);
  const at = (d) => [...series].reverse().find((p) => p.date <= d)?.trendKg ?? null;
  const startKg = at(addDays(start, -1)) ?? series.find((p) => p.date >= start && p.date <= asOf)?.trendKg ?? null;
  const endKg = at(asOf);
  const rate = trendSlope(pts, { windowDays: 28, asOf });
  const label = rate && endKg ? rateLabel(rate, endKg) : null;
  const weight = startKg != null && endKg != null
    ? { startKg, endKg, deltaKg: endKg - startKg, rate, fast: !!label?.fast, flat: !!label?.flat }
    : null;

  // Exercises whose next planned session is ready to progress.
  const suggestionsReady = [];
  for (const ex of exercises) {
    const planned = nextPlannedFor(ex.id, plans, today, schedule);
    if (!planned) continue;
    const s = suggestNext({
      exercise: ex, plannedTarget: planned.item.target, history: sessionsOf(ex.id, logs, plans),
      weekIsDeload: !!planned.week?.isDeload, today, units, painHold: painHoldFor(ex.id, sessionsRecords, plans),
    });
    if (s && (s.kind === 'add' || s.kind === 'advance')) suggestionsReady.push(ex.name);
  }

  // Exactly one recommendation; the first rule that matches wins.
  // Pain after escalation (two same-region niggles in a row count as pain).
  const painThisWeek = sessionsRecords.some((r) => r.date >= start && r.date <= end && effectivePain(r, sessionsRecords) === 'pain');
  const injuryRule = plans.find((p) => p.status === 'active' && p.progressionPolicy?.injuryRule)?.progressionPolicy.injuryRule;
  const light = (c) => c.planned > 0 && c.completed / c.planned <= 0.5;
  const four = counts(addDays(start, -21), end);
  const flatFourWeeks = !!weight?.flat && four.planned > 0 && four.completed / four.planned >= 0.8;
  let recommendation;
  if (painThisWeek) {
    recommendation = { id: 'pain', severity: 'attention', text: injuryRule ?? 'Pain was flagged this week.' };
  } else if (light(sessions) && light(prev)) {
    const n = Math.max(1, Math.round((sessions.completed + prev.completed) / 2));
    recommendation = { id: 'light-weeks', severity: 'attention',
      text: `Two light weeks. Use the minimum session on busy days, or reduce to ${n} session${n === 1 ? '' : 's'} per week.` };
  } else if (weight?.fast) {
    recommendation = { id: 'fast', severity: 'attention', text: 'Trend is dropping faster than about 1%/week. Make sure it is sustainable.' };
  } else if (flatFourWeeks) {
    recommendation = { id: 'flat', severity: 'info',
      text: 'Trend is flat despite consistent training. Exercise alone rarely moves weight; intake is the likely lever.' };
  } else if (suggestionsReady.length) {
    recommendation = { id: 'progress', severity: 'info', text: `Ready to progress: ${suggestionsReady.join(', ')}.` };
  } else {
    recommendation = { id: 'none', severity: 'info', text: 'Nothing to change. Keep going.' };
  }

  return {
    week: { start, end, asOf, complete: end < today },
    sessions,
    prs,
    volume,
    cardio,
    weight,
    suggestionsReady,
    recommendation,
  };
}
