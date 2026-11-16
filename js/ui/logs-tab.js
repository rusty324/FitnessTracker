// Logs tab: Today (log against the active plan), History (synced activities
// with match suggestions, plus GPX/TCX import), Metrics (weight/pace charts
// + adherence), Review, Heatmap.
//
// This file is the tab itself: mount, the sub-tab switch, and helpers every
// view shares. Each view lives in js/ui/logs/ (today, history, metrics,
// review); the tab's mutable state is one object, S, in js/ui/logs/state.js,
// so the views can share it.

import { isDesktop } from './layout.js';
import { restEndsAt, skipRest } from '../rest-timer.js';
import * as store from '../storage/store.js';
import { findSuggestions } from '../matcher.js';
import { makeMatch, matchActivityId } from '../models.js';
import { el } from './components.js';
import { renderToday } from './logs/today.js';
import { renderHistory } from './logs/history.js';
import { renderReview } from './logs/review.js';
import { renderMetrics } from './logs/metrics.js';
import { formatSets, formatTimedSets, isTimedActual } from '../sets.js';
import { formatDistance, formatPace } from '../units.js';
import { formatDuration } from '../dates.js';
import { S } from './logs/state.js';
 // the planned item open on Today (set rows shown)
// Suggestions dismissed with ✕ (by planned item id) — this page view only;
// a rejection is never stored.
export const dismissedSug = new Set();

// Desktop keyboard shortcuts on Today: Enter ticks a set (the one you're
// typing in, else the next unticked one of the open exercise); R skips the
// rest timer. Never while a dialog is open, and Enter in any other field
// (the weigh-in, say) is left alone.
function onShortcut(e) {
  if (!S.root?.isConnected || S.sub !== 'today' || !isDesktop()) return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
  if (document.querySelector('.modal-backdrop, .lightbox')) return;
  const typing = !!e.target?.matches?.('input, textarea, select');
  if (e.key === 'Enter') {
    // Typing in a set: tick that set. Focus on another control (a link, the
    // Finish button): leave Enter to it — except inside the set rows, where
    // a just-clicked ✓ still has focus and Enter would untick it.
    const inRows = !!e.target?.closest?.('.ex-card.is-open .set-rows');
    const onControl = !typing && !!e.target?.matches?.('button, a, summary') && !inRows;
    if (onControl) return;
    const row = typing && inRows
      ? e.target.closest('.set-row')
      : !typing && document.querySelector('.ex-card.is-open .set-row:not(.set-head):not(.is-done)');
    if (!row) return;
    e.preventDefault();
    row.querySelector('.set-check')?.click();
  } else if ((e.key === 'r' || e.key === 'R') && !typing && restEndsAt()) {
    e.preventDefault();
    skipRest();
  }
}

export function mount(elRoot, appCtx) {
  if (!S.shortcutsOn) { document.addEventListener('keydown', onShortcut); S.shortcutsOn = true; }
  S.root = elRoot;
  S.ctx = appCtx;
  S.unsub = store.onChange((e) => {
    if (e.type === 'changed') render();
  });
  runMatcher();
  render();
}

export function unmount() {
  S.unsub?.();
  destroyHeatmap();
  S.root = null;
}

// Idempotent: render() runs on every store change, and destroying a Leaflet
// map twice throws ("Map container is being reused"), which used to abort
// whatever write triggered the re-render.
function destroyHeatmap() {
  const mod = S.heatmapMod;
  S.heatmapMod = null;
  mod?.destroy?.();
}

// Persist fresh suggestions so they survive reloads and are never recomputed
// once the user confirms/rejects them.
export function runMatcher() {
  const activities = store.getActivityEntries();
  if (!activities.length) return;
  const matches = store.get('matches');
  const fresh = findSuggestions(activities, store.get('plans'), matches, store.get('exercises'), undefined, store.get('schedule'));
  if (fresh.length) {
    const records = matches.concat(fresh.map((f) => makeMatch({ ...f, status: 'suggested' })));
    store.save('matches', records);
  }
}

export function render() {
  if (!S.root) return;
  destroyHeatmap();
  S.root.innerHTML = '';
  const segs = [
    ['today', 'Today'],
    ['history', 'History'],
    ['metrics', 'Metrics'],
    ['review', 'Review'],
  ];
  // Heatmap used to be a fourth sub-tab; it now lives at the bottom of
  // Metrics, so an old remembered 'heatmap' lands there.
  if (S.sub === 'heatmap') S.sub = 'metrics';
  // Desktop: Today and Metrics use the full 1200px width in two columns;
  // the other views keep the narrower reading column.
  S.root.classList.toggle('wide', isDesktop() && (S.sub === 'today' || S.sub === 'metrics' || S.sub === 'review'));
  S.ctx?.setTitle?.(segs.find(([id]) => id === S.sub)?.[1] ?? 'Logs');
  S.root.appendChild(el('div', { class: 'segmented' },
    segs.map(([id, label]) =>
      el('button', { class: S.sub === id ? 'active' : '', onclick: () => { S.sub = id; render(); } }, label)),
  ));
  if (store.encryption().locked) {
    S.root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'list-row', style: 'border:none;padding:0' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, '🔒 Some synced data is encrypted'),
          el('div', { class: 'row-sub' }, 'Enter your password in Settings to unlock it on this device.'),
        ),
        el('button', { class: 'btn small', onclick: () => S.ctx?.openSettings?.() }, 'Unlock'),
      ),
    ));
  }
  if (S.sub === 'today') renderToday();
  else if (S.sub === 'history') renderHistory();
  else if (S.sub === 'review') renderReview();
  else renderMetrics();
}

// ---------- helpers ----------

export function exById() {
  return new Map(store.get('exercises').map((e) => [e.id, e]));
}

export function activePlans() {
  return store.get('plans').filter((p) => p.status === 'active');
}

// Synced activities decorated with their computed matchStatus (overlay merge).
export function activitiesWithStatus() {
  const matches = new Map(store.get('matches').map((m) => [matchActivityId(m), m]));
  return store.getActivityEntries().map((entry) => {
    const m = matches.get(entry.id);
    return {
      ...entry,
      matchStatus: m?.status ?? 'unmatched',
      match: m ?? null,
    };
  });
}

export function actualSummary(actual) {
  if (!actual) return '';
  const parts = [];
  const sets = formatSets(actual); // includes the weight(s)
  if (sets) parts.push(sets);
  // Timed sets: "2 × 20s", "3 × 5 × 10s" (an old single duration reads too).
  const timed = isTimedActual(actual) ? formatTimedSets(actual) : '';
  if (timed) parts.push(timed);
  if (actual.distanceM) parts.push(formatDistance(actual.distanceM));
  if (actual.movingSec) parts.push(formatDuration(actual.movingSec));
  if (actual.distanceM && actual.movingSec) parts.push(formatPace(actual.distanceM, actual.movingSec));
  if (actual.durationSec && !timed) parts.push(formatDuration(actual.durationSec));
  if (actual.avgHr) parts.push(`${Math.round(actual.avgHr)} bpm`);
  return parts.join(' · ');
}
