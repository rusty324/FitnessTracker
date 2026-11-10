// The exercise page on desktop (the owner's design): a library sidebar to
// move between exercises, a "Next time" card that says the rule, a chart of
// the top set per session with the suggested next step, and recent sessions
// with what the rule said after each. Everything here is derived from the
// logs at read time; nothing is stored.

import * as store from '../storage/store.js';
import { el } from './components.js';
import { formatDate, todayStr } from '../dates.js';
import { weightUnit } from '../units.js';
import { matchesSearch } from '../exercise-filters.js';
import { sessionsOf, suggestNext, progressionModeOf, rangeOf } from '../progression.js';
import { nextPlannedFor } from '../schedule.js';
import { painHoldFor } from '../pain.js';
import { suggestionTitle, arrowOf, planVsSuggested } from './suggestion.js';

const LB = 2.20462262;
const disp = (kg) => (weightUnit() === 'lb' ? kg * LB : kg);
const fmtW = (kg) => `${Math.round(disp(kg) * 10) / 10} ${weightUnit()}`;
const units = () => (weightUnit() === 'lb' ? 'imperial' : 'metric');
const short = (ds) => formatDate(ds, { month: 'short', day: 'numeric' });

// What the rule says now for an exercise (or null), with its plan context.
export function suggestionNow(ex) {
  const today = todayStr();
  const plans = store.get('plans');
  const planned = nextPlannedFor(ex.id, plans, today, store.get('schedule'));
  const target = planned?.item.target ?? null;
  const history = sessionsOf(ex.id, store.get('logs'), plans);
  const s = suggestNext({
    exercise: ex, plannedTarget: target, history, weekIsDeload: !!planned?.week?.isDeload, today, units: units(),
    painHold: painHoldFor(ex.id, store.get('sessions'), plans),
  });
  return { suggestion: s, target, history, mode: progressionModeOf(ex, target) };
}

// ---------- sidebar ----------

const CATS = [['all', 'All'], ['strength', 'Strength'], ['cardio', 'Cardio'], ['mobility', 'Mobility']];
let sideQuery = '';
let sideCat = 'all';

// A short hint beside each exercise: its suggestion ("↑ 45 lb"), else the
// level last done for a ladder.
function hintFor(ex) {
  const { suggestion: s, history } = suggestionNow(ex);
  if (s && ['add', 'drop', 'return'].includes(s.kind) && s.weightKg != null) return { text: `${arrowOf(s)} ${fmtW(s.weightKg)}`, up: true };
  if (s && ['advance', 'regress'].includes(s.kind)) return { text: `${arrowOf(s)} Level ${s.variantLevel}`, up: true };
  const lvl = history[0]?.variantLevel;
  return ex.variants?.length && lvl != null ? { text: `Level ${lvl}`, up: false } : null;
}

export function librarySidebar(current, onPick) {
  const pool = store.get('exercises').filter((e) => !e.archived).sort((a, b) => a.name.localeCompare(b.name));
  const list = el('div', { class: 'lib-list' });
  const draw = () => {
    const shown = pool.filter((e) => matchesSearch(e, sideQuery) && (sideCat === 'all' || e.category === sideCat));
    list.replaceChildren(...shown.map((e) => {
      const hint = hintFor(e);
      return el('button', {
        type: 'button', class: `lib-item${e.id === current?.id ? ' active' : ''}`,
        'aria-current': e.id === current?.id ? 'page' : null, dataset: { exercise: e.id },
        onclick: () => onPick(e.id),
      },
      el('span', { class: 'lib-name' }, e.name),
      hint && el('span', { class: `lib-hint${hint.up ? ' up' : ''}` }, hint.text));
    }), ...(shown.length ? [] : [el('p', { class: 'muted', style: 'padding:8px 12px' }, 'No match.')]));
  };
  const search = el('input', {
    id: 'lib-side-search', type: 'search', placeholder: 'Search', value: sideQuery, autocomplete: 'off', dataset: { filter: 'side-query' },
    oninput: (e) => { sideQuery = e.target.value; draw(); },
  });
  const chips = el('div', { class: 'lib-chips', role: 'group', 'aria-label': 'Category' },
    CATS.map(([id, label]) => el('button', {
      type: 'button', class: `chip${sideCat === id ? ' on' : ''}`, 'aria-pressed': String(sideCat === id),
      onclick: (e) => {
        sideCat = id;
        e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
        e.currentTarget.classList.add('on');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        draw();
      },
    }, label)));
  draw();
  return el('section', { class: 'card lib-side' },
    el('label', { for: 'lib-side-search', class: 'row-sub' }, 'Search exercises'), search, chips, list);
}

// ---------- Next time ----------

const RULES = {
  double: 'Add weight once every working set reaches the top of the rep range. Hold otherwise. Drop a step after two sessions with the first set below the range; after 3 weeks off, ease back in at 90%.',
  variant: 'Move up a level after two sessions in a row with every set at the top of the range. Step back after two sessions with the first set below it.',
};

export function nextTimeCard(ex) {
  const { suggestion: s, target, mode } = suggestionNow(ex);
  if (!s) return null;
  const range = rangeOf(s.repsMin != null ? { repsMin: s.repsMin, repsMax: s.repsMax } : target);
  const reps = range ? (range[0] === range[1] ? `${range[0]}` : `${range[0]}–${range[1]}`) : null;
  const level = s.variantLevel != null ? ex.variants?.find((v) => v.level === s.variantLevel) : null;
  const big = s.weightKg != null
    ? `${fmtW(s.weightKg)}${reps ? ` × ${reps}` : ''}`
    : level ? `Level ${level.level} · ${level.name}${reps ? ` × ${reps}` : ''}` : suggestionTitle(s, ex);
  const plan = planVsSuggested(target, s, ex);
  return el('section', { class: `card next-card ${['add', 'advance'].includes(s.kind) ? 'up' : ''}`, dataset: { card: 'next' } },
    el('div', { class: 'next-main' },
      el('div', { class: 'next-kicker' }, 'Next time'),
      el('div', { class: 'next-big' }, el('span', { class: 'next-arrow', 'aria-hidden': 'true' }, arrowOf(s)), ' ', big),
      el('div', { class: 'next-reason' }, s.reason),
      plan && el('div', { class: 'row-sub' }, plan)),
    mode && el('div', { class: 'next-rule' }, el('div', { class: 'next-rule-head' }, 'The rule'), RULES[mode]));
}

// ---------- the chart and the table ----------

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

// Top set per session (weight, or level for a ladder), reps underneath,
// and a dashed step to the suggested next value.
// Round tick values: whole levels, or 1/2/2.5/5/10… steps for weights, so
// the axis reads 25, 30, 35 rather than 28, 33, 38.
function niceTicks(lo, hi, wholeOnly) {
  const span = Math.max(hi - lo, wholeOnly ? 1 : 0.5);
  const steps = wholeOnly ? [1, 2, 5, 10] : [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
  const step = steps.find((st) => span / st <= 5) ?? steps.at(-1);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks.length > 1 ? ticks : [start - step, start, start + step];
}

function progressChart(points, next, { yLabel, fmt, wholeOnly = false }) {
  const W = 720;
  const H = 300;
  const pad = { l: 44, r: 16, t: 24, b: 56 };
  const ys = points.map((p) => p.y).concat(next ? [next.y] : []);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys), wholeOnly);
  const lo = ticks[0];
  const hi = ticks.at(-1);
  const n = points.length + (next ? 1 : 0);
  const X = (i) => pad.l + ((i + 0.5) / n) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg progress-chart', role: 'img',
    'aria-label': `${yLabel} by session${next ? `, ${next.label} next` : ''}` });
  for (const v of ticks) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'grid-line' }),
      s('text', { x: pad.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'tick-label' }, fmt(v)));
  }
  svg.append(s('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.y)}`).join(''), class: 'series-line' }));
  points.forEach((p, i) => {
    svg.append(s('circle', { cx: X(i), cy: Y(p.y), r: 5, class: 'series-dot' }),
      s('text', { x: X(i), y: H - 32, 'text-anchor': 'middle', class: 'tick-label' }, p.label),
      s('text', { x: X(i), y: H - 14, 'text-anchor': 'middle', class: 'tick-label reps-label' }, p.sub));
  });
  if (next && points.length) {
    const i = points.length;
    const last = points.at(-1);
    svg.append(
      s('path', { d: `M${X(i - 1)},${Y(last.y)} L${X(i)},${Y(last.y)} L${X(i)},${Y(next.y)}`, class: 'next-line' }),
      s('circle', { cx: X(i), cy: Y(next.y), r: 6, class: 'next-dot' }),
      s('text', { x: X(i), y: Y(next.y) - 12, 'text-anchor': 'middle', class: 'next-label' }, next.label),
      s('text', { x: X(i), y: H - 32, 'text-anchor': 'middle', class: 'tick-label next-label' }, 'Next'));
  }
  return svg;
}

// What the rule said after each past session: the rule replayed on the
// history up to and including that session.
function ruleSaid(ex, target, history, i) {
  const r = suggestNext({ exercise: ex, plannedTarget: target, history: history.slice(i), today: history[i].date, units: units() });
  if (!r) return null;
  const top = Math.max(...history[i].sets.map((x) => x.weightKg ?? 0));
  const diff = r.weightKg != null && top > 0 ? Math.round(Math.abs(disp(r.weightKg) - disp(top)) * 10) / 10 : null;
  switch (r.kind) {
    case 'add': return { text: diff ? `Add ${diff} ${weightUnit()}` : 'Add', up: true };
    case 'drop': return { text: diff ? `Drop ${diff} ${weightUnit()}` : 'Drop', up: false };
    case 'advance': return { text: 'Move up a level', up: true };
    case 'regress': return { text: 'Step back a level', up: false };
    default: return { text: 'Hold', up: false };
  }
}

export function progressSection(ex) {
  const { suggestion: sug, target, history, mode } = suggestionNow(ex);
  const recent = history.slice(0, 10).reverse(); // oldest → newest
  if (recent.length < 2) return null;
  const weighted = recent.some((h) => h.sets.some((x) => x.weightKg > 0));
  const byLevel = !weighted && recent.some((h) => h.variantLevel != null);
  if (!weighted && !byLevel) return null;
  const top = (h) => Math.max(...h.sets.map((x) => x.weightKg ?? 0));
  const points = recent.map((h) => ({
    y: weighted ? disp(top(h)) : h.variantLevel ?? 0,
    label: short(h.date),
    sub: h.sets.map((x) => x.reps).join('·'),
  }));
  const next = sug && (weighted ? sug.weightKg != null && { y: disp(sug.weightKg), label: `Try ${Math.round(disp(sug.weightKg) * 10) / 10}` }
    : sug.variantLevel != null && { y: sug.variantLevel, label: `Level ${sug.variantLevel}` });
  const chart = el('section', { class: 'card', dataset: { card: 'progress' } },
    el('div', { class: 'row-sub', style: 'margin-bottom:8px' },
      weighted ? `Top-set weight by session (${weightUnit()}), with reps per set underneath` : 'Level by session, with reps per set underneath'),
    progressChart(points, next || null, { yLabel: weighted ? 'Top-set weight' : 'Level', wholeOnly: !weighted, fmt: (v) => String(Math.round(v * 10) / 10) }));

  const rows = history.slice(0, 6).map((h, i) => {
    const said = mode ? ruleSaid(ex, target, history, i) : null;
    return el('tr', {},
      el('td', {}, short(h.date)),
      el('td', { class: 'num-l' }, weighted ? fmtW(top(h)) : h.variantLevel != null ? `Level ${h.variantLevel}` : '—'),
      el('td', { class: 'num-l' }, h.sets.map((x) => x.reps).join(' · ')),
      el('td', { class: `num${said?.up ? ' said-up' : ''}` }, said?.text ?? '—'));
  });
  const table = el('section', { class: 'card', dataset: { card: 'recent-sessions' } },
    el('div', { class: 'row-sub' }, 'Recent sessions'),
    el('table', { class: 'data-table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Date'), el('th', {}, weighted ? 'Weight' : 'Level'), el('th', {}, 'Reps per set'),
        el('th', { class: 'num' }, 'What the rule said'))),
      el('tbody', {}, rows)));
  return [chart, table];
}
