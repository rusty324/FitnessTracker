// The progress sections of an exercise's page: Next time, the Load index,
// and RWI history.
import { formatDate, formatDuration, parseDateStr, todayStr } from '../../dates.js';
import { nextPlannedFor } from '../../schedule.js';
import * as store from '../../storage/store.js';
import { suggestionChip, suggestionFor } from '../suggestion.js';
import { el } from '../components.js';
import { formatDistance, formatWeight, weightToInput, weightUnit } from '../../units.js';
import { bestReps, fractionFor, isLoadModel, loadModelOf, longestHold, modelLabel, modelParams, plannedTargetOf, sessionLoadValue, setValues, variantLevelFor } from '../../load.js';
import { RWI_BASIS_LABEL, rwiWork, weightOn } from '../../rwi.js';
import { render } from '../library-tab.js';
import { datePoints, lineChart } from '../../charts.js';
import { formatSets, formatTimedSets, isTimedActual } from '../../sets.js';
import { S } from './state.js';

// ---------- RWI ----------

// ---------- Next time (js/progression.js) ----------

export function nextTimeSection(ex) {
  const today = todayStr();
  const planned = nextPlannedFor(ex.id, store.get('plans'), today, store.get('schedule'));
  const sug = suggestionFor({
    exercise: ex,
    target: planned?.item.target ?? null,
    weekIsDeload: !!planned?.week?.isDeload,
    logs: store.get('logs'),
    plans: store.get('plans'),
    today,
    records: store.get('sessions'),
  });
  if (!sug) return null;
  return el('div', { class: 'card next-time' },
    el('h3', { style: 'margin-top:0' }, 'Next time',
      planned && planned.date >= today
        ? el('span', { class: 'muted', style: 'font-weight:400' }, ` · ${formatDate(planned.date, { weekday: 'short', month: 'short', day: 'numeric' })}`)
        : null),
    suggestionChip(sug, ex, { target: planned?.item.target ?? null }),
  );
}

// ---------- Load index (js/load.js) ----------

// "Scale to goal weight" is a per-browser display choice, like units: the
// stored logs never hold a scaled number.
export const LOAD_SCALE_KEY = 'ft.loadScale';
export function loadScaleOn() {
  try { return localStorage.getItem(LOAD_SCALE_KEY) === '1'; } catch { return false; }
}
export function setLoadScale(on) {
  try {
    if (on) localStorage.setItem(LOAD_SCALE_KEY, '1');
    else localStorage.removeItem(LOAD_SCALE_KEY);
  } catch { /* storage blocked: the toggle just won't stick */ }
}
export const fmtKg = (kg) => formatWeight(Math.round(kg * 10) / 10);
export const DAY_MS = 86400000;

export function loadSection(ex) {
  const model = loadModelOf(ex);
  if (model === 'cardio') return null; // RWI below is the main view for cardio
  const plans = store.get('plans');
  const metrics = store.get('metrics');
  const goal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
  const scale = loadScaleOn();
  const loadBased = isLoadModel(model);
  const timed = model === 'duration';
  const params = modelParams(ex);

  const wrap = el('div', { class: 'load-section' },
    el('h3', {}, loadBased ? 'Load index' : timed ? 'Hold time' : 'Reps'));
  if (loadBased) wrap.appendChild(el('p', { class: 'muted load-model' }, `${modelLabel(ex)} — the best set of each session.`));
  const logs = store.get('logs')
    .filter((l) => l.exerciseId === ex.id)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!logs.length) {
    wrap.appendChild(el('p', { class: 'muted' }, 'No logged sessions yet.'));
    return wrap;
  }

  const rows = logs.map((log) => {
    const level = variantLevelFor(log, plans);
    const variant = level != null ? (ex.variants ?? []).find((v) => v.level === level) ?? null : null;
    const bodyKg = weightOn(log.date, metrics);
    const variantFraction = fractionFor(ex, log, plans);
    const args = { exercise: ex, log, bodyKgOnDay: bodyKg, variantFraction };
    const res = loadBased ? sessionLoadValue({ ...args, goalKg: goal?.targetWeight ?? null, scale }) : null;
    const why = loadBased && !res ? setValues(args).reason : null;
    return { log, level, variant, res, why, fallback: timed ? longestHold(log) : bestReps(log) };
  });
  // Rolling 4-week best, as a second reading in the list.
  for (const r of rows) {
    if (!r.res) continue;
    const t = parseDateStr(r.log.date).getTime();
    r.best4w = Math.max(...rows
      .filter((o) => o.res && t - parseDateStr(o.log.date).getTime() < 28 * DAY_MS && o.log.date <= r.log.date)
      .map((o) => o.res.value));
  }

  if (loadBased) {
    const box = el('input', { type: 'checkbox', checked: scale, dataset: { name: 'loadScale' } });
    box.addEventListener('change', () => { setLoadScale(box.checked); render(); });
    wrap.appendChild(el('label', { class: 'check-inline', style: 'margin-bottom:8px' }, box, ' Scale to goal weight'));
    if (scale && rows.some((r) => r.res?.detail.scaleUnavailable)) {
      wrap.appendChild(el('p', { class: 'muted' }, goal
        ? 'Some sessions have no weigh-in to scale from, so they show unscaled values.'
        : 'No bodyweight goal set (Goals), so values are unscaled.'));
    } else if (scale) {
      wrap.appendChild(el('p', { class: 'muted' },
        `Scaled to your goal weight of ${formatWeight(goal.targetWeight)}: this capacity at goal weight, assuming strength-to-weight stays the same.`));
    }
  }

  // Chart: the load series when there is one; otherwise the reps/hold trend
  // at the most recent variant (a different rung isn't the same movement).
  const withLoad = rows.filter((r) => r.res);
  let chart;
  if (withLoad.length) {
    chart = lineChart({
      points: datePoints(withLoad.map((r) => ({ date: r.log.date, y: r.res.value })),
        (p) => weightToInput(Math.round(p.y * 10) / 10)),
      yLabel: weightUnit(),
      yFormat: (v) => String(Math.round(v * 10) / 10),
    });
  } else {
    const latest = [...rows].reverse().find((r) => r.fallback != null);
    const same = rows.filter((r) => r.fallback != null && r.level === latest?.level);
    chart = lineChart({
      points: datePoints(same.map((r) => ({ date: r.log.date, y: r.fallback })), (p) => p.y),
      yLabel: `${timed ? 'Longest hold (s)' : 'Best set (reps)'}${latest?.variant ? ` · ${latest.variant.name}` : ''}`,
      yFormat: (v) => String(Math.round(v)),
    });
  }
  wrap.appendChild(chart);

  const reasonText = (r) => {
    const what = timed ? 'hold time' : 'reps';
    if (r.why === 'overCap') return `Over the ${params.maxReps}-rep cap, so showing ${what}.`;
    if (r.why === 'noWeight') return `No weight recorded, so showing ${what}.`;
    if (r.why === 'noBodyweight') return `No weigh-in on or before this date, so showing ${what}.`;
    if (r.why === 'noFraction') {
      return r.variant
        ? `${r.variant.name} isn’t comparable by load, so showing ${what}.`
        : `No variant recorded (or no bodyweight fraction), so showing ${what}.`;
    }
    return null;
  };

  const card = el('div', { class: 'card' });
  for (const r of [...rows].reverse().slice(0, 15)) {
    const date = formatDate(r.log.date, { month: 'short', day: 'numeric', year: 'numeric' });
    const variantName = r.variant ? ` · ${r.variant.name}` : '';
    let title;
    let sub;
    if (r.res) {
      const d = r.res.detail;
      title = `${fmtKg(r.res.value)} · 4-wk best ${fmtKg(r.best4w)}`;
      const setText = model === 'bw_e1rm'
        ? `${d.reps} reps at ${fmtKg(d.loadKg)} effective${d.addedKg > 0 ? ` (+${fmtKg(d.addedKg)})` : ''}`
        : `${d.reps} × ${fmtKg(d.loadKg)}`;
      sub = `${date} · best set ${setText}${variantName}${d.scaled ? ' · scaled to goal' : ''}`;
    } else {
      title = r.fallback == null ? '—'
        : timed ? `Longest hold: ${formatDuration(r.fallback)}${variantName}`
          : `Best set: ${r.fallback} reps${variantName}`;
      sub = date;
    }
    const why = reasonText(r);
    card.appendChild(el('div', { class: 'list-row' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, title),
        el('div', { class: 'row-sub' }, sub),
        why && el('div', { class: 'row-sub' }, why),
      ),
    ));
  }
  wrap.appendChild(card);
  return wrap;
}

export function rwiSection(ex) {
  const wrap = el('div', {});
  wrap.appendChild(el('h3', {}, isLoadModel(loadModelOf(ex)) ? 'Relative Work Index (work)' : 'Relative Work Index'));
  const plans = store.get('plans');

  const goal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
  const logs = store.get('logs')
    .filter((l) => l.exerciseId === ex.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 15);

  if (!goal) {
    wrap.appendChild(el('p', { class: 'muted' },
      'RWI needs a bodyweight goal: RWI = work × (goal weight ÷ your weight at the time), where work is reps per set, ',
      'km × km/h for distance, running seconds for run/walk intervals, or seconds for a hold. ',
      'Add one under Goals.'));
    wrap.appendChild(el('button', { class: 'btn secondary small', onclick: () => { S.view = { name: 'goals' }; render(); } }, 'Go to Goals'));
    return wrap;
  }
  const metrics = store.get('metrics');
  const currentW = weightOn(todayStr(), metrics);
  if (currentW == null) {
    wrap.appendChild(el('p', { class: 'muted' }, 'RWI needs at least one logged body weight (Logs → Metrics).'));
    return wrap;
  }
  wrap.appendChild(el('p', { class: 'muted' },
    `Goal weight ${formatWeight(goal.targetWeight)} · current ${formatWeight(currentW)} · `,
    `ratio ${(goal.targetWeight / currentW).toFixed(3)}. `,
    'RWI = work × goal ÷ bodyweight on the day. Work is reps per set; for distance, km × km/h ',
    '(so going further or faster both count); for run/walk intervals, the running seconds; for a hold, seconds.'));

  if (!logs.length) {
    wrap.appendChild(el('p', { class: 'muted' }, 'No logged sets for this exercise yet.'));
    return wrap;
  }
  const card = el('div', { class: 'card' });
  for (const log of logs) {
    const w = weightOn(log.date, metrics);
    const { basis, perSet } = rwiWork(log.actual, plannedTargetOf(log, plans));
    let rwiText = '—';
    if (perSet.length && w != null) {
      const ratio = goal.targetWeight / w;
      const each = perSet.map((x) => x * ratio);
      const total = each.reduce((a, b) => a + b, 0);
      const uniform = each.every((x) => x === each[0]);
      // "/set" only means something for reps; a run is one effort.
      const per = basis === 'reps' ? '/set' : '';
      rwiText = uniform
        ? `RWI ${each[0].toFixed(1)}${per}${each.length > 1 ? ` · total ${total.toFixed(1)}` : ''}`
        : `RWI ${each.map((x) => x.toFixed(1)).join(' / ')} · total ${total.toFixed(1)}`;
      if (basis !== 'reps') rwiText += ` (${RWI_BASIS_LABEL[basis]})`;
    }
    card.appendChild(el('div', { class: 'list-row' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, rwiText),
        el('div', { class: 'row-sub' },
          `${formatDate(log.date, { month: 'short', day: 'numeric', year: 'numeric' })} · `
          + summarizeActual(log.actual)
          + (w != null ? ` · @ ${formatWeight(w)}` : '')),
      ),
    ));
  }
  wrap.appendChild(card);
  return wrap;
}

export function summarizeActual(actual = {}) {
  const parts = [];
  if (formatSets(actual)) parts.push(formatSets(actual));
  if (isTimedActual(actual)) parts.push(formatTimedSets(actual));
  else if (actual.durationSec) parts.push(formatDuration(actual.durationSec));
  if (actual.distanceM) parts.push(formatDistance(actual.distanceM));
  if (actual.movingSec && !actual.durationSec) parts.push(formatDuration(actual.movingSec));
  return parts.join(' · ') || 'no data';
}
