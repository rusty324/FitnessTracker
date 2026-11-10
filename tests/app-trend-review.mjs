// Phase C — weight trend (js/trend.js) and the weekly review (js/review.js):
// the pure maths with exact values, every recommendation rule and their
// precedence, the week-start setting, PRs versus history before the week
// only, and how it all shows (Metrics, the weigh-in toast, Review, the
// Today banner).
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

// ---------- trend ----------
const t = await page.evaluate(async () => {
  const T = await import('/js/trend.js');
  const series = (pts) => T.trendSeries(pts.map(([date, kg]) => ({ date, kg })));
  const day = (n) => { const x = new Date(Date.UTC(2026, 0, 1 + n)); return x.toISOString().slice(0, 10); };
  // A known slope: -0.1 kg/day with a deterministic wobble.
  const line = Array.from({ length: 28 }, (_, i) => ({ date: day(i), kg: 100 - 0.1 * i + (i % 2 ? 0.3 : -0.3) }));
  const s = T.trendSlope(line);
  return {
    single: series([['2026-01-01', 80]]),
    constant: series([['2026-01-01', 80], ['2026-01-02', 80], ['2026-01-09', 80]]).map((p) => p.trendKg),
    gap1: series([['2026-01-01', 80], ['2026-01-02', 90]])[1].trendKg,
    gap7: series([['2026-01-01', 80], ['2026-01-08', 90]])[1].trendKg,
    slope: s,
    few: T.trendSlope(line.slice(0, 9)),
    short: T.trendSlope(Array.from({ length: 12 }, (_, i) => ({ date: day(i), kg: 80 }))),
    fast: T.rateLabel({ slopeKgPerWeek: -1.2, seKgPerWeek: 0.1 }, 100),
    notFast: T.rateLabel({ slopeKgPerWeek: -0.8, seKgPerWeek: 0.1 }, 100),
    flat: T.rateLabel({ slopeKgPerWeek: 0.1, seKgPerWeek: 0.2 }, 100),
    etaToward: T.etaToGoal(100, 90, -0.5, 0.1),
    etaAway: T.etaToGoal(100, 90, 0.5, 0.1),
    etaUnsure: T.etaToGoal(100, 90, -0.3, 0.2),
  };
});
step('trend: a single point is its own trend', t.single.length === 1 && t.single[0].trendKg === 80);
step('trend: a constant series stays constant', t.constant.every((v) => v === 80));
step('trend: a 1-day gap moves it by alpha (a = 0.1)', Math.abs(t.gap1 - 81) < 1e-9, t.gap1);
step('trend: a 7-day gap weighs the new point more (a = 1 − 0.9^7)', Math.abs(t.gap7 - (80 + 10 * (1 - 0.9 ** 7))) < 1e-9 && t.gap7 > t.gap1, t.gap7);
step('slope: recovers −0.7 kg/week from raw weights', Math.abs(t.slope.slopeKgPerWeek + 0.7) < 0.05 && t.slope.n === 28, JSON.stringify(t.slope));
step('slope: null under 10 weigh-ins, or under 14 days', t.few === null && t.short === null);
step('rate: fast above 1%/week', t.fast.fast && !t.notFast.fast);
step('rate: flat when |slope| < 2·se', t.flat.flat && !t.fast.flat);
step('eta: weeks when heading clearly toward the goal', Math.abs(t.etaToward - 20) < 1e-9);
step('eta: null when heading away or within the noise', t.etaAway === null && t.etaUnsure === null);

// ---------- weekly review rules ----------
const r = await page.evaluate(async () => {
  const R = await import('/js/review.js');
  const m = await import('/js/models.js');
  const today = '2026-11-12'; // Thursday; last week = Nov 2–8 (Mon start)
  const weekStart = '2026-11-02';
  const day = (s, n) => { const [y, mo, d] = s.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10); };
  const bench = { ...m.makeExercise({ name: 'Bench', modality: 'barbell' }), id: 'b', primaryTargets: ['chest'] };
  // Four weeks of 3 sessions (Mon/Wed/Fri), each one bench item.
  const plan = { ...m.makePlan({ name: 'P', startDate: '2026-10-12' }), progressionPolicy: { injuryRule: 'Any shin pain during a run ends that session immediately. Repeat the same week rather than advancing.' } };
  for (let w = 1; w <= 5; w++) {
    const week = m.makeWeek(w);
    for (const [k, off] of [[1, 0], [2, 2], [3, 4]]) {
      week.sessions.push({ ...m.makeSession({ label: `W${w}S${k}`, dayOffset: (w - 1) * 7 + off }), id: `s${w}${k}`,
        blocks: [{ id: `bl${w}${k}`, type: 'main', items: [{ id: `i${w}${k}`, exerciseId: 'b', target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12 } }] }] });
    }
    plan.weeks.push(week);
  }
  const done = (w, k, extra = {}) => ({ ...m.makeLogEntry({ date: day('2026-10-12', (w - 1) * 7 + (k - 1) * 2), exerciseId: 'b', planId: plan.id, plannedExerciseId: `i${w}${k}`, actual: { sets: 3, reps: 10, weight: 60 } }), ...extra });
  const allDone = [1, 2, 3, 4].flatMap((w) => [1, 2, 3].map((k) => done(w, k)));
  const weights = (perWeek) => Array.from({ length: 35 }, (_, i) => ({ id: `m${i}`, date: day('2026-10-05', i), weight: 100 + perWeek / 7 * i + (i % 2 ? 0.1 : -0.1) }));
  const base = { weekStart, today, plans: [plan], exercises: [bench], matches: [], goals: [], units: 'metric' };
  const rec = (o) => R.weeklyReview({ ...base, ...o }).recommendation;
  return {
    pain: rec({ logs: allDone.filter((l) => !/i[34][23]/.test(l.plannedExerciseId)), sessionsRecords: [{ id: 'x', date: '2026-11-04', kind: 'full', pain: { level: 'pain', regions: ['shin'] } }],
      metrics: weights(-1.5) }),
    light: rec({ logs: allDone.filter((l) => !/i[34][23]/.test(l.plannedExerciseId)), metrics: weights(-1.5) }),
    fast: rec({ logs: allDone, metrics: weights(-1.5) }),
    flat: rec({ logs: allDone, metrics: weights(0) }),
    progress: rec({ logs: allDone.map((l) => ({ ...l, actual: { sets: 3, reps: 12, weight: 60 } })), metrics: [] }),
    none: rec({ logs: allDone, metrics: [] }),
    full: R.weeklyReview({ ...base, logs: allDone, metrics: [] }),
    mon: R.weekStartOf('2026-11-12', 'mon'),
    sun: R.weekStartOf('2026-11-12', 'sun'),
    sunWeek: R.weeklyReview({ ...base, weekStart: R.weekStartOf('2026-11-05', 'sun'), logs: allDone, metrics: [] }).week,
    // PRs: before the week the best was 62.5; inside it 60 then 65.
    prs: R.weeklyReview({ ...base, metrics: [], logs: [
      { ...m.makeLogEntry({ date: '2026-10-20', exerciseId: 'b', actual: { sets: 1, reps: 5, weight: 62.5 } }), id: 'p0' },
      { ...m.makeLogEntry({ date: '2026-11-02', exerciseId: 'b', actual: { sets: 1, reps: 5, weight: 60 } }), id: 'p1' },
      { ...m.makeLogEntry({ date: '2026-11-06', exerciseId: 'b', actual: { sets: 1, reps: 5, weight: 65 } }), id: 'p2' },
    ] }).prs,
    noPr: R.weeklyReview({ ...base, metrics: [], logs: [
      { ...m.makeLogEntry({ date: '2026-10-20', exerciseId: 'b', actual: { sets: 1, reps: 5, weight: 62.5 } }), id: 'p0' },
      { ...m.makeLogEntry({ date: '2026-11-02', exerciseId: 'b', actual: { sets: 1, reps: 5, weight: 60 } }), id: 'p1' },
    ] }).prs,
  };
});
step('rule 1: pain this week shows the plan’s injuryRule, verbatim — even over light weeks and a fast rate', r.pain.id === 'pain'
  && r.pain.text === 'Any shin pain during a run ends that session immediately. Repeat the same week rather than advancing.' && r.pain.severity === 'attention');
step('rule 2: two weeks at ≤ 50% → light weeks (and it beats a fast rate)', r.light.id === 'light-weeks' && /Two light weeks/.test(r.light.text), r.light.text);
step('rule 3: dropping faster than 1%/week', r.fast.id === 'fast', r.fast.id);
step('rule 4: flat trend with ≥ 80% of sessions done → intake is the lever', r.flat.id === 'flat' && /intake/.test(r.flat.text), r.flat.id);
step('rule 5: suggestions ready → names them', r.progress.id === 'progress' && /Ready to progress: Bench/.test(r.progress.text), r.progress.text);
step('rule 6: otherwise, says plainly nothing is wrong', r.none.id === 'none' && r.none.text === 'Nothing to change. Keep going.');
step('sessions: planned vs completed for the week, split full/minimum', r.full.sessions.planned === 3 && r.full.sessions.completed === 3 && r.full.sessions.full === 3);
step('volume: hard sets per muscle group with the week-before delta', r.full.volume[0]?.group === 'chest' && r.full.volume[0].sets === 9 && r.full.volume[0].delta === 0);
step('week start: Monday by default, Sunday when set', r.mon === '2026-11-09' && r.sun === '2026-11-08' && r.sunWeek.start === '2026-11-01' && r.sunWeek.end === '2026-11-07');
step('PR: versus history before the week only (65, was 62.5 — not 60)', r.prs.length === 1 && r.prs[0].value === 65 && r.prs[0].was === 62.5, JSON.stringify(r.prs));
step('…and no PR when the week didn’t beat what came before', r.noPr.length === 0);

// ---------- UI: Metrics, the weigh-in toast ----------
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  const met = [];
  for (let i = 40; i >= 1; i--) met.push(m.makeBodyMetric({ date: d(i), weight: 100 - (40 - i) * 0.05 + (i % 2 ? 0.4 : -0.4) }));
  localStorage.setItem('ft.data.data/metrics.json', JSON.stringify(met));
  localStorage.setItem('ft.data.data/goals.json', JSON.stringify([{ ...m.makeGoal({ type: 'bodyweight' }), targetWeight: 90 }]));
  localStorage.setItem('ft.data.data/exercises.json', '[]');
});
await page.reload();
await page.waitForSelector('.segmented button');
await page.fill('.card input[aria-label^="Weight"]', '101.5');
await page.click('.card button:has-text("Log")');
await page.waitForSelector('.toast:has-text("Weight logged")');
const toastEl = page.locator('.toast:has-text("Weight logged")');
step('weigh-in toast shows the trend, not a verdict', /trend \d+\.\d kg/.test(await toastEl.textContent()), await toastEl.textContent());
step('…and is never red', !(await toastEl.getAttribute('class')).includes('error')
  && (await toastEl.evaluate((n) => getComputedStyle(n).backgroundColor)) !== (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--danger'))));

await page.click('.segmented button:has-text("Metrics")');
await page.waitForSelector('.trend-card');
step('Metrics: the headline is the trend weight', /^\d+\.\d$/.test((await page.textContent('.trend-value')).replace(/\s*kg$/, '').trim()));
const chip = page.locator('.today-chip');
step('today’s raw weigh-in is smaller, with a neutral vs-trend delta', /Today 101\.5 kg · [+−]\d+\.\d vs trend/.test(await chip.textContent())
  && !(await chip.evaluate((n) => /danger|ok|warn/.test(n.className))), await chip.textContent());
step('…plus the water note', /mostly water/.test(await page.textContent('.trend-card')));
await page.click('.range-pills button:has-text("All")');
const chart = await page.evaluate(() => ({
  dots: document.querySelectorAll('.chart-card .raw-dot').length,
  lines: document.querySelectorAll('.chart-card .series-line').length,
  lineDots: document.querySelectorAll('.chart-card .series-dot').length,
}));
step('chart: every weigh-in as a muted dot, under one trend line', chart.dots === 41 && chart.lines === 1 && chart.lineDots === 0, JSON.stringify(chart));
step('rate card: −kg/wk ± se from N weigh-ins', /[−+]\d+\.\d kg\/wk/.test(await page.textContent('[data-stat="rate"]')) && /from \d+ weigh-ins/.test(await page.textContent('[data-stat="rate"]')));
step('goal card with a rough ETA', /To goal \(90 kg\)/.test(await page.textContent('[data-stat="goal"]')) && /rough|No clear rate/.test(await page.textContent('[data-stat="goal"]')));
step('no red anywhere in the weight section', !(await page.evaluate(() => [...document.querySelectorAll('.trend-card *, .chart-card *, .trend-stats *')]
  .some((n) => /danger|error/.test(n.className?.baseVal ?? n.className)))));

// ---------- UI: Review and the Today banner ----------
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const fmt = (x) => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  const now = new Date();
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7); // last week's Monday
  const bench = { ...m.makeExercise({ name: 'Bench', modality: 'barbell' }), id: 'b', primaryTargets: ['chest'] };
  const plan = m.makePlan({ name: 'P', startDate: fmt(monday) });
  const week = m.makeWeek(1);
  week.sessions.push({ ...m.makeSession({ label: 'Mon', dayOffset: 0 }), id: 'sA', blocks: [{ id: 'x', type: 'main', items: [{ id: 'iA', exerciseId: 'b', target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12 } }] }] });
  plan.weeks.push(week);
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([bench]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    { ...m.makeLogEntry({ date: fmt(monday), exerciseId: 'b', planId: plan.id, plannedExerciseId: 'iA', actual: { sets: 3, reps: 10, weight: 60 } }), id: 'L' },
  ]));
});
await page.reload();
await page.waitForSelector('[data-banner="review"]');
step('Today: a banner when last week’s review hasn’t been seen', /week in review is ready/.test(await page.textContent('[data-banner="review"]')));
await page.click('[data-banner="review"] .row-main');
await page.waitForSelector('.rec-card');
step('Review opens on last week', /Last week/.test(await page.textContent('.section-title')) && (await page.textContent('#page-title')) === 'Review');
step('…with exactly one recommendation', (await page.locator('.rec-card').count()) === 1);
step('…and sessions as counts, no streaks', /1 of 1/.test(await page.textContent('#view')) && !/streak/i.test(await page.textContent('#view')));
await page.click('button:has-text("This week so far")');
step('“This week so far” switches the window', /This week/.test(await page.textContent('.section-title')) && /so far/.test(await page.textContent('.section-head')));
await page.click('.segmented button:has-text("Today")');
step('the banner is gone once seen', !(await page.isVisible('[data-banner="review"]')));
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('390px: no horizontal overflow', ov <= 0);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
