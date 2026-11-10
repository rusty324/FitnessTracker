// How a progression suggestion (js/progression.js) is shown: the chip on
// Today and the "Next time" card on the exercise page.

import { formatWeight, weightUnit } from '../units.js';
import { el } from './components.js';
import { suggestNext, sessionsOf } from '../progression.js';
import { targetSummary } from './plans-tab.js';
import { painHoldFor } from '../pain.js';

// Kinds that change what you'd do: their values replace the ghosts.
export const CHANGES_GHOSTS = ['add', 'drop', 'return', 'advance', 'regress'];

// Pounds already round to 0.1 in formatWeight; kilograms may carry the
// extra precision a pound entry was stored with (18.144), so round them too.
const w = (kg) => formatWeight(weightUnit() === 'lb' ? kg : Math.round(kg * 10) / 10);
const nameOf = (ex, lvl) => ex?.variants?.find((v) => v.level === lvl)?.name ?? `level ${lvl}`;

export function suggestionTitle(s, ex) {
  switch (s.kind) {
    case 'add': return `Try ${w(s.weightKg)}`;
    case 'drop': return `Drop to ${w(s.weightKg)}`;
    case 'return': return `Ease back in: ${w(s.weightKg)}`;
    case 'advance': return `Move up: ${nameOf(ex, s.variantLevel)}`;
    case 'regress': return `Step back: ${nameOf(ex, s.variantLevel)}`;
    case 'variant_gap': return `Stay at ${nameOf(ex, s.variantLevel)}`;
    case 'deload': return 'Deload week';
    default: return s.weightKg != null ? `Hold at ${w(s.weightKg)}` : `Hold at ${nameOf(ex, s.variantLevel)}`;
  }
}
export const arrowOf = (s) => (['add', 'advance'].includes(s.kind) ? '↑' : ['drop', 'return', 'regress'].includes(s.kind) ? '↓' : '=');

// "Plan: 3 × 10 · L3 · Suggested: level 4, 3 × 10" — only when they differ.
export function planVsSuggested(target, s, ex) {
  if (!target?.kind) return null;
  const levelDiffers = s.variantLevel != null && target.variantLevel != null && s.variantLevel !== target.variantLevel;
  const weightDiffers = s.weightKg != null && target.weight != null && Math.abs(s.weightKg - target.weight) > 0.01;
  if (!levelDiffers && !weightDiffers) return null;
  const sets = target.sets ?? 1;
  const reps = s.repsMin != null ? (s.repsMax != null && s.repsMax !== s.repsMin ? `${s.repsMin}–${s.repsMax}` : s.repsMin) : '?';
  const what = levelDiffers ? `level ${s.variantLevel} (${nameOf(ex, s.variantLevel)}), ${sets} × ${reps}` : `${sets} × ${reps} @ ${w(s.weightKg)}`;
  return `Plan: ${targetSummary(target)} · Suggested: ${what}`;
}

export function suggestionChip(s, ex, { target = null, onDismiss = null } = {}) {
  const dir = arrowOf(s);
  const plan = planVsSuggested(target, s, ex);
  return el('div', { class: `sug-chip ${dir === '↑' ? 'up' : dir === '↓' ? 'down' : 'same'}`, dataset: { kind: s.kind } },
    el('span', { class: 'sug-arrow', 'aria-hidden': 'true' }, dir),
    el('div', { class: 'sug-body' },
      el('div', { class: 'sug-title' }, suggestionTitle(s, ex)),
      el('div', { class: 'sug-reason' }, s.reason),
      plan && el('div', { class: 'sug-plan' }, plan)),
    onDismiss && el('button', {
      class: 'sug-x', type: 'button', 'aria-label': 'Dismiss suggestion',
      onclick: (e) => { e.stopPropagation(); onDismiss(); },
    }, '✕'),
  );
}

// The suggestion for an exercise from store data. logs: everything before
// the day it's for.
// records: data/sessions.json, for the pain hold.
export function suggestionFor({ exercise, target, weekIsDeload = false, logs, plans, today, records = [] }) {
  if (!exercise) return null;
  return suggestNext({
    painHold: painHoldFor(exercise.id, records, plans),
    exercise,
    plannedTarget: target,
    history: sessionsOf(exercise.id, logs, plans),
    weekIsDeload,
    today,
    units: weightUnit() === 'lb' ? 'imperial' : 'metric',
  });
}
