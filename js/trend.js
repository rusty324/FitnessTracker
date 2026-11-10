// Body-weight trend: what's actually happening under the daily noise. Pure.
//
// The trend is a time-aware exponential moving average: a weigh-in after a
// gap of g days moves it by a = 1 − (1 − alpha)^g, so a week's gap counts
// for more than a day's. It's computed at read time and never stored.
//
// Rates and plateaus come from the RAW weigh-ins (ordinary least squares),
// never the smoothed series: smoothed values are autocorrelated, so a fit to
// them understates the uncertainty.

import { RATE_WARN_PCT } from './config.js';

const DAY = 86400000;
const dayNum = (ds) => Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)) / DAY;

// points: [{ date, kg }] ascending -> [{ date, kg, trendKg }]
export function trendSeries(points, { alpha = 0.1 } = {}) {
  const out = [];
  let trend = null;
  let prev = null;
  for (const p of points) {
    if (trend == null) trend = p.kg;
    else {
      // Two weigh-ins on one day: weigh the second like a one-day gap.
      const g = Math.max(1, dayNum(p.date) - dayNum(prev));
      const a = 1 - (1 - alpha) ** g;
      trend += a * (p.kg - trend);
    }
    prev = p.date;
    out.push({ date: p.date, kg: p.kg, trendKg: trend });
  }
  return out;
}

// OLS slope of raw weights over the last `windowDays` (ending at the latest
// weigh-in, or `asOf`). null with fewer than 10 weigh-ins or under 14 days.
// -> { slopeKgPerWeek, seKgPerWeek, n }
export function trendSlope(points, { windowDays = 28, asOf = null } = {}) {
  if (!points.length) return null;
  const end = asOf ? dayNum(asOf) : dayNum(points.at(-1).date);
  const pts = points.filter((p) => dayNum(p.date) <= end && dayNum(p.date) > end - windowDays);
  const n = pts.length;
  if (n < 10) return null;
  const xs = pts.map((p) => dayNum(p.date));
  if (Math.max(...xs) - Math.min(...xs) < 14) return null;
  const ys = pts.map((p) => p.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxy / sxx; // kg per day
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (my + slope * (xs[i] - mx))) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  return { slopeKgPerWeek: slope * 7, seKgPerWeek: se * 7, n };
}

// -> { pctPerWeek, fast, flat }. fast: losing faster than RATE_WARN_PCT % of
// body weight a week. flat: the slope is within its own noise (|slope| < 2·se).
export function rateLabel(rate, latestTrendKg) {
  if (!rate || !latestTrendKg) return null;
  const pctPerWeek = (rate.slopeKgPerWeek / latestTrendKg) * 100;
  return {
    pctPerWeek,
    fast: pctPerWeek < -RATE_WARN_PCT,
    flat: Math.abs(rate.slopeKgPerWeek) < 2 * rate.seKgPerWeek,
  };
}

// Rough weeks to goal at the current rate; null unless the slope points at
// the goal and is clearly more than noise.
export function etaToGoal(trendKg, goalKg, slopeKgPerWeek, seKgPerWeek) {
  if (trendKg == null || goalKg == null || slopeKgPerWeek == null) return null;
  const gap = goalKg - trendKg;
  if (Math.abs(gap) < 0.05) return 0;
  if (gap * slopeKgPerWeek <= 0) return null; // heading away
  if (Math.abs(slopeKgPerWeek) <= 2 * (seKgPerWeek ?? 0)) return null; // can't tell
  return gap / slopeKgPerWeek;
}

// Weight points from body-metric records, ascending.
export function weightPoints(metrics) {
  return metrics
    .filter((m) => m.weight != null && m.date)
    .map((m) => ({ date: m.date, kg: m.weight }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
