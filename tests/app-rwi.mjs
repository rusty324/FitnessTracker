// RWI for cardio counts distance and speed, not just time: a mile sprinted
// must outscore the same mile walked. Reps and timed holds are unchanged.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

// ---- the pure function ----
const r = await page.evaluate(async () => {
  const { rwiWork } = await import('/js/rwi.js');
  const MILE = 1609.344;
  return {
    sprint: rwiWork({ distanceM: MILE, movingSec: 360 }),
    walk: rwiWork({ distanceM: MILE, movingSec: 1200 }),
    twoMileWalk: rwiWork({ distanceM: 2 * MILE, movingSec: 2400 }),
    fiveK: rwiWork({ distanceM: 5000, movingSec: 1800 }),
    reps: rwiWork({ sets: 3, reps: 10 }),
    hold: rwiWork({ durationSec: 60 }),
    noDistance: rwiWork({ movingSec: 900 }),
    zeroTime: rwiWork({ distanceM: 1000, movingSec: 0 }),
    empty: rwiWork({}),
  };
});
const near = (a, b) => Math.abs(a - b) < 0.05;
step('a sprinted mile outscores a walked mile', r.sprint.perSet[0] > r.walk.perSet[0] * 3,
  `${r.sprint.perSet[0]} vs ${r.walk.perSet[0]}`);
step('distance basis is km × km/h (6-min mile ≈ 25.9, 30-min 5K = 50)',
  r.sprint.basis === 'distance' && near(r.sprint.perSet[0], 25.9) && near(r.fiveK.perSet[0], 50));
step('twice as far at the same pace scores twice as much', near(r.twoMileWalk.perSet[0], 2 * r.walk.perSet[0]));
step('reps are unchanged', r.reps.basis === 'reps' && r.reps.perSet.join() === '10,10,10');
step('a hold with no distance still counts seconds', r.hold.basis === 'time' && r.hold.perSet[0] === 60);
step('cardio without a distance falls back to seconds', r.noDistance.basis === 'time' && r.noDistance.perSet[0] === 900);
step('a zero time never divides by zero', r.zeroTime.perSet.every(Number.isFinite));
step('nothing logged gives no RWI', r.empty.basis === null && r.empty.perSet.length === 0);

// ---- on the exercise page ----
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const run = { ...m.makeExercise({ name: 'Mile', modality: 'cardio' }), id: 'ex-mile' };
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([run]));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    { ...m.makeLogEntry({ date: d(2), exerciseId: run.id, actual: { distanceM: 1609.344, movingSec: 1200 } }), id: 'walk' },
    { ...m.makeLogEntry({ date: d(1), exerciseId: run.id, actual: { distanceM: 1609.344, movingSec: 360 } }), id: 'sprint' },
  ]));
  localStorage.setItem('ft.data.data/goals.json', JSON.stringify([{ ...m.makeGoal({ type: 'bodyweight' }), targetWeight: 70 }]));
  localStorage.setItem('ft.data.data/metrics.json', JSON.stringify([m.makeBodyMetric({ date: d(3), weight: 80 })]));
});
await page.goto(`${BASE}/#/library/exercise/ex-mile`);
await page.reload();
await page.waitForSelector('text=Relative Work Index');
const titles = await page.$$eval('.card .list-row .row-title', (els) => els.map((e) => e.textContent));
// ratio 70 ÷ 80 = 0.875: sprint 25.9 → 22.7, walk 7.77 → 6.8
step('the page shows the sprint at 22.7, labelled km × km/h', titles.some((t) => t === 'RWI 22.7 (km × km/h)'), titles.join(' | '));
step('and the walk at 6.8', titles.some((t) => t === 'RWI 6.8 (km × km/h)'), titles.join(' | '));
step('the explanation mentions distance', /km × km\/h/.test(await page.textContent('#view')));

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
