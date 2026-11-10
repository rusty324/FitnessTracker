// Desktop redesign, batch 2: the weekly Review in two columns with a
// "Ready to progress" card, and the exercise page with a library sidebar,
// Next time + the rule, the top set by session with the suggested step, and
// what the rule said after each recent session. Phones unchanged.
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
    const bench = { ...m.makeExercise({ name: 'Dumbbell Bench Press', modality: 'dumbbell' }), id: 'b', primaryTargets: ['chest'] };
    const push = { ...m.makeExercise({ name: 'Push-Up', modality: 'bodyweight' }), id: 'p', primaryTargets: ['chest'],
      variants: [1, 2, 3].map((level) => ({ level, name: ['Wall', 'High Incline', 'Low Incline'][level - 1] })) };
    const walk = { ...m.makeExercise({ name: 'Easy Run', category: 'cardio', modality: 'run', measurementType: 'duration' }), id: 'r' };
    // A plan that keeps prescribing them (so suggestions have a target).
    const plan = m.makePlan({ name: 'Gym', startDate: d(70) });
    for (let w = 1; w <= 12; w++) {
      const week = m.makeWeek(w);
      week.sessions.push({ ...m.makeSession({ label: `W${w}`, dayOffset: (w - 1) * 7 }), id: `s${w}`,
        blocks: [{ id: `k${w}`, type: 'strength', items: [
          { id: `ib${w}`, exerciseId: 'b', target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12 } },
          { id: `ip${w}`, exerciseId: 'p', target: { kind: 'reps', sets: 3, reps: 10, variantLevel: 2 } }] }] });
      plan.weeks.push(week);
    }
    // 30 → 35 → 40 lb, the last at the top of the range: try 45.
    const lb = (x) => Math.round((x / 2.20462262) * 1000) / 1000;
    const hist = [[42, 30, [12, 12, 12]], [35, 35, [8, 8, 8]], [28, 35, [12, 12, 12]], [21, 40, [8, 8, 7]], [14, 40, [10, 10, 10]], [7, 40, [12, 12, 12]]];
    const logs = hist.map(([back, w, reps], i) => ({ ...m.makeLogEntry({ date: d(back), exerciseId: 'b', planId: plan.id, plannedExerciseId: `ib${i + 1}`, actual: { sets: 3, setReps: reps, weight: lb(w) } }), id: `h${i}` }));
    logs.push({ ...m.makeLogEntry({ date: d(9), exerciseId: 'p', actual: { sets: 3, reps: 10, variantLevel: 2 } }), id: 'p1' });
    logs.push({ ...m.makeLogEntry({ date: d(5), exerciseId: 'p', actual: { sets: 3, reps: 10, variantLevel: 2 } }), id: 'p2' });
    localStorage.clear();
    localStorage.setItem('ft.welcomed', '1');
    localStorage.setItem('ft.units', JSON.stringify({ weight: 'lb', distance: 'mi', length: 'in' }));
    localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([bench, push, walk]));
    localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
    localStorage.setItem('ft.data.data/logs.json', JSON.stringify(logs));
  });
  await page.reload();
  await page.waitForSelector('.segmented button');
  return page;
}

// ---------- Review ----------
let page = await open({ width: 1280, height: 1000 });
await page.click('.segmented button:has-text("Review")');
await page.waitForSelector('.rec-card');
const cols = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.review-cols > .col-half')].map((x) => x.getBoundingClientRect());
  return { n: c.length, side: c.length === 2 && c[1].left > c[0].right - 1, wide: document.getElementById('view').classList.contains('wide') };
});
step('Review: two columns at full width', cols.n === 2 && cols.side && cols.wide, JSON.stringify(cols));
step('…the one thing on the left', (await page.locator('.review-cols > .col-half').first().locator('.rec-card').count()) === 1);
const ready = page.locator('[data-card="ready"]');
step('Ready to progress lists each suggestion with its evidence', /Dumbbell Bench Press/.test(await ready.textContent())
  && /Try 45 lb/.test(await ready.textContent()) && /12\/12\/12 at 40 lb/.test(await ready.textContent())
  && /Move up: Low Incline/.test(await ready.textContent()), await ready.textContent());

// ---------- the exercise page ----------
await page.goto(`${BASE}#/library/exercise/b`);
await page.reload();
await page.waitForSelector('.lib-side');
const libLay = await page.evaluate(() => {
  const side = document.querySelector('.col-lib').getBoundingClientRect();
  const main = document.querySelector('.col-lib + .col-main').getBoundingClientRect();
  return { side: side.right <= main.left + 1, w: side.width };
});
step('exercise page: the library as a sidebar beside it', libLay.side && libLay.w >= 260 && libLay.w <= 300, JSON.stringify(libLay));
const item = (name) => page.locator(`.lib-item:has-text("${name}")`);
step('sidebar: the open exercise is marked', (await item('Dumbbell Bench Press').getAttribute('aria-current')) === 'page');
step('sidebar: each suggestion as a hint (↑ 45 lb, ↑ Level 3)', /↑ 45 lb/.test(await item('Dumbbell Bench Press').textContent())
  && /↑ Level 3/.test(await item('Push-Up').textContent()));
await page.fill('.lib-side input[type="search"]', 'push');
step('sidebar: search narrows the list', (await page.locator('.lib-item').count()) === 1);
await page.fill('.lib-side input[type="search"]', '');
await page.click('.lib-chips button:has-text("Cardio")');
step('sidebar: category chips', (await page.locator('.lib-item').allTextContents()).join() === 'Easy Run');
await page.click('.lib-chips button:has-text("All")');

const next = page.locator('[data-card="next"]');
step('Next time: the suggestion, big — 45 lb × 8–12', /45 lb × 8–12/.test(await next.locator('.next-big').textContent()), await next.locator('.next-big').textContent());
step('…with the evidence and the rule', /12\/12\/12 at 40 lb/.test(await next.textContent()) && /The rule/.test(await next.textContent())
  && /Add weight once every working set reaches the top/.test(await next.textContent()));
const chart = page.locator('[data-card="progress"] svg');
step('chart: a point per session, reps underneath', (await chart.locator('.series-dot').count()) === 6 && (await chart.locator('.reps-label').first().textContent()) === '12·12·12');
step('chart: a dashed step to “Try 45”', (await chart.locator('.next-line').count()) === 1 && /Try 45/.test(await chart.textContent()));
const ticks = await chart.locator('.tick-label').allTextContents();
step('chart: round weight ticks (30, 35, 40, 45)', ['30', '35', '40', '45'].every((t) => ticks.includes(t)), ticks.slice(0, 6).join());
const rows = await page.locator('[data-card="recent-sessions"] tbody tr').allTextContents();
step('recent sessions: what the rule said after each', /40 lb.*12 · 12 · 12.*Add 5 lb/.test(rows[0]) && /Hold/.test(rows[1]), rows.slice(0, 2).join(' | '));
step('…replayed per session (the 35 lb top-of-range session said add too)', rows.some((r) => /35 lb.*12 · 12 · 12.*Add 5 lb/.test(r)));

await item('Push-Up').click();
await page.waitForSelector('.page-h1:has-text("Push-Up")');
step('clicking the sidebar opens that exercise', (await item('Push-Up').getAttribute('aria-current')) === 'page');
const pticks = await page.locator('[data-card="progress"] .tick-label').allTextContents();
step('a ladder charts its level, ticked in whole levels', /Level 3/.test(await page.textContent('[data-card="progress"]'))
  && pticks.filter((t) => /^\d+(\.\d+)?$/.test(t)).every((t) => Number.isInteger(Number(t))), pticks.join());
step('…and its rule is the ladder rule', /Move up a level after two sessions/.test(await page.textContent('[data-card="next"]')));
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('1280px: no horizontal overflow', ov <= 0);

// ---------- phone: unchanged ----------
page = await open({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
await page.goto(`${BASE}#/library/exercise/b`);
await page.reload();
await page.waitForSelector('.next-time');
step('phone: no sidebar, no desktop cards', (await page.locator('.col-lib, [data-card="next"], [data-card="progress"]').count()) === 0);
await page.goto(`${BASE}#/logs`);
await page.click('.segmented button:has-text("Review")');
await page.waitForSelector('.rec-card');
step('phone: Review in one column, no Ready card', (await page.locator('.review-cols, [data-card="ready"]').count()) === 0);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
