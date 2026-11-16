// Logs → Metrics: weight trend and charts, body metrics, adherence, pace,
// and the GPS heatmap.
import * as store from '../../storage/store.js';
import { isDesktop } from '../layout.js';
import { addDays, formatDate, parseDateStr, todayStr } from '../../dates.js';
import { sessionCounts, weekStartOf } from '../../review.js';
import { weekStartDay } from './review.js';
import { confirmDialog, el, emptyState, openModal, toast } from '../components.js';
import { BODY_METRICS, sportMapping } from '../../config.js';
import { distanceToInput, distanceUnit, formatDistance, formatPace, paceChartValue, paceUnit, resolveMetric, weightUnit } from '../../units.js';
import { datePoints, lineChart } from '../../charts.js';
import { etaToGoal, rateLabel, trendSeries, trendSlope, weightPoints } from '../../trend.js';
import { exById, render } from '../logs-tab.js';
import { occurrences } from '../../schedule.js';
import { makeBodyMetric, sessionItems } from '../../models.js';
import { S } from './state.js';

// ---------- Metrics ----------

export function renderMetrics() {
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
  const { done, planned } = adherence(S.adherenceDays);
  S.root.appendChild(el('div', { class: 'stat-row' },
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
    S.root.appendChild(el('p', { class: 'muted footnote' }, `Planned exercises logged, last 30 days: ${done} of ${planned}.`));
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
    S.root.appendChild(el('h3', {}, m.label));
    S.root.appendChild(lineChart({
      points,
      yLabel: res.unit,
      yFormat: (v) => (res.step >= 1 ? String(Math.round(v)) : v.toFixed(1)),
    }));
  }

  // Running pace + distance from all sources
  const runs = runningActivities();
  S.root.appendChild(el('h3', {}, 'Running pace'));
  S.root.appendChild(lineChart({
    points: datePoints(runs.filter((r) => r.distanceM && r.movingSec),
      (r) => paceChartValue(r.distanceM, r.movingSec),
      (r) => `${r.date}: ${formatPace(r.distanceM, r.movingSec)} · ${formatDistance(r.distanceM)}`),
    yLabel: `min${paceUnit()} (lower = faster)`,
    yFormat: (v) => v.toFixed(1),
    invertY: true,
  }));
  S.root.appendChild(el('h3', {}, 'Running distance'));
  S.root.appendChild(lineChart({
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
    S.root.appendChild(card);
  }
  S.root.appendChild(heatmapSection());
}

// ---------- Weight trend (js/trend.js) ----------
//
// The headline is the trend, not today's number: daily weight swings by a
// kilo or two with water and food, and reacting to that is demoralising and
// meaningless. Today's weigh-in is shown smaller, with a neutral difference
// from the trend — no red or green on a raw weight anywhere.

export const toDispW = (kg) => (weightUnit() === 'lb' ? kg * 2.20462262 : kg);
export const w1 = (kg) => (Math.round(toDispW(kg) * 10) / 10).toFixed(1);
export const signed = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;

export function renderWeightTrend(metrics) {
  const unit = weightUnit();
  const pts = weightPoints(metrics);
  S.root.appendChild(el('div', { class: 'section-head' },
    el('h2', { class: 'section-title' }, 'Weight'),
    el('div', { class: 'range-pills', role: 'group', 'aria-label': 'Chart range' },
      [[4, '4 wk'], [12, '12 wk'], [0, 'All']].map(([n, label]) => el('button', {
        class: S.weightWeeks === n ? 'active' : '', type: 'button', onclick: () => { S.weightWeeks = n; render(); },
      }, label)))));
  if (!pts.length) {
    S.root.appendChild(el('div', { class: 'card' },
      el('p', { class: 'muted', style: 'margin:0 0 10px' }, 'No weigh-ins yet. Log one on Today, or here.'),
      el('button', { class: 'btn small', onclick: () => logBodyMetric() }, '+ Log metrics')));
    return;
  }
  const series = trendSeries(pts);
  const latest = series.at(-1);
  const todays = series.find((p) => p.date === todayStr());
  const swing = unit === 'lb' ? 'A pound or two either way is mostly water, not fat.' : 'Daily swings of 1–2 kg are mostly water, not fat.';
  S.root.appendChild(el('div', { class: 'card trend-card' },
    el('div', { class: 'row-sub' }, 'Trend weight'),
    el('div', { class: 'trend-value' }, w1(latest.trendKg), el('span', { class: 'trend-unit' }, ` ${unit}`)),
    todays && el('div', { class: 'today-chip' },
      `Today ${w1(todays.kg)} ${unit} · ${signed(toDispW(todays.kg - todays.trendKg))} vs trend`),
    el('div', { class: 'row-sub', style: 'margin-top:8px' }, swing),
  ));

  const from = S.weightWeeks ? addDays(todayStr(), -S.weightWeeks * 7) : '';
  const shown = series.filter((p) => p.date >= from);
  const x = (ds) => parseDateStr(ds).getTime();
  S.root.appendChild(el('div', { class: 'card chart-card' },
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
  S.root.appendChild(el('div', { class: 'stat-row trend-stats' },
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
  S.root.appendChild(el('p', { class: 'muted footnote' },
    'Rate is a straight-line fit to raw weigh-ins. The trend line smooths them but is not used for the rate.'));
  S.root.appendChild(el('button', { class: 'btn small secondary', style: 'margin-bottom:18px', onclick: () => logBodyMetric() }, '+ Log metrics'));
}

// ---------- Metrics on desktop ----------
//
// One metric at a time (Weight | Waist | Resting HR | Run pace): its chart
// and numbers in the main column, its recent entries as a table beside it.
// Session counts and the routes heatmap follow, full width.

export function renderMetricsDesktop(metrics) {
  const unit = weightUnit();
  const tabs = [['weight', 'Weight'], ['waist', 'Waist'], ['restingHr', 'Resting HR'], ['pace', 'Run pace']];
  S.root.appendChild(el('div', { class: 'section-head' },
    el('div', { class: 'metric-tabs', role: 'tablist', 'aria-label': 'Metric' },
      tabs.map(([id, label]) => el('button', {
        class: S.metricTab === id ? 'active' : '', role: 'tab', type: 'button', 'aria-selected': String(S.metricTab === id),
        dataset: { metric: id }, onclick: () => { S.metricTab = id; render(); },
      }, label))),
    el('div', { class: 'range-pills', role: 'group', 'aria-label': 'Chart range' },
      [[4, '4 wk'], [12, '12 wk'], [0, 'All']].map(([n, label]) => el('button', {
        class: S.weightWeeks === n ? 'active' : '', type: 'button', onclick: () => { S.weightWeeks = n; render(); },
      }, label)))));

  const from = S.weightWeeks ? addDays(todayStr(), -S.weightWeeks * 7) : '';
  const x = (ds) => parseDateStr(ds).getTime();
  const main = el('div', { class: 'col-main' });
  const side = el('aside', { class: 'col-side' });
  S.root.appendChild(el('div', { class: 'two-col' }, main, side));
  const table = (title, head, rows) => el('section', { class: 'card side-card', dataset: { side: 'recent' } },
    el('div', { class: 'side-head' }, el('span', {}, title)),
    rows.length
      ? el('table', { class: 'data-table' },
        el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i ? 'num' : '' }, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => el('td', { class: i ? 'num' : '' }, c))))))
      : el('p', { class: 'muted', style: 'margin:0' }, 'Nothing logged yet.'));
  const shortDate = (d) => formatDate(d, { weekday: 'short', month: 'short', day: 'numeric' });

  if (S.metricTab === 'weight') {
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
  } else if (S.metricTab === 'pace') {
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
    const m = BODY_METRICS.find((b) => b.id === S.metricTab);
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
  S.root.appendChild(el('div', { class: 'stat-row', style: 'margin-top:20px' },
    el('div', { class: 'stat-tile', dataset: { stat: 'sessions8' } },
      el('div', { class: 'stat-label' }, 'Last 8 weeks'),
      el('div', { class: 'stat-value' }, `${eight.completed} of ${eight.planned}`),
      el('div', { class: 'stat-label' }, 'sessions')),
    el('div', { class: 'stat-tile' },
      el('div', { class: 'stat-label' }, 'Last 30 days'),
      el('div', { class: 'stat-value' }, String(logCount(30))),
      el('div', { class: 'stat-label' }, 'activities logged'))));
  S.root.appendChild(heatmapSection());
}

export function runningActivities() {
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

export function logCount(days) {
  const from = addDays(todayStr(), -days);
  return store.get('logs').filter((l) => l.date >= from).length
    + store.getActivityEntries().filter((e) => e.date >= from).length;
}

// Planned exercises due in [today-days, today] vs. those actually completed
// (a linked manual log, or a confirmed activity match).
export function adherence(days) {
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

export function logBodyMetric(existing = null) {
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
export function metricSummary(entry) {
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
export function heatmapSection() {
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

export async function renderHeatmap(container) {
  container.innerHTML = '';
  container.appendChild(el('p', { class: 'muted', style: 'padding:16px' }, 'Loading map…'));
  const entries = store.getActivityEntries().filter((e) => e.gpsPolyline);
  if (!entries.length) {
    container.innerHTML = '';
    container.appendChild(emptyState('No GPS routes yet. Sync Polar, or import a GPX/TCX file from History.'));
    return;
  }
  const mod = await import('../heatmap-view.js');
  if (!container.isConnected) return; // switched away while Leaflet loaded
  const instance = await mod.show(container, entries);
  // A re-render may have replaced the container while the map was building.
  if (container.isConnected) S.heatmapMod = instance;
  else instance.destroy();
}
