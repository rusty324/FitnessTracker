// Logs → Review: the weekly review (sessions, bests, volume, one
// recommendation), its Today banner, and the weekly dots.
import { sessionCounts, weekStartOf, weeklyReview } from '../../review.js';
import { addDays, formatDate, formatDuration, todayStr } from '../../dates.js';
import * as store from '../../storage/store.js';
import { el } from '../components.js';
import { formatDistance, formatWeight, weightUnit } from '../../units.js';
import { render } from '../logs-tab.js';
import { holdText } from '../../sets.js';
import { isDesktop } from '../layout.js';
import { arrowOf, suggestionTitle } from '../suggestion.js';
import { signed } from './metrics.js';
import { S } from './state.js';

// Today's header: a dot per planned session this week — filled when done,
// ringed for today — and "2 of 3 this week". Weekly counts only: no streaks.
export function weekDots(today) {
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

export const weekStartDay = () => {
  try { return localStorage.getItem('ft.weekStart') === 'sun' ? 'sun' : 'mon'; } catch { return 'mon'; }
};
export const lastWeekStart = (today) => addDays(weekStartOf(today, weekStartDay()), -7);
export const markReviewSeen = (start) => { try { localStorage.setItem('ft.reviewSeen', start); } catch { /* blocked */ } };

export function reviewData(weekStart, today) {
  return weeklyReview({
    weekStart, today,
    plans: store.get('plans'), logs: store.get('logs'), activities: store.getActivityEntries(),
    metrics: store.get('metrics'), goals: store.get('goals'), sessionsRecords: store.get('sessions'),
    matches: store.get('matches'), exercises: store.get('exercises'), schedule: store.get('schedule'),
    units: weightUnit() === 'lb' ? 'imperial' : 'metric',
  });
}

// On Today: last week's review is ready and hasn't been looked at.
export function reviewBanner(today) {
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
    el('div', { class: 'row-main tappable', onclick: () => { S.sub = 'review'; S.reviewThisWeek = false; render(); } },
      el('div', { class: 'row-title' }, 'Your week in review is ready'),
      el('div', { class: 'row-sub' }, `${formatDate(start, { month: 'short', day: 'numeric' })} – ${formatDate(end, { month: 'short', day: 'numeric' })} · tap to open`)),
    el('button', { class: 'sug-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => { markReviewSeen(start); render(); } }, '✕'));
}

export const fmtShort = (ds) => formatDate(ds, { month: 'short', day: 'numeric' });

export function prText(pr) {
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

export function renderReview() {
  // Desktop: the same cards in two columns — what happened on the left;
  // what's ready, volume, weight and cardio on the right. The card code
  // appends to `root`, so it's pointed at each column in turn.
  const page = S.root;
  const desktop = isDesktop();
  let left = page;
  let right = page;
  try {
    renderReviewCards(desktop, () => {
      if (!desktop) return;
      left = el('div', { class: 'col-half' });
      right = el('div', { class: 'col-half' });
      page.appendChild(el('div', { class: 'two-col review-cols' }, left, right));
    }, (col) => { S.root = col === 'left' ? left : right; });
  } finally {
    S.root = page;
  }
}

export function renderReviewCards(desktop, makeColumns, useColumn) {
  const today = todayStr();
  const start = S.reviewThisWeek ? weekStartOf(today, weekStartDay()) : lastWeekStart(today);
  if (!S.reviewThisWeek) markReviewSeen(start);
  const r = reviewData(start, today);

  S.root.appendChild(el('div', { class: 'section-head' },
    el('div', {},
      el('h2', { class: 'section-title' }, S.reviewThisWeek ? 'This week' : 'Last week'),
      el('div', { class: 'row-sub' }, `${fmtShort(r.week.start)} – ${fmtShort(r.week.end)}${S.reviewThisWeek ? ' · so far' : ''}`)),
    el('button', { class: 'link-btn', type: 'button', onclick: () => { S.reviewThisWeek = !S.reviewThisWeek; render(); } },
      S.reviewThisWeek ? 'Last week' : 'This week so far')));

  makeColumns();
  useColumn('left');
  // The one thing.
  S.root.appendChild(el('div', { class: `card rec-card ${r.recommendation.severity}`, dataset: { rec: r.recommendation.id } },
    el('div', { class: 'rec-kicker' }, S.reviewThisWeek ? 'One thing so far' : 'One thing for this week'),
    el('div', { class: 'rec-text' }, r.recommendation.text),
    r.recommendation.id === 'progress' ? el('div', { class: 'row-sub' }, 'The suggestions are waiting on Today, with the reason for each.') : null));

  // Sessions: a bar per planned session — no streaks, no pass/fail.
  const s = r.sessions;
  S.root.appendChild(el('div', { class: 'card' },
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
    S.root.appendChild(card);
  }

  useColumn('right');
  // Desktop: what's ready to progress, with the evidence for each.
  if (desktop && r.ready.length) {
    S.root.appendChild(el('div', { class: 'card', dataset: { card: 'ready' } },
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
    S.root.appendChild(el('div', { class: 'card review-weight' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-sub' }, 'Weight trend'),
        el('div', { class: 'review-big' }, `${d(r.weight.startKg)} → ${d(r.weight.endKg)} ${u}`)),
      r.weight.rate && el('div', { class: 'row-sub', style: 'text-align:right' },
        `${signed((u === 'lb' ? 2.20462262 : 1) * r.weight.rate.slopeKgPerWeek)} ${u}/wk`, el('br'), 'over 28 days')));
  }

  // Training volume: hard sets per muscle group, for information only.
  if (r.volume.length) {
    S.root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'review-head' }, el('span', { class: 'row-sub' }, 'Sets per muscle group'), el('span', { class: 'row-sub' }, 'vs week before')),
      r.volume.map((v) => el('div', { class: 'list-row' },
        el('div', { class: 'row-main' }, v.label),
        el('div', { class: 'row-sub' }, `${v.sets}${v.delta ? ` (${v.delta > 0 ? '+' : '−'}${Math.abs(v.delta)})` : ''}`)))));
  }
  if (r.cardio.sessions) {
    S.root.appendChild(el('div', { class: 'card' },
      el('div', { class: 'review-head' }, el('span', { class: 'row-sub' }, 'Cardio'),
        el('span', { class: 'row-sub' }, `${r.cardio.sessions} session${r.cardio.sessions === 1 ? '' : 's'}`)),
      el('div', {}, [r.cardio.distanceM ? formatDistance(r.cardio.distanceM) : null, r.cardio.movingSec ? formatDuration(r.cardio.movingSec) : null]
        .filter(Boolean).join(' · ') || '—')));
  }
}
