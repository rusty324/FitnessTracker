// Fuzzy matcher: pairs unhandled synced activities with planned block items.
// Pure functions — no DOM, no storage — so it's trivially unit-testable.
// Runs client-side on Logs load, so it stays correct when plans are edited
// after a sync has already happened.

import { sportMapping, MATCH_WINDOW_DAYS } from './config.js';
import { addDays, diffDays } from './dates.js';
import { allSessions, sessionItems } from './models.js';

// Returns [{activityId, planId, sessionId, plannedExerciseId, score}] of NEW
// suggestions — activities that already have a match record (suggested/
// confirmed/rejected) are skipped, so user decisions are terminal.
export function findSuggestions(activityEntries, plans, matches, exercises, windowDays = MATCH_WINDOW_DAYS) {
  const handled = new Set(matches.map((m) => m.activityId));
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const out = [];
  for (const entry of activityEntries) {
    if (handled.has(entry.id)) continue;
    const candidates = findCandidates(entry, plans, exById, windowDays);
    const best = pickWinner(candidates);
    if (best) {
      out.push({
        activityId: entry.id,
        planId: best.planId,
        sessionId: best.sessionId,
        plannedExerciseId: best.plannedExerciseId,
        score: best.score,
      });
    }
  }
  return out;
}

// Does an exercise plausibly correspond to a synced activity's sport type?
// Prefer the finer-grained modality; fall back to category.
function activityMatches(ex, mapping) {
  if (mapping.modality) {
    return ex.modality === mapping.modality || (!ex.modality && ex.category === mapping.category);
  }
  return ex.category === mapping.category;
}

// All plausible planned block items for one activity (used both by the
// auto-matcher and by the manual "link to plan" picker).
export function findCandidates(entry, plans, exById, windowDays = MATCH_WINDOW_DAYS) {
  const mapping = sportMapping(entry.type);
  const candidates = [];
  for (const plan of plans) {
    if (plan.status !== 'active') continue;
    for (const { week, session, dayOffset } of allSessions(plan)) {
      const sessionDate = addDays(plan.startDate, dayOffset);
      const dayDiff = Math.abs(diffDays(sessionDate, entry.date));
      if (dayDiff > windowDays) continue;
      for (const { item } of sessionItems(session)) {
        const ex = exById.get(item.exerciseId);
        if (!ex || !activityMatches(ex, mapping)) continue;
        candidates.push({
          planId: plan.id,
          sessionId: session.id,
          plannedExerciseId: item.id,
          plan,
          week,
          session,
          plannedExercise: item,
          exercise: ex,
          score: score(entry, item, dayDiff),
        });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

// Date proximity dominates; distance/duration similarity break ties.
function score(entry, item, dayDiff) {
  let s = 1 / (1 + dayDiff);
  const t = item.target ?? {};
  if (entry.distanceM && t.distanceM) s += ratioSim(entry.distanceM, t.distanceM);
  if (entry.movingSec && t.durationSec) s += ratioSim(entry.movingSec, t.durationSec);
  if (entry.movingSec && t.totalSec) s += ratioSim(entry.movingSec, t.totalSec);
  return s;
}

function ratioSim(a, b) {
  return Math.min(a, b) / Math.max(a, b); // 1 = identical, → 0 as they diverge
}

// A single candidate wins outright; with several, only a clear winner
// (≥2× the runner-up's score) is auto-suggested. Otherwise the activity is
// left unmatched for manual linking.
function pickWinner(candidates) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  return candidates[0].score >= 2 * candidates[1].score ? candidates[0] : null;
}
