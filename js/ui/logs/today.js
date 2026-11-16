// Logs → Today: the planned session with its set rows, Finish and the pain
// question, the weigh-in, ad-hoc logging, and the log-entry form.
import { addDays, diffDays, formatDate, formatDateLong, parseDateStr, todayStr } from '../../dates.js';
import { actualSummary, dismissedSug, exById, render } from '../logs-tab.js';
import * as store from '../../storage/store.js';
import { isDesktop } from '../layout.js';
import { el, exerciseLink, filePicker, openModal, toast, undoToast } from '../components.js';
import { reviewBanner, weekDots, weekStartDay } from './review.js';
import { overdueCard } from '../overdue.js';
import { doneItemIds, sessionRecordId, sessionStatus } from '../../sessions.js';
import { occurrences, repeatWeek } from '../../schedule.js';
import { formatWeight, weightFromInput, weightToInput, weightUnit } from '../../units.js';
import { trendSeries, trendSlope, weightPoints } from '../../trend.js';
import { logBodyMetric, metricSummary, signed, toDispW, w1 } from './metrics.js';
import { lineChart } from '../../charts.js';
import { sessionCounts, weekStartOf } from '../../review.js';
import { makeBodyMetric, makeLogEntry, sessionItems } from '../../models.js';
import { defaultGear, hasCardioData, isCardioExercise, sportOf } from '../../cardio.js';
import { ghostSet, lastPerformance, setsOf } from '../../history.js';
import { clearDraft, draftKey, flushDraft, flushItem, forgetLog, readDraft, removeDraftItem, setDraftMode, updateDraftItem } from '../../draft.js';
import { estimateMinutes, minimumSession } from '../../minimum.js';
import { delayDialog, delayLabel } from '../delay.js';
import { restSecondsFor, restSettings, setSessionActive, skipRest, startRest } from '../../rest-timer.js';
import { CLINICIAN_LINE, PAIN_REGIONS, RUN_REGIONS, effectivePain, hasRun, painTwoWeeksRunning, stopLine } from '../../pain.js';
import { CHANGES_GHOSTS, arrowOf, suggestionChip, suggestionFor, suggestionTitle } from '../suggestion.js';
import { pickExercise, targetSummary } from '../plans-tab.js';
import { rowsFromActual, setRows } from '../set-rows.js';
import { holdText } from '../../sets.js';
import { cardioFields } from '../cardio-form.js';
import { variantLevelFor } from '../../load.js';
import { S } from './state.js';

// ---------- Today ----------

export function renderToday() {
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
  const page = S.root;
  let aside = null;
  if (desktop) {
    const main = el('div', { class: 'col-main' });
    aside = el('aside', { class: 'col-side', 'aria-label': 'Today at a glance' });
    page.appendChild(el('div', { class: 'two-col' }, main, aside));
    S.root = main;
  }
  S.openLast = null;
  try {
    renderTodayMain(today, lib, logs, loggedByPe, desktop);
  } finally {
    S.root = page;
  }
  if (aside) renderTodayAside(aside, today);
}

export function renderTodayMain(today, lib, logs, loggedByPe, desktop) {
  S.root.appendChild(el('h2', { class: desktop ? 'page-h1' : '' }, desktop ? 'Today' : formatDateLong(today)));
  if (desktop) S.root.appendChild(el('div', { class: 'row-sub', style: 'margin:-8px 2px 8px' }, formatDateLong(today)));
  const dots = weekDots(today);
  if (dots) S.root.appendChild(dots);
  const overdue = overdueCard(today, { onNotNow: () => render() });
  if (overdue) S.root.appendChild(overdue);
  const banner = reviewBanner(today);
  if (banner) S.root.appendChild(banner);
  if (!desktop) S.root.appendChild(weighInCard(today));

  let anyPlanned = false;
  const finishBars = [];
  const doneIds = doneItemIds(logs, store.get('matches'));
  const records = store.get('sessions');
  for (const occ of occurrences(store.get('plans'), store.get('schedule'))) {
    const { plan, session, week, date, skipped, repeat } = occ;
    if (date !== today || skipped) continue;
    anyPlanned = true;
    const finish = renderSessionToday({ plan, session, week, today, lib, logs, loggedByPe, doneIds, records, repeat, occ });
    if (finish) finishBars.push(finish);
  }
  if (!anyPlanned) S.root.appendChild(nextSessionCard(today));
  S.root.appendChild(el('button', { class: 'btn', onclick: () => adhocLog() }, '+ Log ad-hoc activity'));
  // Last on the page, under the ad-hoc button — in the flow, not pinned to
  // the screen (pinned, it got tapped by thumbs scrolling) — and only once
  // any overdue session is dealt with.
  if (!overdue) for (const bar of finishBars) S.root.appendChild(bar);
}

// Desktop side panel on Today.
export function renderTodayAside(aside, today) {
  aside.appendChild(weighInCard(today));

  if (S.openLast?.perf) {
    aside.appendChild(el('section', { class: 'card side-card', dataset: { side: 'last' } },
      el('div', { class: 'side-head' }, el('span', {}, 'Last time'), el('span', {}, formatDate(S.openLast.perf.date, { month: 'short', day: 'numeric' }))),
      el('div', { class: 'row-sub', style: 'margin-bottom:6px' }, S.openLast.name),
      S.openLast.perf.sets.map((s, i) => el('div', { class: 'side-row' },
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
      onclick: () => { S.sub = 'metrics'; render(); } },
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
export function weighInCard(today) {
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
export function importActivitiesModal() {
  const fileInput = filePicker({ multiple: true });
  const statusEl = el('div', {});
  let modal;

  const run = async () => {
    const files = [...(fileInput.files ?? [])];
    if (!files.length) { toast('Choose one or more .gpx or .tcx files', 'error'); return; }
    statusEl.innerHTML = '';
    statusEl.appendChild(el('p', { class: 'muted' }, `Parsing ${files.length} file${files.length === 1 ? '' : 's'}…`));
    const { parseActivityFile, ParseError } = await import('../../gps.js');
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

export function blockLabel(type) {
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
export function setModeOf(item, ex) {
  if (isCardioExercise(ex)) return null;
  const kind = item.target?.kind ?? (ex?.measurementType === 'duration' ? 'duration' : (ex?.measurementType ?? 'reps'));
  return kind === 'reps' ? 'reps' : kind === 'duration' ? 'timed' : null;
}

export const variantName = (ex, level) => (level != null ? ex?.variants?.find((v) => v.level === level)?.name : null);

// Every prior set of an exercise (before `date`), for sanity checks.
export function priorSets(exerciseId, date, logs) {
  return logs.filter((l) => l.exerciseId === exerciseId && l.date < date).flatMap(setsOf);
}

export function renderSessionToday({ plan, session, week, today, lib, logs, loggedByPe, doneIds, records, repeat = false, occ = null }) {
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
  if (!entries.some((e) => e.item.id === S.expandedItem)) {
    S.expandedItem = rec ? null : entries.find((e) => e.reps && !e.finished)?.item.id ?? null;
  }

  S.root.appendChild(el('div', { class: 'session-head' },
    el('div', { class: 'row-main' },
      el('div', { class: 'session-title' }, session.label || plan.name),
      el('div', { class: 'row-sub' },
        `${plan.name} · week ${week.index}${repeat ? ' (repeat)' : ''}${week.isDeload ? ' (deload)' : ''}`
        + `${session.estimatedDurationMin ? ` · ~${session.estimatedDurationMin} min` : ''}`),
      session.note && el('div', { class: 'row-sub' }, session.note),
      // Not today after all: before anything is logged or ticked.
      occ && !status.completed && !Object.values(draft.items).some((d) => d.rows?.some((r) => r.done))
        && el('button', { class: 'link-btn move-btn', type: 'button', dataset: { action: 'move-tomorrow' }, onclick: () => {
          // Ticking a set doesn't redraw this header, so check again now.
          if (Object.values(readDraft(key).items).some((d) => d.rows?.some((r) => r.done))) {
            toast('You’ve started this one. Untick its sets to move it.', 'error');
            render();
            return;
          }
          delayDialog(occ);
        } },
          delayLabel(today)),
    ),
    status.completed && el('span', { class: 'pill ok' }, status.kind === 'minimum' ? 'done · minimum' : 'done'),
  ));
  if (!status.kind && entries.length) {
    const pick = (m) => () => { setDraftMode(key, m); S.expandedItem = null; render(); };
    S.root.appendChild(el('div', { class: 'segmented session-mode', role: 'group', 'aria-label': 'Session version' },
      el('button', { class: mode === 'full' ? 'active' : '', type: 'button', dataset: { mode: 'full' }, onclick: pick('full') }, 'Full session'),
      el('button', { class: mode === 'minimum' ? 'active' : '', type: 'button', dataset: { mode: 'minimum' }, onclick: pick('minimum') },
        `Minimum · ~${estimateMinutes(session, minimum)} min`)));
    if (mode === 'minimum') {
      S.root.appendChild(el('p', { class: 'muted min-note' },
        'Counts as a completed session. It won’t trigger weight or level increases.'));
    }
  }
  if (!entries.length) S.root.appendChild(el('p', { class: 'muted' }, 'Session has no exercises.'));

  let lastBlock = null;
  for (const e of entries) {
    if (e.block !== lastBlock && ((session.blocks?.length ?? 0) > 1 || e.block.name || e.block.rounds)) {
      S.root.appendChild(el('div', { class: 'block-label' },
        (e.block.name || blockLabel(e.block.type)) + (e.block.rounds ? ` — ${e.block.rounds} rounds` : ''),
        mode === 'minimum' && el('span', { class: 'block-note' }, e.block.unchanged ? ' · unchanged' : ' · half the sets')));
      if (e.block.note) S.root.appendChild(el('div', { class: 'row-sub', style: 'margin:-4px 2px 8px' }, e.block.note));
    }
    lastBlock = e.block;
    S.root.appendChild(exerciseCard({ plan, session, week, today, key, logs, entries, minimumMode: mode === 'minimum', ...e }));
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
export function finishLabel(session, plan) {
  const todays = occurrences(store.get('plans'), store.get('schedule'))
    .filter((o) => o.date === todayStr() && !o.skipped);
  return todays.length > 1 ? `Finish ${session.label || plan.name}` : 'Finish session';
}

export function finishSession(plan, session, date, kind, repeat = false) {
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
  S.expandedItem = null;
  toast('Session finished — nice work');
  painPrompt({ plan, session, date });
}

// ---------- Pain flag (js/pain.js) ----------
//
// One optional question after a session. Picking an answer saves it on the
// session's record (data/sessions.json, encrypted); closing without one
// saves nothing. The plan's injury rule is shown word for word.

export function painPrompt({ plan, session, date }) {
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

export function exerciseCard({ plan, session, week, today, key, logs, entries, block, item, ex, reps, timed = false, log, finished, minimumMode = false }) {
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

  const open = S.expandedItem === item.id;
  if (!open) {
    return el('div', { class: `card ex-card tappable${finished ? ' is-finished' : ''}`, dataset: { item: item.id },
      onclick: () => { S.expandedItem = item.id; render(); } },
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
  S.openLast = { name: ex?.name ?? '', perf };
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
        S.expandedItem = next?.item.id ?? null;
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
export function inferKind(actual) {
  if (!actual) return null;
  if (actual.distanceM != null || actual.movingSec != null) return 'distance';
  if (actual.durationSec != null || actual.holdSec != null || Array.isArray(actual.setHoldSec)) return 'duration';
  if (['sets', 'reps', 'setReps', 'weight', 'setWeights'].some((k) => actual[k] != null)) return 'reps';
  return null;
}

// Picker state round-trips through the modal's Back button so a mis-click
// returns to the same search + scroll position instead of starting over.
export function adhocLog(restore) {
  pickExercise((ex, pickerState) => logEntryModal({ ex, onBack: () => adhocLog(pickerState) }), restore);
}

// Shared entry modal for planned, ad-hoc, and edit flows.
export function logEntryModal({ existing = null, plan = null, session = null, pe = null, ex = null, onBack = null }) {
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
        forgetLog(entry.id);
        undoToast('Log entry deleted', { onUndo: pending.undo, onCommit: pending.commit });
      },
    });
  }
  if (onBack) {
    actions.unshift({ label: '‹ Back', class: 'btn secondary', onClick: () => onBack() });
  }
  openModal(ex?.name ?? 'Log activity', body, actions);
}

// Today with nothing planned: say what's next rather than only "nothing".
export function nextSessionCard(today) {
  const next = occurrences(store.get('plans'), store.get('schedule'))
    .find((o) => !o.skipped && o.date > today);
  if (!next) {
    return el('div', { class: 'card next-session' },
      el('p', { class: 'muted', style: 'margin:0' }, 'Nothing planned for today, and no plan has a session coming up.'));
  }
  const days = diffDays(today, next.date);
  const when = days === 1 ? 'Tomorrow' : `${formatDate(next.date, { weekday: 'long' })}, in ${days} days`;
  const blocks = (next.session.blocks ?? []).flatMap((b) => b.items ?? []).length;
  return el('div', { class: 'card next-session' },
    el('p', { class: 'muted', style: 'margin:0 0 6px' }, 'Nothing planned for today.'),
    el('div', { class: 'row-title' }, `Next: ${next.session.label || 'Session'}`),
    el('div', { class: 'row-sub' },
      [when, formatDate(next.date, { month: 'short', day: 'numeric' }), next.plan.name, blocks ? `${blocks} exercise${blocks === 1 ? '' : 's'}` : '']
        .filter(Boolean).join(' · ')),
  );
}
