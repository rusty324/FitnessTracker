// Logs tab: Today (log against the active plan), History (synced activities
// with match suggestions, plus GPX/TCX import), Metrics (weight/pace charts
// + adherence), Heatmap.

import * as store from '../storage/store.js';
import { makeLogEntry, makeBodyMetric, makeMatch, matchActivityId, allSessions, sessionItems } from '../models.js';
import { findSuggestions, findCandidates } from '../matcher.js';
import { sportMapping, BODY_METRICS } from '../config.js';
import {
  todayStr, addDays, diffDays, formatDate, formatDateLong, formatDuration, parseDateStr,
} from '../dates.js';
import {
  formatWeight, formatDistance, formatPace, paceChartValue, paceUnit,
  weightUnit, weightToInput, weightFromInput,
  distanceUnit, distanceToInput, resolveMetric,
} from '../units.js';
import { lineChart, datePoints } from '../charts.js';
import { isCardioExercise, hasCardioData, sportOf, defaultGear } from '../cardio.js';
import { el, openModal, confirmDialog, toast, undoToast, emptyState, filePicker, exerciseLink } from './components.js';
import { cardioFields, cardioExtras } from './cardio-form.js';
import { formatSets, formatTimedSets, isTimedActual, holdText } from '../sets.js';
import { variantLevelFor } from '../load.js';
import { setRows, rowsFromActual } from './set-rows.js';
import { lastPerformance, setsOf, ghostSet } from '../history.js';
import { suggestionFor, suggestionChip, suggestionTitle, arrowOf, CHANGES_GHOSTS } from './suggestion.js';
import { draftKey, readDraft, updateDraftItem, removeDraftItem, flushItem, flushDraft, clearDraft, setDraftMode } from '../draft.js';
import { sessionRecordId, sessionStatus, doneItemIds } from '../sessions.js';
import { startRest, skipRest, restSecondsFor, restSettings, setSessionActive, restEndsAt } from '../rest-timer.js';
import { trendSeries, trendSlope, rateLabel, etaToGoal, weightPoints } from '../trend.js';
import { weeklyReview, weekStartOf, sessionCounts } from '../review.js';
import { occurrences, slidePlan, skipSession, repeatWeek } from '../schedule.js';
import { PAIN_REGIONS, RUN_REGIONS, CLINICIAN_LINE, effectivePain, painTwoWeeksRunning, hasRun, stopLine } from '../pain.js';
import { minimumSession, estimateMinutes } from '../minimum.js';
import { isDesktop } from './layout.js';
import { overdueCard } from './overdue.js';
import { pickExercise, targetSummary } from './plans-tab.js';

let root = null;
let ctx = null;
let unsub = null;
let sub = 'today'; // 'today' | 'history' | 'metrics' | 'heatmap'
let histFilter = { from: addDays(todayStr(), -30), to: todayStr(), planId: '' };
let adherenceDays = 30;
let weightWeeks = 12; // Metrics weight chart range: 4 | 12 | 0 (all)
let metricTab = 'weight'; // desktop Metrics: weight | waist | restingHr | pace
let reviewThisWeek = false; // Review: last completed week (default) or this week so far
let expandedItem = null; // the planned item open on Today (set rows shown)
// Suggestions dismissed with ✕ (by planned item id) — this page view only;
// a rejection is never stored.
const dismissedSug = new Set();
// The open exercise's last session, for Today's desktop side panel.
let openLast = null; // { name, perf } | null
let heatmapMod = null;

// Desktop keyboard shortcuts on Today: Enter ticks a set (the one you're
// typing in, else the next unticked one of the open exercise); R skips the
// rest timer. Never while a dialog is open, and Enter in any other field
// (the weigh-in, say) is left alone.
function onShortcut(e) {
  if (!root?.isConnected || sub !== 'today' || !isDesktop()) return;
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
let shortcutsOn = false;

export function mount(elRoot, appCtx) {
  if (!shortcutsOn) { document.addEventListener('keydown', onShortcut); shortcutsOn = true; }
  root = elRoot;
  ctx = appCtx;
  unsub = store.onChange((e) => {
    if (e.type === 'changed') render();
  });
  runMatcher();
  render();
}

export function unmount() {
  unsub?.();
  destroyHeatmap();
  root = null;
}

// Idempotent: render() runs on every store change, and destroying a Leaflet
// map twice throws ("Map container is being reused"), which used to abort
// whatever write triggered the re-render.
function destroyHeatmap() {
  const mod = heatmapMod;
  heatmapMod = null;
  mod?.destroy?.();
}

// Persist fresh suggestions so they survive reloads and are never recomputed
// once the user confirms/rejects them.
function runMatcher() {
  const activities = store.getActivityEntries();
  if (!activities.length) return;
  const matches = store.get('matches');
  const fresh = findSuggestions(activities, store.get('plans'), matches, store.get('exercises'), undefined, store.get('schedule'));
  if (fresh.length) {
    const records = matches.concat(fresh.map((f) => makeMatch({ ...f, status: 'suggested' })));
    store.save('matches', records);
  }
}

function render() {
  if (!root) return;
  destroyHeatmap();
  root.innerHTML = '';
  const segs = [
    ['today', 'Today'],
    ['history', 'History'],
    ['metrics', 'Metrics'],
    ['review', 'Review'],
  ];
  // Heatmap used to be a fourth sub-tab; it now lives at the bottom of
  // Metrics, so an old remembered 'heatmap' lands there.
  if (sub === 'heatmap') sub = 'metrics';
  // Desktop: Today and Metrics use the full 1200px width in two columns;
  // the other views keep the narrower reading column.
  root.classList.toggle('wide', isDesktop() && (sub === 'today' || sub === 'metrics' || sub === 'review'));
  ctx?.setTitle?.(segs.find(([id]) => id === sub)?.[1] ?? 'Logs');
  root.appendChild(el('div', { class: 'segmented' },
    segs.map(([id, label]) =>
      el('button', { class: sub === id ? 'active' : '', onclick: () => { sub = id; render(); } }, label)),
  ));
  if (store.encryption().locked) {
    root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'list-row', style: 'border:none;padding:0' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, '🔒 Some synced data is encrypted'),
          el('div', { class: 'row-sub' }, 'Enter your password in Settings to unlock it on this device.'),
        ),
        el('button', { class: 'btn small', onclick: () => ctx?.openSettings?.() }, 'Unlock'),
      ),
    ));
  }
  if (sub === 'today') renderToday();
  else if (sub === 'history') renderHistory();
  else if (sub === 'review') renderReview();
  else renderMetrics();
}

// ---------- helpers ----------

function exById() {
  return new Map(store.get('exercises').map((e) => [e.id, e]));
}

function activePlans() {
  return store.get('plans').filter((p) => p.status === 'active');
}

// Synced activities decorated with their computed matchStatus (overlay merge).
function activitiesWithStatus() {
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

// ---------- Today ----------

function renderToday() {
  const today = todayStr();
  const lib = exById();
  const logs = store.get('logs');
  const loggedByPe = new Map(
    logs.filter((l) => l.date === today && l.plannedExerciseId).map((l) => [l.plannedExerciseId, l]),
  );

  // Desktop: the session in a main column, and a side panel with the
  // weigh-in, last time, the weight trend and the week. The helpers below
  // append to `root`, so it points at the main column while they run.
  const desktop = isDesktop();
  const page = root;
  let aside = null;
  if (desktop) {
    const main = el('div', { class: 'col-main' });
    aside = el('aside', { class: 'col-side', 'aria-label': 'Today at a glance' });
    page.appendChild(el('div', { class: 'two-col' }, main, aside));
    root = main;
  }
  openLast = null;
  try {
    renderTodayMain(today, lib, logs, loggedByPe, desktop);
  } finally {
    root = page;
  }
  if (aside) renderTodayAside(aside, today);
}

function renderTodayMain(today, lib, logs, loggedByPe, desktop) {
  root.appendChild(el('h2', { class: desktop ? 'page-h1' : '' }, desktop ? 'Today' : formatDateLong(today)));
  if (desktop) root.appendChild(el('div', { class: 'row-sub', style: 'margin:-8px 2px 8px' }, formatDateLong(today)));
  const dots = weekDots(today);
  if (dots) root.appendChild(dots);
  const overdue = overdueCard(today, { onNotNow: () => render() });
  if (overdue) root.appendChild(overdue);
  const banner = reviewBanner(today);
  if (banner) root.appendChild(banner);
  if (!desktop) root.appendChild(weighInCard(today));

  let anyPlanned = false;
  const finishBars = [];
  const doneIds = doneItemIds(logs, store.get('matches'));
  const records = store.get('sessions');
  for (const { plan, session, week, date, skipped, repeat } of occurrences(store.get('plans'), store.get('schedule'))) {
    if (date !== today || skipped) continue;
    anyPlanned = true;
    const finish = renderSessionToday({ plan, session, week, today, lib, logs, loggedByPe, doneIds, records, repeat });
    if (finish) finishBars.push(finish);
  }
  if (!anyPlanned) {
    root.appendChild(el('div', { class: 'card' },
      el('p', { class: 'muted', style: 'margin:0' }, 'Nothing planned for today.'),
    ));
  }
  root.appendChild(el('button', { class: 'btn', onclick: () => adhocLog() }, '+ Log ad-hoc activity'));
  // Last on the page, under the ad-hoc button — in the flow, not pinned to
  // the screen (pinned, it got tapped by thumbs scrolling) — and only once
  // any overdue session is dealt with.
  if (!overdue) for (const bar of finishBars) root.appendChild(bar);
}

// Desktop side panel on Today.
function renderTodayAside(aside, today) {
  aside.appendChild(weighInCard(today));

  if (openLast?.perf) {
    aside.appendChild(el('section', { class: 'card side-card', dataset: { side: 'last' } },
      el('div', { class: 'side-head' }, el('span', {}, 'Last time'), el('span', {}, formatDate(openLast.perf.date, { month: 'short', day: 'numeric' }))),
      el('div', { class: 'row-sub', style: 'margin-bottom:6px' }, openLast.name),
      openLast.perf.sets.map((s, i) => el('div', { class: 'side-row' },
        el('span', { class: 'muted' }, `Set ${i + 1}`),
        el('strong', {}, s.weightKg > 0 ? `${formatWeight(s.weightKg)} × ${s.reps}` : `${s.reps ?? '—'} reps`)))));
  }

  // Weight trend, small.
  const pts = weightPoints(store.get('metrics'));
  if (pts.length) {
    const series = trendSeries(pts);
    const rate = trendSlope(pts);
    const recent = series.filter((p) => p.date >= addDays(today, -56));
    aside.appendChild(el('section', { class: 'card side-card tappable', dataset: { side: 'trend' },
      onclick: () => { sub = 'metrics'; render(); } },
      el('div', { class: 'side-head' }, el('span', {}, 'Weight trend')),
      el('div', { class: 'side-big' }, w1(series.at(-1).trendKg),
        el('span', { class: 'muted' }, ` ${weightUnit()}${rate ? ` · ${signed(toDispW(rate.slopeKgPerWeek))} ${weightUnit()}/wk` : ''}`)),
      recent.length >= 2 && lineChart({
        points: recent.map((p) => ({ x: parseDateStr(p.date).getTime(), y: toDispW(p.trendKg) })),
        dots: [], // a plain line: no marker per weigh-in at this size
        width: 300, height: 90, yFormat: (v) => String(Math.round(v)),
      })));
  }

  // This week's sessions.
  const start = weekStartOf(today, weekStartDay());
  const c = sessionCounts({
    start, end: addDays(start, 6), plans: store.get('plans'), logs: store.get('logs'),
    matches: store.get('matches'), records: store.get('sessions'), schedule: store.get('schedule'),
  });
  if (c.planned) {
    aside.appendChild(el('section', { class: 'card side-card', dataset: { side: 'week' } },
      el('div', { class: 'side-head' }, el('span', {}, 'This week'), el('span', {}, `${c.completed} of ${c.planned}`)),
      c.each.map((x) => {
        const state = x.completed ? 'Done' : x.date === today ? 'Today' : x.date < today ? 'Open' : 'Planned';
        return el('div', { class: 'side-row' },
          el('span', {}, `${formatDate(x.date, { weekday: 'short' })} · ${x.session.label || x.plan.name}`),
          el('span', { class: `status-pill ${state.toLowerCase()}` }, state));
      })));
  }
}

// One-tap daily weigh-in. Prefills the last known weight; merges into
// today's metric record if one already exists (no duplicate same-day rows).
function weighInCard(today) {
  const metrics = store.get('metrics');
  const todays = metrics.find((m) => m.date === today);

  if (todays?.weight != null) {
    return el('div', { class: 'card' },
      el('div', { class: 'list-row', style: 'border:none;padding:0' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, `${formatWeight(todays.weight)} `, el('span', { class: 'pill ok' }, 'weighed in')),
          metricSummary(todays) !== formatWeight(todays.weight) && el('div', { class: 'row-sub' }, metricSummary(todays)),
        ),
        el('button', { class: 'btn small secondary', onclick: () => logBodyMetric(todays) }, 'Edit'),
      ),
    );
  }

  const last = [...metrics].filter((m) => m.weight != null).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const input = el('input', {
    type: 'number', inputmode: 'decimal', step: 0.1,
    value: weightToInput(last?.weight) ?? '', placeholder: weightUnit(), 'aria-label': `Weight (${weightUnit()})`,
  });
  const save = () => {
    const w = parseFloat(input.value);
    if (isNaN(w)) { toast('Enter a weight', 'error'); return; }
    const kg = weightFromInput(w);
    const entry = todays ? { ...todays, weight: kg } : makeBodyMetric({ date: today, weight: kg });
    store.upsert('metrics', entry);
    // The trend, not a verdict on today's number.
    const series = trendSeries(weightPoints(store.get('metrics')));
    const t = series.at(-1)?.trendKg;
    toast(t != null ? `Weight logged · trend ${w1(t)} ${weightUnit()}` : 'Weight logged');
  };
  return el('div', { class: 'card' },
    el('div', { class: 'row-sub', style: 'margin-bottom:6px' }, 'Morning weigh-in'),
    el('div', { class: 'log-inputs', style: 'margin:0' },
      input,
      el('button', { class: 'btn small', onclick: save }, 'Log'),
      el('button', { class: 'btn small secondary', onclick: () => logBodyMetric(todays ?? null) }, 'More…'),
    ),
  );
}

// Import activity files exported from any device. Polar's API only reaches
// back 30 days, so this is how history and other devices get in.
function importActivitiesModal() {
  const fileInput = filePicker({ multiple: true });
  const statusEl = el('div', {});
  let modal;

  const run = async () => {
    const files = [...(fileInput.files ?? [])];
    if (!files.length) { toast('Choose one or more .gpx or .tcx files', 'error'); return; }
    statusEl.innerHTML = '';
    statusEl.appendChild(el('p', { class: 'muted' }, `Parsing ${files.length} file${files.length === 1 ? '' : 's'}…`));
    const { parseActivityFile, ParseError } = await import('../gps.js');
    const parsed = [];
    const failures = [];
    for (const f of files) {
      try {
        parsed.push(await parseActivityFile(f.name, await f.text()));
      } catch (e) {
        failures.push(e instanceof ParseError ? e.message : `${f.name}: ${e.message}`);
      }
    }
    // Nothing is written unless at least one file parsed cleanly.
    if (!parsed.length) {
      statusEl.innerHTML = '';
      statusEl.appendChild(el('p', { class: 'muted' }, failures.join(' · ')));
      toast('No files could be read', 'error');
      return;
    }
    const added = await store.addImportedActivities(parsed);
    modal.close();
    const withRoutes = parsed.filter((p) => p.gpsPolyline).length;
    toast(added
      ? `Imported ${added} activit${added === 1 ? 'y' : 'ies'}${withRoutes ? `, ${withRoutes} with GPS` : ''}`
      : 'Nothing new — those activities are already imported');
    if (failures.length) toast(`Skipped ${failures.length}: ${failures[0]}`, 'error');
    render();
  };

  modal = openModal('Import activities', el('div', {},
    el('p', { class: 'muted' },
      'Add activities from a .gpx or .tcx export — Polar Flow, Garmin Connect, or anything else that exports. ',
      'Pick several at once. Re-importing the same file does nothing, so it is safe to retry.'),
    el('div', { class: 'field' }, el('label', {}, 'Files'), fileInput),
    statusEl,
    el('p', { class: 'muted' },
      'On iPhone, choose “Browse” to reach Files or iCloud Drive. If your export arrived as a .zip, ',
      'long-press it in Files and tap Uncompress first, then pick the .gpx or .tcx inside.'),
    el('p', { class: 'muted' },
      'Routes are stored for the heatmap. Distance and duration come from the file when stated, ',
      'and are otherwise computed from the track. FIT files are not supported.'),
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    { label: 'Import', class: 'btn', onClick: () => { run(); return false; }, keepOpen: true },
  ]);
}

function blockLabel(type) {
  return { warmup: 'Warm-up', main: 'Main', strength: 'Strength', accessory: 'Accessory', cooldown: 'Cool-down' }[type] ?? 'Block';
}

// ---------- Today: a planned session on the gym floor ----------
//
// Each exercise is a card. Rep-based ones expand into set rows (one open at
// a time; the first unfinished one by default): ✓ a set and it goes to the
// session's draft (js/draft.js), the rest timer starts, and when every set
// is ticked the exercise is written as a log and the next one opens.
// Timed work (planks, holds, stretches) gets set rows too, with time per rep
// in place of weight; cardio and intervals keep the full log form. "Finish
// session" writes whatever is ticked and records the session as done
// (js/sessions.js).

// 'reps' | 'timed' (set rows) | null (the full form).
function setModeOf(item, ex) {
  if (isCardioExercise(ex)) return null;
  const kind = item.target?.kind ?? (ex?.measurementType === 'duration' ? 'duration' : (ex?.measurementType ?? 'reps'));
  return kind === 'reps' ? 'reps' : kind === 'duration' ? 'timed' : null;
}

const variantName = (ex, level) => (level != null ? ex?.variants?.find((v) => v.level === level)?.name : null);

// Every prior set of an exercise (before `date`), for sanity checks.
function priorSets(exerciseId, date, logs) {
  return logs.filter((l) => l.exerciseId === exerciseId && l.date < date).flatMap(setsOf);
}

function renderSessionToday({ plan, session, week, today, lib, logs, loggedByPe, doneIds, records, repeat = false }) {
  const key = draftKey(today, session.id);
  const status = sessionStatus({ session, date: today, records, doneIds, repeat, logs });
  const draft = readDraft(key);
  // Full or minimum (js/minimum.js): the minimum is a computed view; the
  // stored plan never changes. A finished session shows how it was done.
  const minimum = minimumSession(session);
  const mode = status.kind ?? draft.mode ?? 'full';
  const shown = mode === 'minimum' ? minimum : session;
  const entries = sessionItems(shown).map(({ block, item }) => {
    const ex = lib.get(item.exerciseId);
    const setMode = setModeOf(item, ex);
    const reps = setMode != null; // has set rows
    const timed = setMode === 'timed';
    const log = loggedByPe.get(item.id) ?? null;
    const d = draft.items[item.id];
    const finished = !!log && !(d?.rows?.some((r) => !r.done));
    return { block, item, ex, reps, timed, log, finished };
  });
  const rec = status.kind ? { kind: status.kind } : null;
  // Open the first unfinished exercise — unless the session is finished.
  if (!entries.some((e) => e.item.id === expandedItem)) {
    expandedItem = rec ? null : entries.find((e) => e.reps && !e.finished)?.item.id ?? null;
  }

  root.appendChild(el('div', { class: 'session-head' },
    el('div', { class: 'row-main' },
      el('div', { class: 'session-title' }, session.label || plan.name),
      el('div', { class: 'row-sub' },
        `${plan.name} · week ${week.index}${repeat ? ' (repeat)' : ''}${week.isDeload ? ' (deload)' : ''}`
        + `${session.estimatedDurationMin ? ` · ~${session.estimatedDurationMin} min` : ''}`),
      session.note && el('div', { class: 'row-sub' }, session.note),
    ),
    status.completed && el('span', { class: 'pill ok' }, status.kind === 'minimum' ? 'done · minimum' : 'done'),
  ));
  if (!status.kind && entries.length) {
    const pick = (m) => () => { setDraftMode(key, m); expandedItem = null; render(); };
    root.appendChild(el('div', { class: 'segmented session-mode', role: 'group', 'aria-label': 'Session version' },
      el('button', { class: mode === 'full' ? 'active' : '', type: 'button', dataset: { mode: 'full' }, onclick: pick('full') }, 'Full session'),
      el('button', { class: mode === 'minimum' ? 'active' : '', type: 'button', dataset: { mode: 'minimum' }, onclick: pick('minimum') },
        `Minimum · ~${estimateMinutes(session, minimum)} min`)));
    if (mode === 'minimum') {
      root.appendChild(el('p', { class: 'muted min-note' },
        'Counts as a completed session. It won’t trigger weight or level increases.'));
    }
  }
  if (!entries.length) root.appendChild(el('p', { class: 'muted' }, 'Session has no exercises.'));

  let lastBlock = null;
  for (const e of entries) {
    if (e.block !== lastBlock && ((session.blocks?.length ?? 0) > 1 || e.block.name || e.block.rounds)) {
      root.appendChild(el('div', { class: 'block-label' },
        (e.block.name || blockLabel(e.block.type)) + (e.block.rounds ? ` — ${e.block.rounds} rounds` : ''),
        mode === 'minimum' && el('span', { class: 'block-note' }, e.block.unchanged ? ' · unchanged' : ' · half the sets')));
      if (e.block.note) root.appendChild(el('div', { class: 'row-sub', style: 'margin:-4px 2px 8px' }, e.block.note));
    }
    lastBlock = e.block;
    root.appendChild(exerciseCard({ plan, session, week, today, key, logs, entries, minimumMode: mode === 'minimum', ...e }));
  }

  // Returned, not appended: Today puts it at the very bottom.
  if (!rec && entries.length) {
    return el('div', { class: 'finish-bar' },
      el('button', { class: 'btn block large', dataset: { action: 'finish' }, onclick: () => finishSession(plan, session, today, mode, repeat) },
        mode === 'minimum' ? finishLabel(session, plan).replace('Finish', 'Finish minimum') : finishLabel(session, plan)));
  }
  return null;
}

// One session a day is the norm; with two, each Finish says which.
function finishLabel(session, plan) {
  const todays = occurrences(store.get('plans'), store.get('schedule'))
    .filter((o) => o.date === todayStr() && !o.skipped);
  return todays.length > 1 ? `Finish ${session.label || plan.name}` : 'Finish session';
}

function finishSession(plan, session, date, kind, repeat = false) {
  const key = draftKey(date, session.id);
  flushDraft(key);
  clearDraft(key);
  if (kind === 'minimum') {
    // Logs entered through the full form too: stamp them, in one save.
    const ids = new Set(sessionItems(session).map(({ item }) => item.id));
    const all = store.get('logs');
    if (all.some((l) => l.date === date && ids.has(l.plannedExerciseId) && l.mode !== 'minimum')) {
      store.save('logs', all.map((l) => (l.date === date && ids.has(l.plannedExerciseId) ? { ...l, mode: 'minimum' } : l)));
    }
  }
  store.upsert('sessions', {
    id: sessionRecordId(date, session.id), date, plannedSessionId: session.id, planId: plan.id, kind,
    ...(repeat ? { repeat: true } : {}),
  });
  setSessionActive(false);
  skipRest();
  expandedItem = null;
  toast('Session finished — nice work');
  painPrompt({ plan, session, date });
}

// ---------- Pain flag (js/pain.js) ----------
//
// One optional question after a session. Picking an answer saves it on the
// session's record (data/sessions.json, encrypted); closing without one
// saves nothing. The plan's injury rule is shown word for word.

function painPrompt({ plan, session, date }) {
  const recId = sessionRecordId(date, session.id);
  const rule = plan.progressionPolicy?.injuryRule ?? null;
  const ran = hasRun(session, exById());
  let level = null;
  const regions = new Set();
  const body = el('div', { class: 'pain-sheet' });
  let modal = null;

  const save = () => {
    const rec = store.get('sessions').find((r) => r.id === recId);
    if (!rec) return null;
    const next = { ...rec, pain: level === 'none' ? { level: 'none' } : { level, regions: [...regions] } };
    store.upsert('sessions', next);
    return next;
  };

  function draw() {
    const records = store.get('sessions');
    const rec = records.find((r) => r.id === recId);
    const eff = rec?.pain ? effectivePain(rec, records) : null;
    const runPain = eff === 'pain' && ran && [...regions].some((r) => RUN_REGIONS.includes(r));
    const stop = runPain && painTwoWeeksRunning(records, date, (d) => weekStartOf(d, weekStartDay()));
    body.replaceChildren(...[
      el('p', { class: 'muted', style: 'margin:-8px 0 12px' }, 'Optional. Skipping saves nothing.'),
      el('div', { class: 'pain-levels' }, [['none', 'None'], ['niggle', 'Niggle'], ['pain', 'Pain']].map(([v, text]) =>
        el('button', { class: `pain-level${level === v ? ' on' : ''}`, type: 'button', dataset: { level: v }, onclick: () => {
          level = v;
          if (v === 'none') { regions.clear(); save(); modal.close(); toast('Noted'); return; }
          save();
          draw();
        } }, text))),
      level && level !== 'none' && el('div', { class: 'row-sub', style: 'margin:14px 0 8px' }, 'Where?'),
      level && level !== 'none' && el('div', { class: 'pain-regions' }, PAIN_REGIONS.map(([v, text]) =>
        el('button', { class: `chip${regions.has(v) ? ' on' : ''}`, type: 'button', dataset: { region: v }, onclick: () => {
          if (regions.has(v)) regions.delete(v); else regions.add(v);
          save();
          draw();
        } }, text))),
      level === 'niggle' && eff === 'pain' && el('p', { class: 'pain-note' }, 'Same area as last session, so this counts as pain.'),
      runPain && rule && el('div', { class: 'rule-box' },
        el('div', { class: 'rule-kicker' }, 'Your plan’s injury rule'),
        el('div', {}, stop ? stopLine(rule) : rule)),
      runPain && rule && !stop && el('button', { class: 'btn block large', dataset: { action: 'repeat-week' }, onclick: () => {
        const weekIndex = plan.weeks.find((w) => w.sessions.some((x) => x.id === session.id))?.index;
        const records2 = store.get('sessions');
        const doneIds = doneItemIds(store.get('logs'), store.get('matches'));
        const isDone = (o) => sessionStatus({ session: o.session, date: o.date, records: records2, doneIds, repeat: o.repeat, logs: store.get('logs') }).completed;
        store.save('schedule', repeatWeek({ plan, weekIndex, schedule: store.get('schedule'), isDone }));
        modal.close();
        toast(`Week ${weekIndex} repeats; later weeks move back 7 days`);
      } }, 'Repeat this week'),
      el('button', { class: 'link-btn block-link', type: 'button', dataset: { action: 'pain-close' }, onclick: () => modal.close() },
        level ? 'Done' : 'Not now'),
      eff === 'pain' && el('p', { class: 'muted', style: 'margin:10px 0 0;font-size:0.85rem' },
        'Next time, this session’s exercises won’t suggest an increase.'),
      el('p', { class: 'muted', style: 'margin:6px 0 0;font-size:0.85rem' }, CLINICIAN_LINE),
    ].filter(Boolean));
  }
  draw();
  modal = openModal('Any pain today?', body, []);
}

function exerciseCard({ plan, session, week, today, key, logs, entries, block, item, ex, reps, timed = false, log, finished, minimumMode = false }) {
  const t = item.target ?? {};
  const plans = store.get('plans');
  const draftItem = readDraft(key).items[item.id];
  // What to do this time (js/progression.js): advisory, derived from the
  // logs before today, never stored. ✕ hides it for this visit.
  const sug = reps && !timed ? suggestionFor({
    exercise: ex, target: t, weekIsDeload: !!week?.isDeload,
    logs: logs.filter((l) => l.date < today), plans, today, records: store.get('sessions'),
  }) : null;
  const active = sug && !dismissedSug.has(item.id);
  // A suggested move up/down the ladder is the level you log at — unless
  // sets are already ticked at another level.
  const ticked = draftItem?.rows?.some((r) => r.done);
  const level = ticked ? draftItem.variantLevel ?? null
    : active && ['advance', 'regress'].includes(sug.kind) ? sug.variantLevel
      : t.variantLevel ?? null;
  const vName = variantName(ex, level);
  const title = el('div', { class: 'ex-title' },
    ex ? exerciseLink(ex) : '?',
    vName ? el('span', { class: 'ex-variant' }, ` · ${vName}`) : null,
    item.optional ? el('span', { class: 'pill', style: 'margin-left:6px' }, 'optional') : null);
  // In a minimum session, what changed: "2 × 10 · was 3 × 10"; warm-up and
  // cool-down say they're unchanged.
  const targetText = !minimumMode ? targetSummary(t)
    : block.unchanged ? `${targetSummary(t)} · unchanged`
      : item.was && targetSummary(item.was) !== targetSummary(t) ? `${targetSummary(t)} · was ${targetSummary(item.was)}`
        : targetSummary(t);

  // Timed / cardio work: the full log form.
  if (!reps) {
    return el('div', { class: `card ex-card tappable${log ? ' is-finished' : ''}`, dataset: { item: item.id },
      onclick: () => logEntryModal(log ? { existing: log, plan, pe: item, ex } : { plan, session, pe: item, ex }) },
    el('div', { class: 'ex-head' },
      el('div', { class: 'row-main' }, title,
        el('div', { class: 'row-sub' }, log ? `✓ ${actualSummary(log.actual)}` : targetText)),
      el('span', { class: 'chev' }, log ? 'Edit' : 'Log ›')));
  }

  const open = expandedItem === item.id;
  if (!open) {
    return el('div', { class: `card ex-card tappable${finished ? ' is-finished' : ''}`, dataset: { item: item.id },
      onclick: () => { expandedItem = item.id; render(); } },
    el('div', { class: 'ex-head' },
      el('div', { class: 'row-main' }, title,
        el('div', { class: 'row-sub' }, log ? `✓ ${actualSummary(log.actual)}` : targetText),
        !log && active && sug.kind !== 'hold' && el('div', { class: 'sug-mini', dataset: { kind: sug.kind } }, `${arrowOf(sug)} ${suggestionTitle(sug, ex)}`)),
      el('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  }

  const perf = lastPerformance({
    exerciseId: item.exerciseId, variantLevel: level, logs, beforeDate: today, exercise: ex, plans,
  });
  const base = {
    exerciseId: item.exerciseId, planId: plan.id, plannedExerciseId: item.id,
    variantLevel: level, logId: draftItem?.logId ?? log?.id ?? null,
  };
  openLast = { name: ex?.name ?? '', perf };
  const rowsUi = setRows({
    exercise: ex,
    target: t,
    perf,
    rows: draftItem?.rows ?? (log ? rowsFromActual(log.actual, { timed }) : null),
    showWeight: draftItem?.showWeight ?? null,
    history: priorSets(item.exerciseId, today, logs),
    lastColumn: isDesktop(),
    timed,
    onChange: (st) => updateDraftItem(key, item.id, { ...base, ...st }),
    onCheck: () => {
      setSessionActive(true);
      if (restSettings.auto) startRest(restSecondsFor(ex, t));
      if (rowsUi.allDone()) {
        // Exercise complete: write it, and open the next unfinished one.
        const next = entries.find((e) => e.reps && !e.finished && e.item.id !== item.id);
        expandedItem = next?.item.id ?? null;
        flushItem(key, item.id);
        render();
      }
    },
  });

  // The suggested values become the ghosts (accent, with an arrow), so ✓
  // on an untouched row logs the suggestion.
  if (active && CHANGES_GHOSTS.includes(sug.kind)) {
    rowsUi.setGhosts((i) => {
      const g = ghostSet(perf, i);
      return {
        reps: sug.repsMin ?? g?.reps ?? t.reps ?? t.repsMin ?? null,
        kg: sug.weightKg ?? g?.weightKg ?? null,
        suggested: true,
        arrow: arrowOf(sug),
      };
    });
  }
  const chip = active && !log && suggestionChip(sug, ex, {
    target: t,
    onDismiss: () => { dismissedSug.add(item.id); render(); },
  });

  const lastDate = perf ? `Last time (${formatDate(perf.date, { month: 'short', day: 'numeric' })}): ` : '';
  const last = !perf ? null
    : timed ? lastDate + perf.sets.map((x) => (x.reps > 1 ? `${x.reps} × ${holdText(x.durationSec)}` : holdText(x.durationSec))).join(' / ')
      : lastDate + perf.sets.map((x) => x.reps).join(' / ')
        + (perf.sets.some((x) => x.weightKg > 0) ? ` @ ${formatWeight(Math.max(...perf.sets.map((x) => x.weightKg ?? 0)))}` : '');
  return el('div', { class: 'card ex-card is-open', dataset: { item: item.id } },
    el('div', { class: 'ex-head' },
      el('div', { class: 'row-main' }, title,
        el('div', { class: 'row-sub' }, targetText + (t.restSec ? '' : ''))),
      el('button', {
        class: 'link-btn', type: 'button',
        onclick: () => {
          // RPE, notes, variant: the full form, on the log as ticked so far.
          const id = flushItem(key, item.id);
          const existing = id ? store.get('logs').find((l) => l.id === id) : log;
          logEntryModal(existing ? { existing, plan, pe: item, ex } : { plan, session, pe: item, ex });
        },
      }, 'Details')),
    chip,
    last && el('div', { class: 'row-sub last-time' }, last),
    item.note && el('div', { class: 'row-sub' }, item.note),
    rowsUi.el,
  );
}

// Which form an already-recorded entry needs, read from the data itself.
// null when there's nothing recorded yet, so callers fall back to the plan
// target or the exercise's measurement type.
function inferKind(actual) {
  if (!actual) return null;
  if (actual.distanceM != null || actual.movingSec != null) return 'distance';
  if (actual.durationSec != null || actual.holdSec != null || Array.isArray(actual.setHoldSec)) return 'duration';
  if (['sets', 'reps', 'setReps', 'weight', 'setWeights'].some((k) => actual[k] != null)) return 'reps';
  return null;
}

// Picker state round-trips through the modal's Back button so a mis-click
// returns to the same search + scroll position instead of starting over.
function adhocLog(restore) {
  pickExercise((ex, pickerState) => logEntryModal({ ex, onBack: () => adhocLog(pickerState) }), restore);
}

// Shared entry modal for planned, ad-hoc, and edit flows.
function logEntryModal({ existing = null, plan = null, session = null, pe = null, ex = null, onBack = null }) {
  const entry = existing
    ? JSON.parse(JSON.stringify(existing))
    : makeLogEntry({
        planId: plan?.id ?? null,
        plannedExerciseId: pe?.id ?? null,
        exerciseId: ex?.id ?? null,
      });

  // What the entry already holds wins: the form must be able to represent
  // existing data even when the exercise it referenced has been deleted,
  // because Save rebuilds `actual` from whichever fields are shown.
  // Cardio (by exercise category/modality, a distance target, or cardio data
  // already in the entry) gets the full cardio form. Non-cardio intervals are
  // logged as a completed duration, comparable with other timed work.
  const a = entry.actual ?? {};
  const t = pe?.target ?? {};
  const inferred = existing ? inferKind(existing.actual) : null;
  const cardio = hasCardioData(a)
    || (inferred !== 'reps' && (isCardioExercise(ex) || t.kind === 'distance' || ex?.measurementType === 'distance'));
  let kind = cardio ? 'cardio'
    : inferred ?? t.kind ?? (ex?.measurementType === 'duration' ? 'duration' : 'reps');
  if (kind === 'intervals') kind = 'duration';
  const dateInput = el('input', { type: 'date', value: entry.date });
  const fields = el('div', { class: 'field-row' });
  let cardioForm = null;
  let repsForm = null;
  const num = (name, value, step = 1) =>
    el('input', { type: 'number', inputmode: 'decimal', step, value: value ?? '', dataset: { name } });
  const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);

  let dropDraft = null;
  // Timed work (non-cardio duration) gets set rows too: time per rep × reps.
  const timed = kind === 'duration';
  if (kind === 'reps' || timed) {
    // Unsaved sets of a new entry are kept as a draft (flushed as this same
    // entry if the app is closed mid-way); Save or Cancel drops the draft.
    const adhocKey = existing ? null : draftKey(entry.date, 'adhoc');
    const drafted = adhocKey ? readDraft(adhocKey).items[entry.id] : null;
    repsForm = setRows({
      exercise: ex,
      // Intervals log as one block of their total time.
      target: existing ? {} : t.kind === 'intervals' ? { sets: 1, durationSec: t.totalSec ?? null } : t,
      perf: ex ? lastPerformance({
        exerciseId: ex.id, variantLevel: a.variantLevel ?? t.variantLevel ?? null,
        logs: store.get('logs').filter((l) => l.id !== entry.id), beforeDate: entry.date, exercise: ex, plans: store.get('plans'),
      }) : null,
      rows: drafted?.rows ?? (existing ? rowsFromActual(a, { timed }) : null),
      showWeight: drafted?.showWeight ?? (existing && !timed && ex?.modality === 'bodyweight' ? rowsFromActual(a).some((r) => r.kg > 0) : null),
      timed,
      history: ex ? priorSets(ex.id, entry.date, store.get('logs').filter((l) => l.id !== entry.id)) : [],
      includeTyped: true,
      onChange: (st) => adhocKey && updateDraftItem(adhocKey, entry.id, {
        exerciseId: entry.exerciseId, planId: entry.planId, plannedExerciseId: entry.plannedExerciseId,
        variantLevel: null, logId: entry.id, ...st,
      }),
      onCheck: () => { if (restSettings.auto) startRest(restSecondsFor(ex, t)); },
    });
    dropDraft = () => adhocKey && removeDraftItem(adhocKey, entry.id);
  } else if (kind === 'cardio') {
    // Older cardio logs held minutes only (durationSec); show that as the
    // duration so re-saving keeps it. A new entry starts from the plan target.
    cardioForm = cardioFields({
      ...a,
      movingSec: a.movingSec ?? a.durationSec ?? (existing ? null : t.durationSec ?? t.totalSec ?? null),
      distanceM: a.distanceM ?? (existing ? null : t.distanceM ?? null),
    }, { gear: store.get('gear'), sport: sportOf(entry, ex), date: entry.date });
  }

  // Which rung of the exercise's ladder this was (drives the load metrics,
  // js/load.js). Prefilled from the plan's target, else the level last
  // logged; an existing entry shows what it resolves to. Left untouched on
  // an existing entry, nothing new is written.
  let variantSel = null;
  let variantShown = '';
  if (ex?.variants?.length) {
    const lastLevel = () => store.get('logs')
      .filter((l) => l.exerciseId === ex.id && l.id !== entry.id && Number.isInteger(l.actual?.variantLevel))
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))[0]?.actual.variantLevel ?? null;
    const level = existing
      ? variantLevelFor(existing, store.get('plans'))
      : (Number.isInteger(t.variantLevel) ? t.variantLevel : lastLevel());
    variantSel = el('select', { dataset: { name: 'variant' } },
      el('option', { value: '', selected: level == null }, '— not recorded'),
      [...ex.variants].sort((x, y) => x.level - y.level).map((v) =>
        el('option', { value: v.level, selected: v.level === level }, `L${v.level} · ${v.name}`)));
    variantShown = variantSel.value;
  }

  const rpeInput = num('rpe', entry.rpe, 1);
  rpeInput.setAttribute('min', 1);
  rpeInput.setAttribute('max', 10);
  const notesInput = el('textarea', {}, entry.notes ?? '');

  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Date'), dateInput),
    variantSel ? el('div', { class: 'field' }, el('label', {}, 'Variant'), variantSel) : null,
    cardioForm ? cardioForm.el : repsForm ? null : fields,
    repsForm ? el('div', { class: 'field' }, repsForm.el) : null,
    el('div', { class: 'field' }, el('label', {}, 'RPE (1–10, optional)'), rpeInput),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
  );

  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => { dropDraft?.(); } },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        const val = (n) => {
          const v = parseFloat(body.querySelector(`[data-name="${n}"]`)?.value);
          return isNaN(v) ? null : v;
        };
        const actual = {};
        if (repsForm) {
          const r = repsForm.read();
          if (r.error) { toast(r.error, 'error'); return false; }
          Object.assign(actual, r.values);
        } else if (kind === 'cardio') {
          const r = cardioForm.read();
          if (r.error) { toast(r.error, 'error'); return false; }
          for (const [k, v] of Object.entries(r.values)) if (v != null) actual[k] = v;
          // "Default" is pinned to the gear that's the default right now, so
          // adding new shoes later doesn't move runs already logged in the old
          // ones. With no default set it stays open, and gear added later
          // with an earlier "in use since" date picks it up.
          if (actual.gearId == null) {
            const d = defaultGear(store.get('gear'), sportOf(entry, ex), dateInput.value || todayStr());
            if (d) actual.gearId = d.id;
          }
        }
        if (variantSel) {
          if (existing && variantSel.value === variantShown) {
            if (a.variantLevel != null) actual.variantLevel = a.variantLevel;
          } else if (variantSel.value !== '') {
            actual.variantLevel = Number(variantSel.value);
          }
        } else if (a.variantLevel != null) {
          actual.variantLevel = a.variantLevel; // exercise deleted or its ladder removed
        }
        Object.assign(entry, {
          date: dateInput.value || todayStr(),
          actual,
          rpe: val('rpe'),
          notes: notesInput.value.trim(),
        });
        store.upsert('logs', entry);
        dropDraft?.();
        toast('Logged');
      },
    },
  ];
  if (existing) {
    actions.unshift({
      label: 'Delete',
      class: 'btn danger',
      // No "are you sure": it goes, with a few seconds to Undo.
      onClick: () => {
        const pending = store.removeLater('logs', entry.id);
        undoToast('Log entry deleted', { onUndo: pending.undo, onCommit: pending.commit });
      },
    });
  }
  if (onBack) {
    actions.unshift({ label: '‹ Back', class: 'btn secondary', onClick: () => onBack() });
  }
  openModal(ex?.name ?? 'Log activity', body, actions);
}

// ---------- History ----------

function renderHistory() {
  const lib = exById();
  const plans = store.get('plans');
  const planById = new Map(plans.map((p) => [p.id, p]));

  const fromIn = el('input', { type: 'date', value: histFilter.from, onchange: (e) => { histFilter.from = e.target.value; render(); } });
  const toIn = el('input', { type: 'date', value: histFilter.to, onchange: (e) => { histFilter.to = e.target.value; render(); } });
  const planSel = el('select', { onchange: (e) => { histFilter.planId = e.target.value; render(); } },
    el('option', { value: '' }, 'All plans'),
    plans.map((p) => el('option', { value: p.id, selected: histFilter.planId === p.id }, p.name)),
    el('option', { value: 'adhoc', selected: histFilter.planId === 'adhoc' }, 'Ad-hoc only'),
  );
  root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'History'),
    el('button', { class: 'btn small secondary', onclick: () => importActivitiesModal() }, 'Import GPX/TCX'),
  ));
  root.appendChild(el('div', { class: 'card' },
    el('div', { class: 'field-row' },
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'From'), fromIn),
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'To'), toIn),
      el('div', { class: 'field', style: 'margin:0' }, el('label', {}, 'Plan'), planSel),
    ),
  ));

  const inRange = (d) => (!histFilter.from || d >= histFilter.from) && (!histFilter.to || d <= histFilter.to);

  // Merge manual logs and synced activities into one timeline.
  const items = [];
  for (const log of store.get('logs')) {
    if (!inRange(log.date)) continue;
    if (histFilter.planId === 'adhoc' && log.planId) continue;
    if (histFilter.planId && histFilter.planId !== 'adhoc' && log.planId !== histFilter.planId) continue;
    items.push({ kind: 'log', date: log.date, log });
  }
  if (!histFilter.planId || histFilter.planId === 'adhoc') {
    for (const entry of activitiesWithStatus()) {
      if (!inRange(entry.date)) continue;
      if (histFilter.planId === 'adhoc' && entry.matchStatus === 'confirmed') continue;
      items.push({ kind: 'activity', date: entry.date, entry });
    }
  } else {
    for (const entry of activitiesWithStatus()) {
      if (inRange(entry.date) && entry.matchStatus === 'confirmed' && entry.match.planId === histFilter.planId) {
        items.push({ kind: 'activity', date: entry.date, entry });
      }
    }
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  if (!items.length) {
    root.appendChild(emptyState('No entries in this range.'));
    return;
  }
  const card = el('div', { class: 'card' });
  const gear = store.get('gear');
  for (const item of items) {
    card.appendChild(item.kind === 'log' ? logRow(item.log, lib, planById, gear) : activityRow(item.entry, lib, planById, gear));
  }
  root.appendChild(card);
}

function logRow(log, lib, planById, gear = []) {
  const ex = lib.get(log.exerciseId);
  const plan = planById.get(log.planId);
  const extras = isCardioExercise(ex) || hasCardioData(log.actual)
    ? cardioExtras({ ...log.actual, date: log.date, sport: sportOf(log, ex) }, gear)
    : '';
  return el('div', { class: 'list-row' },
    el('div', { class: 'row-main tappable', onclick: () => logEntryModal({ existing: log, ex }) },
      el('div', { class: 'row-title' }, ex ? exerciseLink(ex) : 'Activity'),
      el('div', { class: 'row-sub' },
        `${formatDate(log.date)} · ${actualSummary(log.actual)}${log.rpe ? ` · RPE ${log.rpe}` : ''}`),
      extras && el('div', { class: 'row-sub' }, extras),
      log.notes && el('div', { class: 'row-sub' }, log.notes),
      // Below the text, not beside it: a long plan name in a no-wrap pill
      // beside the text squeezed the text column to one character wide.
      el('div', { class: 'row-plan' },
        el('span', { class: `pill wrap ${plan ? 'accent' : ''}` }, plan ? plan.name : 'ad-hoc')),
    ),
  );
}

function activityRow(entry, lib, planById, gear = []) {
  const extras = cardioExtras({ ...entry, sport: sportOf(entry, null) }, gear);
  const statusPill = {
    unmatched: ['pill', 'unlinked'],
    suggested: ['pill warn', 'suggested'],
    confirmed: ['pill ok', 'linked'],
    rejected: ['pill', 'ad-hoc'],
  }[entry.matchStatus];

  const row = el('div', { class: 'list-row' },
    el('div', { class: 'row-main tappable', onclick: () => activityEditModal(entry) },
      el('div', { class: 'row-title' }, entry.name || entry.type, ' ',
        el('span', { class: 'pill' }, entry.source ?? 'synced'),
        entry.edited ? el('span', { class: 'pill', style: 'margin-left:4px' }, 'edited') : ''),
      el('div', { class: 'row-sub' }, `${formatDate(entry.date)} · ${actualSummary(entry)}`),
      extras && el('div', { class: 'row-sub' }, extras),
      entry.notes && el('div', { class: 'row-sub' }, entry.notes),
    ),
    el('span', { class: statusPill[0] }, statusPill[1]),
  );

  if (entry.matchStatus === 'suggested') {
    const target = describeMatch(entry.match, planById, lib);
    return el('div', {}, row, el('div', { class: 'list-row', style: 'border-top:none;padding-top:0' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-sub' }, `Suggested match: ${target}`)),
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn small', onclick: () => decideMatch(entry, 'confirmed') }, 'Confirm'),
        el('button', { class: 'btn small secondary', onclick: () => decideMatch(entry, 'rejected') }, 'Reject'),
      ),
    ));
  }
  if (entry.matchStatus === 'unmatched') {
    return el('div', {}, row, el('div', { class: 'list-row', style: 'border-top:none;padding-top:0' },
      el('div', { class: 'row-main' }),
      el('button', { class: 'btn small secondary', onclick: () => manualLink(entry) }, 'Link to plan…'),
    ));
  }
  if (entry.matchStatus === 'confirmed') {
    row.querySelector('.row-main').appendChild(
      el('div', { class: 'row-sub' }, `↳ ${describeMatch(entry.match, planById, lib)}`),
    );
  }
  return row;
}

// Sports offered when correcting an activity. Values are SPORT_TYPE_MAP keys,
// so a correction also fixes how the matcher classifies the activity.
const SPORT_OPTIONS = [
  ['running', 'Running'],
  ['trail_running', 'Trail running'],
  ['treadmill_running', 'Treadmill running'],
  ['walking', 'Walking'],
  ['hiking', 'Hiking'],
  ['cycling', 'Cycling'],
  ['indoor_cycling', 'Indoor cycling'],
  ['swimming', 'Swimming'],
  ['rowing', 'Rowing'],
  ['strength_training', 'Strength training'],
  ['other_outdoor', 'Other (outdoor)'],
  ['other_indoor', 'Other (indoor)'],
];

// Correct a synced or imported activity. Edits are kept in a browser-owned
// overlay (store.editActivity), so nothing here writes the sync workflow's
// files and a later re-sync can't undo the correction.
function activityEditModal(entry) {
  const name = el('input', { type: 'text', value: entry.name ?? '' });
  const options = SPORT_OPTIONS.some(([v]) => v === entry.type)
    ? SPORT_OPTIONS
    : [[entry.type ?? '', entry.type || 'Unknown'], ...SPORT_OPTIONS];
  const type = el('select', {}, options.map(([v, label]) =>
    el('option', { value: v, selected: v === entry.type }, label)));
  const date = el('input', { type: 'date', value: entry.date });
  const cardio = cardioFields(entry, { gear: store.get('gear'), sport: sportOf(entry, null), date: entry.date });
  const notes = el('textarea', { placeholder: 'How it felt, conditions, anything worth keeping' }, entry.notes ?? '');
  let modal;

  const save = async () => {
    const r = cardio.read();
    if (r.error) { toast(r.error, 'error'); return false; }
    if (!date.value) { toast('Pick a date', 'error'); return false; }
    // editActivity stores only what differs from the synced record, so a
    // field left as it came (gear left on "Default" included) isn't an edit.
    await store.editActivity(entry.id, {
      name: name.value.trim() || null,
      type: type.value || null,
      date: date.value,
      ...r.values,
      notes: notes.value.trim() || null,
    });
    modal.close();
    toast('Activity updated');
    runMatcher();
    render();
  };

  const del = async () => {
    if (!await confirmDialog(`Remove “${entry.name || entry.type}” from your history?`)) return false;
    // Drop its match too, or a confirmed link would keep counting towards
    // adherence for an activity that no longer exists.
    const matches = store.get('matches').filter((m) => matchActivityId(m) !== entry.id);
    if (matches.length !== store.get('matches').length) await store.save('matches', matches);
    const how = await store.removeActivity(entry.id);
    modal.close();
    toast(how === 'deleted' ? 'Activity deleted' : 'Activity hidden from history');
    render();
  };

  const actions = [{ label: 'Cancel', class: 'btn secondary', onClick: () => {} }];
  if (entry.edited) {
    actions.push({
      label: 'Reset',
      class: 'btn secondary',
      onClick: async () => { await store.resetActivity(entry.id); toast('Reverted to the original'); render(); },
    });
  }
  actions.push({ label: 'Delete', class: 'btn danger', onClick: del, keepOpen: true });
  actions.push({ label: 'Save', class: 'btn', onClick: save, keepOpen: true });

  modal = openModal('Edit activity', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Name'), name),
    el('div', { class: 'field' }, el('label', {}, 'Sport'), type),
    el('div', { class: 'field' }, el('label', {}, 'Date'), date),
    cardio.el,
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notes),
    el('p', { class: 'muted' }, entry.gpsPolyline
      ? 'The GPS route is kept as recorded. Edits are stored separately from the synced file, so re-syncing won’t undo them.'
      : 'Edits are stored separately from the synced file, so re-syncing won’t undo them.'),
  ), actions);
}

function describeMatch(match, planById, lib) {
  const plan = planById.get(match.planId);
  if (!plan) return 'a deleted plan';
  const session = allSessions(plan).map((s) => s.session).find((s) => s.id === match.sessionId);
  const item = session && sessionItems(session).map((x) => x.item).find((i) => i.id === match.plannedExerciseId);
  const ex = item && lib.get(item.exerciseId);
  return [plan.name, session?.label, ex?.name].filter(Boolean).join(' · ') || plan.name;
}

function decideMatch(entry, status) {
  const matches = store.get('matches').slice();
  const i = matches.findIndex((m) => matchActivityId(m) === entry.id);
  if (i >= 0) matches[i] = { ...matches[i], status };
  else matches.push(makeMatch({ activityId: entry.id, status }));
  store.save('matches', matches);
  toast(status === 'confirmed' ? 'Linked to plan' : 'Left as ad-hoc');
}

// Manual picker for ambiguous/unmatched entries: shows nearby candidates.
function manualLink(entry) {
  const lib = exById();
  const candidates = findCandidates(entry, activePlans(), lib, 7, store.get('schedule')); // wide window for manual review
  const list = el('div', {});
  let modal;
  if (!candidates.length) {
    list.appendChild(el('p', { class: 'muted' },
      'No planned exercises of a matching type within a week of this activity.'));
  }
  for (const c of candidates.slice(0, 12)) {
    const date = c.date;
    list.appendChild(el('div', { class: 'list-row tappable', onclick: () => {
      modal.close();
      const matches = store.get('matches').slice();
      const rec = makeMatch({
        activityId: entry.id, status: 'confirmed',
        planId: c.planId, sessionId: c.sessionId, plannedExerciseId: c.plannedExerciseId,
      });
      const i = matches.findIndex((m) => matchActivityId(m) === entry.id);
      if (i >= 0) matches[i] = rec;
      else matches.push(rec);
      store.save('matches', matches);
      toast('Linked to plan');
    } },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, c.exercise.name),
        el('div', { class: 'row-sub' },
          `${c.plan.name} · ${c.session.label || 'session'} · ${formatDate(date)} · target ${targetSummary(c.plannedExercise.target)}`),
      ),
    ));
  }
  modal = openModal(`Link “${entry.name || entry.type}”`, list, [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    { label: 'Mark as ad-hoc', class: 'btn secondary', onClick: () => decideMatch(entry, 'rejected') },
  ]);
}

// ---------- Metrics ----------

function renderMetrics() {
  const metrics = [...store.get('metrics')].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (isDesktop()) { renderMetricsDesktop(metrics); return; }
  renderWeightTrend(metrics);

  // Sessions as counts, not a percentage to fall short of: the last 8
  // weeks (through this one), by the one completed rule.
  const end = addDays(weekStartOf(todayStr(), weekStartDay()), 6);
  const eight = sessionCounts({
    start: addDays(end, -55), end: todayStr(), plans: store.get('plans'), logs: store.get('logs'),
    matches: store.get('matches'), records: store.get('sessions'), schedule: store.get('schedule'),
  });
  const { done, planned } = adherence(adherenceDays);
  root.appendChild(el('div', { class: 'stat-row' },
    el('div', { class: 'stat-tile', dataset: { stat: 'sessions8' } },
      el('div', { class: 'stat-label' }, 'Last 8 weeks'),
      el('div', { class: 'stat-value' }, `${eight.completed} of ${eight.planned}`),
      el('div', { class: 'stat-label' }, 'sessions'),
    ),
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-label' }, 'Last 30 days'),
      el('div', { class: 'stat-value' }, String(logCount(30))),
      el('div', { class: 'stat-label' }, 'activities logged'),
    ),
  ));
  if (planned) {
    root.appendChild(el('p', { class: 'muted footnote' }, `Planned exercises logged, last 30 days: ${done} of ${planned}.`));
  }

  // Other body metrics stay raw (weight has its trend section above), shown
  // once they have enough data to draw.
  for (const m of BODY_METRICS) {
    if (m.smooth) continue;
    const res = resolveMetric(m);
    const points = datePoints(
      metrics.filter((r) => r[m.id] != null),
      (r) => res.toInput(r[m.id]),
      (r) => `${r.date}: ${res.toInput(r[m.id])} ${res.unit}`,
    );
    if (points.length < 2) continue;
    root.appendChild(el('h3', {}, m.label));
    root.appendChild(lineChart({
      points,
      yLabel: res.unit,
      yFormat: (v) => (res.step >= 1 ? String(Math.round(v)) : v.toFixed(1)),
    }));
  }

  // Running pace + distance from all sources
  const runs = runningActivities();
  root.appendChild(el('h3', {}, 'Running pace'));
  root.appendChild(lineChart({
    points: datePoints(runs.filter((r) => r.distanceM && r.movingSec),
      (r) => paceChartValue(r.distanceM, r.movingSec),
      (r) => `${r.date}: ${formatPace(r.distanceM, r.movingSec)} · ${formatDistance(r.distanceM)}`),
    yLabel: `min${paceUnit()} (lower = faster)`,
    yFormat: (v) => v.toFixed(1),
    invertY: true,
  }));
  root.appendChild(el('h3', {}, 'Running distance'));
  root.appendChild(lineChart({
    points: datePoints(runs.filter((r) => r.distanceM),
      (r) => distanceToInput(r.distanceM),
      (r) => `${r.date}: ${formatDistance(r.distanceM)}`),
    yLabel: distanceUnit(),
    yFormat: (v) => v.toFixed(1),
  }));

  if (metrics.length) {
    const card = el('div', { class: 'card' }, el('h3', {}, 'Recent entries'));
    for (const m of [...metrics].reverse().slice(0, 10)) {
      card.appendChild(el('div', { class: 'list-row' },
        el('div', { class: 'row-main tappable', onclick: () => logBodyMetric(m) },
          el('div', { class: 'row-title' }, metricSummary(m) || '—'),
          el('div', { class: 'row-sub' }, formatDate(m.date, { month: 'short', day: 'numeric', year: 'numeric' }), m.notes ? ` · ${m.notes}` : ''),
        ),
      ));
    }
    root.appendChild(card);
  }
  root.appendChild(heatmapSection());
}

// Today's header: a dot per planned session this week — filled when done,
// ringed for today — and "2 of 3 this week". Weekly counts only: no streaks.
function weekDots(today) {
  const start = weekStartOf(today, weekStartDay());
  const c = sessionCounts({
    start, end: addDays(start, 6), plans: store.get('plans'), logs: store.get('logs'),
    matches: store.get('matches'), records: store.get('sessions'), schedule: store.get('schedule'),
  });
  if (!c.planned) return null;
  return el('div', { class: 'week-dots', 'aria-label': `${c.completed} of ${c.planned} sessions this week` },
    el('span', { class: 'wdots', 'aria-hidden': 'true' },
      c.each.map((x) => el('span', { class: `wdot${x.completed ? ' done' : x.date === today ? ' current' : ''}` }))),
    el('span', { class: 'wdots-text' }, `${c.completed} of ${c.planned} this week`));
}

// ---------- Weekly review (js/review.js) ----------

const weekStartDay = () => {
  try { return localStorage.getItem('ft.weekStart') === 'sun' ? 'sun' : 'mon'; } catch { return 'mon'; }
};
const lastWeekStart = (today) => addDays(weekStartOf(today, weekStartDay()), -7);
const markReviewSeen = (start) => { try { localStorage.setItem('ft.reviewSeen', start); } catch { /* blocked */ } };

function reviewData(weekStart, today) {
  return weeklyReview({
    weekStart, today,
    plans: store.get('plans'), logs: store.get('logs'), activities: store.getActivityEntries(),
    metrics: store.get('metrics'), goals: store.get('goals'), sessionsRecords: store.get('sessions'),
    matches: store.get('matches'), exercises: store.get('exercises'), schedule: store.get('schedule'),
    units: weightUnit() === 'lb' ? 'imperial' : 'metric',
  });
}

// On Today: last week's review is ready and hasn't been looked at.
function reviewBanner(today) {
  const start = lastWeekStart(today);
  let seen = null;
  try { seen = localStorage.getItem('ft.reviewSeen'); } catch { /* blocked */ }
  if (seen && seen >= start) return null;
  const end = addDays(start, 6);
  const anything = store.get('logs').some((l) => l.date >= start && l.date <= end)
    || store.get('sessions').some((r) => r.date >= start && r.date <= end)
    || reviewData(start, today).sessions.planned > 0;
  if (!anything) return null;
  return el('div', { class: 'card review-banner', dataset: { banner: 'review' } },
    el('div', { class: 'row-main tappable', onclick: () => { sub = 'review'; reviewThisWeek = false; render(); } },
      el('div', { class: 'row-title' }, 'Your week in review is ready'),
      el('div', { class: 'row-sub' }, `${formatDate(start, { month: 'short', day: 'numeric' })} – ${formatDate(end, { month: 'short', day: 'numeric' })} · tap to open`)),
    el('button', { class: 'sug-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { markReviewSeen(start); render(); } }, '✕'));
}

const fmtShort = (ds) => formatDate(ds, { month: 'short', day: 'numeric' });

function prText(pr) {
  const w = (kg) => formatWeight(weightUnit() === 'lb' ? kg : Math.round(kg * 10) / 10);
  if (pr.kind === 'weight') return [pr.exercise.name, `Heaviest for ${pr.minReps}+ reps: ${w(pr.value)} (was ${w(pr.was)})`];
  if (pr.kind === 'hold') return [pr.exercise.name, `Longest hold${pr.levelName ? ` (${pr.levelName})` : ''}: ${holdText(pr.value)} (was ${holdText(pr.was)})`];
  if (pr.kind === 'variant') return [pr.exercise.name, `New level: ${pr.valueName} (was ${pr.wasName})`];
  if (pr.kind === 'reps') {
    const at = pr.weightKg > 0 ? w(pr.weightKg) : pr.levelName ?? 'bodyweight';
    return [pr.exercise.name, `Most reps at ${at}: ${pr.value} (was ${pr.was})`];
  }
  if (pr.kind === 'distance') return [pr.sportLabel, `Longest: ${formatDistance(pr.value)} (was ${formatDistance(pr.was)})`];
  return [pr.sportLabel, `Longest time: ${formatDuration(pr.value)} (was ${formatDuration(pr.was)})`];
}

function renderReview() {
  // Desktop: the same cards in two columns — what happened on the left;
  // what's ready, volume, weight and cardio on the right. The card code
  // appends to `root`, so it's pointed at each column in turn.
  const page = root;
  const desktop = isDesktop();
  let left = page;
  let right = page;
  try {
    renderReviewCards(desktop, () => {
      if (!desktop) return;
      left = el('div', { class: 'col-half' });
      right = el('div', { class: 'col-half' });
      page.appendChild(el('div', { class: 'two-col review-cols' }, left, right));
    }, (col) => { root = col === 'left' ? left : right; });
  } finally {
    root = page;
  }
}

function renderReviewCards(desktop, makeColumns, useColumn) {
  const today = todayStr();
  const start = reviewThisWeek ? weekStartOf(today, weekStartDay()) : lastWeekStart(today);
  if (!reviewThisWeek) markReviewSeen(start);
  const r = reviewData(start, today);

  root.appendChild(el('div', { class: 'section-head' },
    el('div', {},
      el('h2', { class: 'section-title' }, reviewThisWeek ? 'This week' : 'Last week'),
      el('div', { class: 'row-sub' }, `${fmtShort(r.week.start)} – ${fmtShort(r.week.end)}${reviewThisWeek ? ' · so far' : ''}`)),
    el('button', { class: 'link-btn', type: 'button', onclick: () => { reviewThisWeek = !reviewThisWeek; render(); } },
      reviewThisWeek ? 'Last week' : 'This week so far')));

  makeColumns();
  useColumn('left');
  // The one thing.
  root.appendChild(el('div', { class: `card rec-card ${r.recommendation.severity}`, dataset: { rec: r.recommendation.id } },
    el('div', { class: 'rec-kicker' }, reviewThisWeek ? 'One thing so far' : 'One thing for this week'),
    el('div', { class: 'rec-text' }, r.recommendation.text),
    r.recommendation.id === 'progress' ? el('div', { class: 'row-sub' }, 'The suggestions are waiting on Today, with the reason for each.') : null));

  // Sessions: a bar per planned session — no streaks, no pass/fail.
  const s = r.sessions;
  root.appendChild(el('div', { class: 'card' },
    el('div', { class: 'review-head' }, el('span', { class: 'row-sub' }, 'Sessions'),
      el('span', { class: 'review-big' }, `${s.completed} of ${s.planned}`)),
    s.planned
      ? el('div', { class: 'session-bars' }, s.each.map((x) => el('div', { class: `sbar${x.completed ? ' done' : ''}` },
        el('div', { class: 'sbar-fill' }),
        el('div', { class: 'sbar-label' }, x.completed ? (x.kind === 'minimum' ? 'Minimum' : 'Full') : x.date > today ? 'Ahead' : 'Not logged'),
        desktop && el('div', { class: 'sbar-label' }, formatDate(x.date, { weekday: 'short', month: 'short', day: 'numeric' })))))
      : el('div', { class: 'row-sub' }, 'Nothing was planned.')));

  // Personal bests: five, the rest folded away.
  if (r.prs.length) {
    const row = (pr) => {
      const [title, sub] = prText(pr);
      return el('div', { class: 'list-row pr-row' },
        el('span', { class: 'pr-star', 'aria-hidden': 'true' }, '☆'),
        el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, title), el('div', { class: 'row-sub' }, sub)));
    };
    const card = el('div', { class: 'card' },
      el('div', { class: 'review-head' }, el('span', { class: 'row-sub' }, 'Personal bests'),
        el('span', { class: 'row-sub' }, `${r.prs.length} this week`)),
      r.prs.slice(0, 5).map(row));
    if (r.prs.length > 5) card.appendChild(el('details', {}, el('summary', { class: 'link-btn' }, `${r.prs.length - 5} more`), r.prs.slice(5).map(row)));
    root.appendChild(card);
  }

  useColumn('right');
  // Desktop: what's ready to progress, with the evidence for each.
  if (desktop && r.ready.length) {
    root.appendChild(el('div', { class: 'card', dataset: { card: 'ready' } },
      el('div', { class: 'review-head' }, el('span', { class: 'row-sub' }, 'Ready to progress')),
      r.ready.map(({ exercise, suggestion }) => el('div', { class: 'list-row' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, exercise.name),
          el('div', { class: 'row-sub' }, suggestion.reason)),
        el('span', { class: 'ready-try' }, `${arrowOf(suggestion)} ${suggestionTitle(suggestion, exercise)}`)))));
  }

  // Weight trend.
  if (r.weight) {
    const u = weightUnit();
    const d = (kg) => (u === 'lb' ? kg * 2.20462262 : kg).toFixed(1);
    root.appendChild(el('div', { class: 'card review-weight' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-sub' }, 'Weight trend'),
        el('div', { class: 'review-big' }, `${d(r.weight.startKg)} → ${d(r.weight.endKg)} ${u}`)),
      r.weight.rate && el('div', { class: 'row-sub', style: 'text-align:right' },
        `${signed((u === 'lb' ? 2.20462262 : 1) * r.weight.rate.slopeKgPerWeek)} ${u}/wk`, el('br'), 'over 28 days')));
  }

  // Training volume: hard sets per muscle group, for information only.
  if (r.volume.length) {
    root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'review-head' }, el('span', { class: 'row-sub' }, 'Sets per muscle group'), el('span', { class: 'row-sub' }, 'vs week before')),
      r.volume.map((v) => el('div', { class: 'list-row' },
        el('div', { class: 'row-main' }, v.label),
        el('div', { class: 'row-sub' }, `${v.sets}${v.delta ? ` (${v.delta > 0 ? '+' : '−'}${Math.abs(v.delta)})` : ''}`)))));
  }
  if (r.cardio.sessions) {
    root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'review-head' }, el('span', { class: 'row-sub' }, 'Cardio'),
        el('span', { class: 'row-sub' }, `${r.cardio.sessions} session${r.cardio.sessions === 1 ? '' : 's'}`)),
      el('div', {}, [r.cardio.distanceM ? formatDistance(r.cardio.distanceM) : null, r.cardio.movingSec ? formatDuration(r.cardio.movingSec) : null]
        .filter(Boolean).join(' · ') || '—')));
  }
}

// ---------- Weight trend (js/trend.js) ----------
//
// The headline is the trend, not today's number: daily weight swings by a
// kilo or two with water and food, and reacting to that is demoralising and
// meaningless. Today's weigh-in is shown smaller, with a neutral difference
// from the trend — no red or green on a raw weight anywhere.

const toDispW = (kg) => (weightUnit() === 'lb' ? kg * 2.20462262 : kg);
const w1 = (kg) => (Math.round(toDispW(kg) * 10) / 10).toFixed(1);
const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;

function renderWeightTrend(metrics) {
  const unit = weightUnit();
  const pts = weightPoints(metrics);
  root.appendChild(el('div', { class: 'section-head' },
    el('h2', { class: 'section-title' }, 'Weight'),
    el('div', { class: 'range-pills', role: 'group', 'aria-label': 'Chart range' },
      [[4, '4 wk'], [12, '12 wk'], [0, 'All']].map(([n, label]) => el('button', {
        class: weightWeeks === n ? 'active' : '', type: 'button', onclick: () => { weightWeeks = n; render(); },
      }, label)))));
  if (!pts.length) {
    root.appendChild(el('div', { class: 'card' },
      el('p', { class: 'muted', style: 'margin:0 0 10px' }, 'No weigh-ins yet. Log one on Today, or here.'),
      el('button', { class: 'btn small', onclick: () => logBodyMetric() }, '+ Log metrics')));
    return;
  }
  const series = trendSeries(pts);
  const latest = series.at(-1);
  const todays = series.find((p) => p.date === todayStr());
  const swing = unit === 'lb' ? 'A pound or two either way is mostly water, not fat.' : 'Daily swings of 1–2 kg are mostly water, not fat.';
  root.appendChild(el('div', { class: 'card trend-card' },
    el('div', { class: 'row-sub' }, 'Trend weight'),
    el('div', { class: 'trend-value' }, w1(latest.trendKg), el('span', { class: 'trend-unit' }, ` ${unit}`)),
    todays && el('div', { class: 'today-chip' },
      `Today ${w1(todays.kg)} ${unit} · ${signed(toDispW(todays.kg - todays.trendKg))} vs trend`),
    el('div', { class: 'row-sub', style: 'margin-top:8px' }, swing),
  ));

  const from = weightWeeks ? addDays(todayStr(), -weightWeeks * 7) : '';
  const shown = series.filter((p) => p.date >= from);
  const x = (ds) => parseDateStr(ds).getTime();
  root.appendChild(el('div', { class: 'card chart-card' },
    lineChart({
      points: shown.map((p) => ({ x: x(p.date), y: toDispW(p.trendKg), title: `${p.date}: trend ${w1(p.trendKg)} ${unit}` })),
      dots: shown.map((p) => ({ x: x(p.date), y: toDispW(p.kg), title: `${p.date}: ${w1(p.kg)} ${unit}` })),
      yLabel: unit,
      yFormat: (v) => String(Math.round(v)),
    }),
    el('div', { class: 'chart-legend' },
      el('span', {}, el('span', { class: 'lg-dot' }), ' Daily weigh-in'),
      el('span', {}, el('span', { class: 'lg-line' }), ' Trend')),
  ));

  const rate = trendSlope(pts, { windowDays: 28 });
  const label = rateLabel(rate, latest.trendKg);
  const goal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
  const eta = goal && rate ? etaToGoal(latest.trendKg, goal.targetWeight, rate.slopeKgPerWeek, rate.seKgPerWeek) : null;
  root.appendChild(el('div', { class: 'stat-row trend-stats' },
    el('div', { class: 'stat-tile', dataset: { stat: 'rate' } },
      el('div', { class: 'stat-label' }, 'Rate, last 28 days'),
      rate
        ? [el('div', { class: 'stat-value' }, `${signed(toDispW(rate.slopeKgPerWeek))} ${unit}/wk`),
          el('div', { class: 'stat-label' }, `±${toDispW(rate.seKgPerWeek).toFixed(1)} · from ${rate.n} weigh-ins`),
          label?.flat ? el('div', { class: 'stat-label' }, 'Flat — within the noise') : null,
          label?.fast ? el('div', { class: 'stat-label attention' }, 'Faster than about 1%/week') : null]
        : el('div', { class: 'stat-label', style: 'margin-top:6px' }, 'Not enough data yet (needs 10 weigh-ins over 2+ weeks)'),
    ),
    goal && el('div', { class: 'stat-tile', dataset: { stat: 'goal' } },
      el('div', { class: 'stat-label' }, `To goal (${w1(goal.targetWeight).replace(/\.0$/, '')} ${unit})`),
      el('div', { class: 'stat-value' }, `${Math.abs(toDispW(latest.trendKg - goal.targetWeight)).toFixed(1)} ${unit}`),
      el('div', { class: 'stat-label' }, eta == null ? 'No clear rate toward it yet'
        : eta === 0 ? 'There' : `About ${Math.round(eta)} week${Math.round(eta) === 1 ? '' : 's'} at this rate (rough)`)),
  ));
  root.appendChild(el('p', { class: 'muted footnote' },
    'Rate is a straight-line fit to raw weigh-ins. The trend line smooths them but is not used for the rate.'));
  root.appendChild(el('button', { class: 'btn small secondary', style: 'margin-bottom:18px', onclick: () => logBodyMetric() }, '+ Log metrics'));
}

// ---------- Metrics on desktop ----------
//
// One metric at a time (Weight | Waist | Resting HR | Run pace): its chart
// and numbers in the main column, its recent entries as a table beside it.
// Session counts and the routes heatmap follow, full width.

function renderMetricsDesktop(metrics) {
  const unit = weightUnit();
  const tabs = [['weight', 'Weight'], ['waist', 'Waist'], ['restingHr', 'Resting HR'], ['pace', 'Run pace']];
  root.appendChild(el('div', { class: 'section-head' },
    el('div', { class: 'metric-tabs', role: 'tablist', 'aria-label': 'Metric' },
      tabs.map(([id, label]) => el('button', {
        class: metricTab === id ? 'active' : '', role: 'tab', type: 'button', 'aria-selected': String(metricTab === id),
        dataset: { metric: id }, onclick: () => { metricTab = id; render(); },
      }, label))),
    el('div', { class: 'range-pills', role: 'group', 'aria-label': 'Chart range' },
      [[4, '4 wk'], [12, '12 wk'], [0, 'All']].map(([n, label]) => el('button', {
        class: weightWeeks === n ? 'active' : '', type: 'button', onclick: () => { weightWeeks = n; render(); },
      }, label)))));

  const from = weightWeeks ? addDays(todayStr(), -weightWeeks * 7) : '';
  const x = (ds) => parseDateStr(ds).getTime();
  const main = el('div', { class: 'col-main' });
  const side = el('aside', { class: 'col-side' });
  root.appendChild(el('div', { class: 'two-col' }, main, side));
  const table = (title, head, rows) => el('section', { class: 'card side-card', dataset: { side: 'recent' } },
    el('div', { class: 'side-head' }, el('span', {}, title)),
    rows.length
      ? el('table', { class: 'data-table' },
        el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i ? 'num' : '' }, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => el('td', { class: i ? 'num' : '' }, c))))))
      : el('p', { class: 'muted', style: 'margin:0' }, 'Nothing logged yet.'));
  const shortDate = (d) => formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' });

  if (metricTab === 'weight') {
    const pts = weightPoints(metrics);
    if (!pts.length) {
      main.appendChild(el('div', { class: 'card' }, el('p', { class: 'muted', style: 'margin:0' }, 'No weigh-ins yet. Log one on Today.')));
    } else {
      const series = trendSeries(pts);
      const latest = series.at(-1);
      const todays = series.find((p) => p.date === todayStr());
      const rate = trendSlope(pts, { windowDays: 28 });
      const label = rateLabel(rate, latest.trendKg);
      const goal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
      const eta = goal && rate ? etaToGoal(latest.trendKg, goal.targetWeight, rate.slopeKgPerWeek, rate.seKgPerWeek) : null;
      main.appendChild(el('div', { class: 'tile-row' },
        el('section', { class: 'card trend-card', style: 'flex:1 1 280px' },
          el('div', { class: 'row-sub' }, 'Trend weight'),
          el('div', { class: 'trend-value' }, w1(latest.trendKg), el('span', { class: 'trend-unit' }, ` ${unit}`)),
          todays && el('div', { class: 'today-chip' }, `Today ${w1(todays.kg)} ${unit} · ${signed(toDispW(todays.kg - todays.trendKg))} vs trend`),
          el('div', { class: 'row-sub', style: 'margin-top:8px' },
            unit === 'lb' ? 'A pound or two either way is mostly water, not fat.' : 'Daily swings of 1–2 kg are mostly water, not fat.')),
        el('section', { class: 'card stat-card', dataset: { stat: 'rate' } },
          el('div', { class: 'stat-label' }, 'Rate, last 28 days'),
          rate
            ? [el('div', { class: 'stat-value' }, `${signed(toDispW(rate.slopeKgPerWeek))} ${unit}/wk`),
              el('div', { class: 'stat-label' }, `±${toDispW(rate.seKgPerWeek).toFixed(1)} · from ${rate.n} weigh-ins`),
              label?.flat ? el('div', { class: 'stat-label' }, 'Flat — within the noise') : null,
              label?.fast ? el('div', { class: 'stat-label attention' }, 'Faster than about 1%/week') : null]
            : el('div', { class: 'stat-label', style: 'margin-top:6px' }, 'Not enough data yet (10 weigh-ins over 2+ weeks)')),
        goal && el('section', { class: 'card stat-card', dataset: { stat: 'goal' } },
          el('div', { class: 'stat-label' }, `To goal (${w1(goal.targetWeight).replace(/\.0$/, '')} ${unit})`),
          el('div', { class: 'stat-value' }, `${Math.abs(toDispW(latest.trendKg - goal.targetWeight)).toFixed(1)} ${unit}`),
          el('div', { class: 'stat-label' }, eta == null ? 'No clear rate toward it yet'
            : eta === 0 ? 'There' : `About ${Math.round(eta)} week${Math.round(eta) === 1 ? '' : 's'} at this rate (rough)`))));
      const shown = series.filter((p) => p.date >= from);
      main.appendChild(el('section', { class: 'card chart-card' },
        lineChart({
          points: shown.map((p) => ({ x: x(p.date), y: toDispW(p.trendKg), title: `${p.date}: trend ${w1(p.trendKg)} ${unit}` })),
          dots: shown.map((p) => ({ x: x(p.date), y: toDispW(p.kg), title: `${p.date}: ${w1(p.kg)} ${unit}` })),
          width: 760, height: 300, yLabel: unit, yFormat: (v) => String(Math.round(v)),
        }),
        el('div', { class: 'chart-legend' },
          el('span', {}, el('span', { class: 'lg-dot' }), ' Daily weigh-in'),
          el('span', {}, el('span', { class: 'lg-line' }), ' Trend (smoothed)'))));
      main.appendChild(el('p', { class: 'muted footnote' },
        'Rate is a straight-line fit to raw weigh-ins. The trend line smooths them but is not used for the rate.'));
      side.appendChild(table(`Recent weigh-ins (${unit})`, ['Date', 'Weigh-in', 'Trend', 'vs trend'],
        [...series].reverse().slice(0, 12).map((p) => [shortDate(p.date), w1(p.kg), w1(p.trendKg), signed(toDispW(p.kg - p.trendKg))])));
    }
  } else if (metricTab === 'pace') {
    const runs = runningActivities().filter((r) => r.distanceM && r.movingSec && r.date >= from);
    main.appendChild(el('section', { class: 'card chart-card' }, el('h3', { style: 'margin-top:0' }, 'Pace'),
      lineChart({
        points: datePoints(runs, (r) => paceChartValue(r.distanceM, r.movingSec), (r) => `${r.date}: ${formatPace(r.distanceM, r.movingSec)}`),
        width: 760, height: 260, yLabel: `min${paceUnit()} (lower = faster)`, yFormat: (v) => v.toFixed(1), invertY: true,
      })));
    main.appendChild(el('section', { class: 'card chart-card' }, el('h3', { style: 'margin-top:0' }, 'Distance'),
      lineChart({
        points: datePoints(runs, (r) => distanceToInput(r.distanceM), (r) => `${r.date}: ${formatDistance(r.distanceM)}`),
        width: 760, height: 200, yLabel: distanceUnit(), yFormat: (v) => v.toFixed(1),
      })));
    side.appendChild(table('Recent runs', ['Date', 'Distance', 'Pace'],
      [...runs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12)
        .map((r) => [shortDate(r.date), formatDistance(r.distanceM), formatPace(r.distanceM, r.movingSec)])));
  } else {
    const m = BODY_METRICS.find((b) => b.id === metricTab);
    const res = resolveMetric(m);
    const rows = metrics.filter((r) => r[m.id] != null);
    main.appendChild(el('section', { class: 'card chart-card' },
      lineChart({
        points: datePoints(rows.filter((r) => r.date >= from), (r) => res.toInput(r[m.id]), (r) => `${r.date}: ${res.toInput(r[m.id])} ${res.unit}`),
        width: 760, height: 280, yLabel: res.unit, yFormat: (v) => (res.step >= 1 ? String(Math.round(v)) : v.toFixed(1)),
      })));
    side.appendChild(table(`Recent ${m.label.toLowerCase()} (${res.unit})`, ['Date', m.label],
      [...rows].reverse().slice(0, 12).map((r) => [shortDate(r.date), String(res.toInput(r[m.id]))])));
  }
  main.appendChild(el('button', { class: 'btn small secondary', type: 'button', onclick: () => logBodyMetric() }, '+ Log metrics'));

  // Sessions as counts, then the routes map.
  const end = addDays(weekStartOf(todayStr(), weekStartDay()), 6);
  const eight = sessionCounts({
    start: addDays(end, -55), end: todayStr(), plans: store.get('plans'), logs: store.get('logs'),
    matches: store.get('matches'), records: store.get('sessions'), schedule: store.get('schedule'),
  });
  root.appendChild(el('div', { class: 'stat-row', style: 'margin-top:20px' },
    el('div', { class: 'stat-tile', dataset: { stat: 'sessions8' } },
      el('div', { class: 'stat-label' }, 'Last 8 weeks'),
      el('div', { class: 'stat-value' }, `${eight.completed} of ${eight.planned}`),
      el('div', { class: 'stat-label' }, 'sessions')),
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-label' }, 'Last 30 days'),
      el('div', { class: 'stat-value' }, String(logCount(30))),
      el('div', { class: 'stat-label' }, 'activities logged'))));
  root.appendChild(heatmapSection());
}

function runningActivities() {
  const out = [];
  for (const e of store.getActivityEntries()) {
    if (sportMapping(e.type).modality === 'run') out.push(e);
  }
  const lib = exById();
  for (const l of store.get('logs')) {
    const ex = lib.get(l.exerciseId);
    if (ex?.modality === 'run' && l.actual?.distanceM) {
      out.push({ date: l.date, distanceM: l.actual.distanceM, movingSec: l.actual.movingSec });
    }
  }
  return out;
}

function logCount(days) {
  const from = addDays(todayStr(), -days);
  return store.get('logs').filter((l) => l.date >= from).length
    + store.getActivityEntries().filter((e) => e.date >= from).length;
}

// Planned exercises due in [today-days, today] vs. those actually completed
// (a linked manual log, or a confirmed activity match).
function adherence(days) {
  const from = addDays(todayStr(), -days);
  const to = todayStr();
  const loggedPe = new Set(store.get('logs').filter((l) => l.plannedExerciseId).map((l) => l.plannedExerciseId));
  const confirmedPe = new Set(store.get('matches').filter((m) => m.status === 'confirmed' && m.plannedExerciseId).map((m) => m.plannedExerciseId));
  let planned = 0;
  let done = 0;
  for (const { session, date: d, skipped, repeat } of occurrences(store.get('plans'), store.get('schedule'))) {
    if (skipped || repeat || d < from || d > to) continue;
    for (const { item } of sessionItems(session)) {
      if (item.optional) continue; // skipping optional work isn't non-adherence
      planned++;
      if (loggedPe.has(item.id) || confirmedPe.has(item.id)) done++;
    }
  }
  return { done, planned };
}

function logBodyMetric(existing = null) {
  const entry = existing ? { ...existing } : makeBodyMetric();
  const dateIn = el('input', { type: 'date', value: entry.date });
  const inputs = new Map(BODY_METRICS.map((m) => {
    const res = resolveMetric(m);
    return [m.id, el('input', {
      type: 'number', inputmode: 'decimal', step: res.step,
      value: res.toInput(entry[m.id]) ?? '',
    })];
  }));
  const notesIn = el('input', { value: entry.notes ?? '', placeholder: 'optional' });
  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        const values = {};
        for (const m of BODY_METRICS) {
          const v = parseFloat(inputs.get(m.id).value);
          values[m.id] = isNaN(v) ? null : resolveMetric(m).fromInput(v);
        }
        if (Object.values(values).every((v) => v == null)) {
          toast('Enter at least one measurement', 'error');
          return false;
        }
        Object.assign(entry, values, { date: dateIn.value || todayStr(), notes: notesIn.value.trim() });
        store.upsert('metrics', entry);
      },
    },
  ];
  if (existing) {
    actions.unshift({
      label: 'Delete', class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog('Delete this entry?'))) return false;
        store.remove('metrics', entry.id);
      },
    });
  }
  const metricFields = BODY_METRICS.map((m) =>
    el('div', { class: 'field' }, el('label', {}, `${m.label} (${resolveMetric(m).unit})`), inputs.get(m.id)));
  openModal('Body metrics', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Date'), dateIn),
    el('div', { class: 'field-row' }, metricFields.slice(0, 2)),
    el('div', { class: 'field-row' }, metricFields.slice(2)),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notesIn),
  ), actions);
}

// Summary like "82.0 kg · 15.2 % · 48 bpm" for the entries list,
// in the user's display units.
function metricSummary(entry) {
  return BODY_METRICS
    .filter((m) => entry[m.id] != null)
    .map((m) => {
      const res = resolveMetric(m);
      return `${res.toInput(entry[m.id])} ${res.unit}`;
    })
    .join(' · ');
}

// ---------- Heatmap ----------

// A section at the bottom of Metrics. Leaflet and the routes load only when
// the section scrolls near the screen, so opening Metrics stays quick.
function heatmapSection() {
  const container = el('div', { class: 'heatmap-container' }, el('p', { class: 'muted', style: 'padding:16px' }, 'Map loads when you scroll here…'));
  const section = el('div', { class: 'heatmap-section' }, el('h3', {}, 'Routes heatmap'), container);
  let started = false;
  const start = () => {
    if (started || !container.isConnected) return;
    started = true;
    observer?.disconnect();
    renderHeatmap(container);
  };
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) start(); }, { rootMargin: '300px' })
    : null;
  if (observer) observer.observe(container);
  else setTimeout(start, 0);
  return section;
}

async function renderHeatmap(container) {
  container.innerHTML = '';
  container.appendChild(el('p', { class: 'muted', style: 'padding:16px' }, 'Loading map…'));
  const entries = store.getActivityEntries().filter((e) => e.gpsPolyline);
  if (!entries.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('No GPS routes yet. Sync Polar, or import a GPX/TCX file from History.'));
    return;
  }
  const mod = await import('./heatmap-view.js');
  if (!container.isConnected) return; // switched away while Leaflet loaded
  const instance = await mod.show(container, entries);
  // A re-render may have replaced the container while the map was building.
  if (container.isConnected) heatmapMod = instance;
  else instance.destroy();
}
