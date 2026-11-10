// Desktop redesign (the owner's design canvas), batch 1: Today in two
// columns with a side panel, the "Last" column in set rows, keyboard
// shortcuts, and Metrics with a metric switcher and recent-entries tables.
// Phones keep their layout.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const errors = [];

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('.tabbar button');
  await page.evaluate(async () => {
    const m = await import('/js/models.js');
    const p = (n) => String(n).padStart(2, '0');
    const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
    const bench = { ...m.makeExercise({ name: 'Dumbbell Bench Press', modality: 'dumbbell' }), id: 'ex-bench' };
    // Sessions yesterday (logged), today and tomorrow.
    const plan = m.makePlan({ name: 'Gym', startDate: d(1) });
    const week = m.makeWeek(1);
    for (const [k, off] of [[1, 0], [2, 1], [3, 2]]) {
      week.sessions.push({ ...m.makeSession({ label: `Session ${k}`, dayOffset: off }), id: `s${k}`,
        blocks: [{ id: `b${k}`, type: 'strength', items: [{ id: `i${k}`, exerciseId: 'ex-bench', target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 90 } }] }] });
    }
    plan.weeks.push(week);
    localStorage.clear();
    localStorage.setItem('ft.welcomed', '1');
    localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([bench]));
    localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
    localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
      { ...m.makeLogEntry({ date: d(1), exerciseId: 'ex-bench', planId: plan.id, plannedExerciseId: 'i1', actual: { sets: 3, setReps: [12, 11, 10], weight: 20 } }), id: 'L1' }]));
    const met = [];
    for (let i = 30; i >= 1; i--) met.push({ ...m.makeBodyMetric({ date: d(i), weight: 100 - (30 - i) * 0.1, waist: i % 5 ? null : 90 + i / 10 }) });
    localStorage.setItem('ft.data.data/metrics.json', JSON.stringify(met));
  });
  await page.reload();
  await page.waitForSelector('.segmented button');
  return page;
}

// ---------- desktop Today ----------
let page = await open({ width: 1280, height: 900 });
await page.waitForSelector('.ex-card.is-open');
const lay = await page.evaluate(() => {
  const main = document.querySelector('.col-main')?.getBoundingClientRect();
  const side = document.querySelector('.col-side')?.getBoundingClientRect();
  return { wide: document.getElementById('view').classList.contains('wide'), main, side, viewW: document.getElementById('view').getBoundingClientRect().width };
});
step('desktop Today: the wide 1200px column', lay.wide && lay.viewW > 1100, String(lay.viewW));
step('…in two columns: session left, side panel right', lay.main && lay.side && lay.side.left > lay.main.right - 1 && Math.abs(lay.side.top - lay.main.top) < 60);
const side = page.locator('.col-side');
step('side panel: the weigh-in', await side.locator('input[aria-label^="Weight"], .pill:has-text("weighed in")').count() > 0);
step('side panel: last time for the open exercise, set by set', /Last time/.test(await side.locator('[data-side="last"]').textContent())
  && (await side.locator('[data-side="last"] .side-row').count()) === 3 && /20 kg × 12/.test(await side.locator('[data-side="last"]').textContent()));
step('side panel: the weight trend', /Weight trend/.test(await side.locator('[data-side="trend"]').textContent())
  && (await side.locator('[data-side="trend"] svg').count()) === 1);
// Which of yesterday/tomorrow fall in "this week" depends on today's weekday.
const week = await side.locator('[data-side="week"]').textContent();
const inWeek = await page.evaluate(() => {
  const p = (n) => String(n).padStart(2, '0');
  const f = (x) => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  const now = new Date();
  const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const t = new Date(now); t.setDate(now.getDate() + 1);
  return { yesterday: f(y) >= f(mon), tomorrow: f(t) <= f(sun) };
});
const planned = 1 + inWeek.yesterday + inWeek.tomorrow;
step('side panel: this week, each session Done / Today / Planned',
  new RegExp(`${inWeek.yesterday ? 1 : 0} of ${planned}`).test(week) && /Today/.test(week)
  && (!inWeek.yesterday || /Done/.test(week)) && (!inWeek.tomorrow || /Planned/.test(week)), week);
step('set rows show what each set was last time', (await page.locator('.ex-card.is-open .set-row[data-set="2"] .set-last').textContent()) === '11'
  || /× 11/.test(await page.locator('.ex-card.is-open .set-row[data-set="2"] .set-last').textContent()));
step('…and the weigh-in moved to the side (not in the main column)', (await page.locator('.col-main input[aria-label^="Weight"]').count()) === 0);

// Keyboard: Enter ticks the next set, R skips the rest.
await page.keyboard.press('Enter');
step('Enter ticks the next set', (await page.locator('.ex-card.is-open .set-row[data-set="1"] .set-check').getAttribute('aria-pressed')) === 'true');
step('…and the rest bar shows the shortcuts', await page.isVisible('.rest-bar .rest-hint') && /Enter logs the next set · R skips the rest/.test(await page.textContent('.rest-hint')));
await page.keyboard.press('Enter');
step('Enter again ticks set 2 (not untick set 1)', (await page.locator('.ex-card.is-open .set-row[data-set="1"] .set-check').getAttribute('aria-pressed')) === 'true'
  && (await page.locator('.ex-card.is-open .set-row[data-set="2"] .set-check').getAttribute('aria-pressed')) === 'true');
await page.keyboard.press('r');
step('R skips the rest', await page.isHidden('.rest-bar'));
await page.fill('.ex-card.is-open .set-row[data-set="3"] [data-name="reps"]', '9');
await page.keyboard.press('Enter');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json')).some((l) => l.plannedExerciseId === 'i2'));
step('Enter in a set’s field ticks that set (as typed)', await page.evaluate(() =>
  JSON.parse(localStorage.getItem('ft.data.data/logs.json')).find((l) => l.plannedExerciseId === 'i2').actual.setReps?.[2] === 9));
await page.click('.segmented button:has-text("Today")');
await page.fill('.col-side input[aria-label^="Weight"]', '98');
await page.keyboard.press('Enter');
step('Enter elsewhere (the weigh-in) is left alone', (await page.locator('.modal').count()) === 0);

// ---------- desktop Metrics ----------
await page.click('.segmented button:has-text("Metrics")');
await page.waitForSelector('.metric-tabs');
step('Metrics: Weight | Waist | Resting HR | Run pace', (await page.$$eval('.metric-tabs button', (bs) => bs.map((b) => b.textContent))).join() === 'Weight,Waist,Resting HR,Run pace');
step('weight: trend, rate and goal tiles, the chart', await page.isVisible('.trend-card') && await page.isVisible('[data-stat="rate"]')
  && (await page.locator('.chart-card .raw-dot').count()) > 10);
const tbl = page.locator('.col-side [data-side="recent"]');
step('…and recent weigh-ins with trend and vs trend', /Recent weigh-ins/.test(await tbl.textContent())
  && (await tbl.locator('th').allTextContents()).join() === 'Date,Weigh-in,Trend,vs trend' && (await tbl.locator('tbody tr').count()) === 12);
step('no red or green in the weigh-in table', !(await tbl.evaluate((n) => /danger|ok\b|error/.test(n.innerHTML))));
await page.click('.metric-tabs button:has-text("Waist")');
step('Waist: its own chart and table', /Recent waist/.test(await page.textContent('.col-side')) && (await page.locator('.col-side tbody tr').count()) === 6);
await page.click('.metric-tabs button:has-text("Run pace")');
step('Run pace: pace and distance charts', /Pace/.test(await page.textContent('.col-main')) && /Distance/.test(await page.textContent('.col-main')));
step('sessions and the routes heatmap follow below', await page.isVisible('[data-stat="sessions8"]') && await page.isVisible('.heatmap-section'));

// Other tabs keep the reading column.
await page.click('.tabbar button[data-tab="library"]');
await page.waitForSelector('.filter-bar');
step('other tabs don’t inherit the wide layout', !(await page.evaluate(() => document.getElementById('view').classList.contains('wide'))));
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('1280px: no horizontal overflow', ov <= 0);

// ---------- phone: unchanged ----------
page = await open({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
await page.waitForSelector('.ex-card.is-open');
step('phone: no side panel, no Last column', (await page.locator('.col-side').count()) === 0 && (await page.locator('.set-last').count()) === 0);
step('phone: weigh-in stays on Today', (await page.locator('input[aria-label^="Weight"]').count()) === 1);
await page.click('.segmented button:has-text("Metrics")');
step('phone: Metrics without the desktop switcher', (await page.locator('.metric-tabs').count()) === 0 && await page.isVisible('.trend-card'));

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
