// Reps and weight per set, through the set rows (js/ui/set-rows.js) in the
// log form. What must hold whatever the UI: equal sets store the original
// { sets, reps, weight } shape, differing ones setReps / setWeights;
// bodyweight is 0 kg; an untouched old log saves back exactly; an untouched
// converted weight keeps its exact kg; a typed pound value round-trips.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const logs = () => page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json') ?? '[]'));
const logFor = async (exId) => (await logs()).filter((l) => l.exerciseId === exId).at(-1);
const row = (n) => page.locator(`.modal .set-row[data-set="${n}"]`);
const reps = (n) => row(n).locator('[data-name="reps"]');
const weight = (n) => row(n).locator('[data-name="weight"]');
const values = (loc) => loc.evaluateAll((els) => els.map((e) => e.value || `(${e.placeholder})`));
const repVals = () => values(page.locator('.modal .set-row:not(.set-head) [data-name="reps"]'));
const weightVals = () => values(page.locator('.modal .set-row:not(.set-head) [data-name="weight"]'));
const card = (name) => page.locator(`.ex-card:has-text("${name}")`);
// Planned exercises open the full form through their card's Details.
const openPlanned = async (name) => {
  if (!(await card(name).locator('button:has-text("Details")').count())) await card(name).click();
  await card(name).locator('button:has-text("Details")').click();
  await page.waitForSelector('.modal .set-rows');
};
const save = async () => {
  await page.click('.modal-actions button:has-text("Save")');
  await page.waitForSelector('.modal', { state: 'detached' });
};

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const pushup = { ...m.makeExercise({ name: 'Push-Up', modality: 'bodyweight' }), id: 'ex-push' };
  const row = { ...m.makeExercise({ name: 'Dumbbell Row', modality: 'dumbbell' }), id: 'ex-row' };
  const squat = { ...m.makeExercise({ name: 'Goblet Squat', modality: 'dumbbell' }), id: 'ex-squat' };
  const plan = m.makePlan({ name: 'Strength', startDate: d(0) });
  const week = m.makeWeek(1);
  const session = m.makeSession({ label: 'Day 1', dayOffset: 0 });
  const block = m.makeBlock({ type: 'strength' });
  block.items.push(m.makeBlockItem({ exerciseId: pushup.id, target: { kind: 'reps', sets: 5, reps: 20 } }));
  block.items.push(m.makeBlockItem({ exerciseId: row.id, target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 10 } }));
  session.blocks.push(block);
  week.sessions.push(session);
  plan.weeks.push(week);
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([pushup, row, squat]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  // Logged before set rows existed: the old shape, which must come back unchanged.
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    { ...m.makeLogEntry({ date: d(3), exerciseId: squat.id, actual: { sets: 3, reps: 10, weight: 20 } }), id: 'old-squat' },
  ]));
  localStorage.setItem('ft.data.data/goals.json', JSON.stringify([{ ...m.makeGoal({ type: 'bodyweight' }), targetWeight: 70 }]));
  localStorage.setItem('ft.data.data/metrics.json', JSON.stringify([m.makeBodyMetric({ date: d(1), weight: 80 })]));
});
await page.reload();
await page.waitForSelector('.ex-card:has-text("Push-Up")');

// ---------- the plan's 5 × 20, bodyweight ----------
await openPlanned('Push-Up');
step('the plan’s 5 sets make five rows', (await row(5).count()) === 1 && (await row(6).count()) === 0);
step('with 20 as each row’s ghost', (await repVals()).join() === '(20),(20),(20),(20),(20)', (await repVals()).join());
step('a bodyweight exercise hides the weight column', (await page.locator('.modal [data-name="weight"]').count()) === 0
  && await page.isVisible('.modal button:has-text("+ Add weight")'));
for (const n of [1, 2, 3]) await row(n).locator('.set-check').click();
await reps(4).fill('15');
await reps(5).fill('12');
await save();
let push = await logFor('ex-push');
step('ticked ghosts and typed sets are stored — as bodyweight',
  JSON.stringify(push.actual) === '{"sets":5,"setReps":[20,20,20,15,12],"weight":0}', JSON.stringify(push.actual));

// ---------- reopening, removing a set (with Undo), equal sets ----------
await page.click('.segmented button:has-text("History")');
await page.click('.list-row:has-text("Push-Up") .row-main');
await page.waitForSelector('.modal .set-rows');
step('reopening shows each set as logged', (await repVals()).join() === '20,20,20,15,12');
await page.click('.modal button:has-text("− Remove set")');
step('removing a set drops the last one', (await repVals()).join() === '20,20,20,15');
await page.click('.toast-undo button:has-text("Undo")');
step('…and Undo brings it back', (await repVals()).join() === '20,20,20,15,12');
for (let i = 0; i < 2; i++) await page.click('.modal button:has-text("− Remove set")');
await page.click('.modal button:has-text("+ Add set")');
step('a new set is a blank row', (await repVals()).length === 4);
for (const n of [1, 2, 3]) await reps(n).fill('18');
await reps(4).fill('18');
await save();
push = await logFor('ex-push');
step('equal sets save in the original shape', JSON.stringify(push.actual) === '{"sets":4,"reps":18,"weight":0}', JSON.stringify(push.actual));
step('and read as 4 × 18 @ bodyweight', /4 × 18 @ bodyweight/.test(await page.textContent('.list-row:has-text("Push-Up")')));

// ---------- steppers ----------
await page.click('.list-row:has-text("Push-Up") .row-main');
await page.waitForSelector('.modal .set-rows');
await row(1).locator('button[aria-label="Set 1 reps plus"]').click();
await row(2).locator('button[aria-label="Set 2 reps minus"]').click();
step('reps steppers move by one', (await repVals()).slice(0, 2).join() === '19,17');
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- weights per set ----------
await page.click('.segmented button:has-text("Today")');
await openPlanned('Dumbbell Row');
step('a rep range ghosts its low end', (await repVals()).join() === '(8),(8),(8)');
step('a weighted exercise shows the weight column', (await page.locator('.modal [data-name="weight"]').count()) === 3);
await reps(1).fill('10'); await weight(1).fill('20');
await reps(2).fill('8'); await weight(2).fill('22.5');
await reps(3).fill('8'); await weight(3).fill('25');
await save();
let r = await logFor('ex-row');
step('each set’s weight is stored', JSON.stringify(r.actual) === '{"sets":3,"setReps":[10,8,8],"setWeights":[20,22.5,25]}', JSON.stringify(r.actual));

// Weight stepper: 2 kg for dumbbells (metric).
await page.click('.segmented button:has-text("History")');
await page.click('.list-row:has-text("Dumbbell Row") .row-main');
await page.waitForSelector('.modal .set-rows');
await row(1).locator('button[aria-label="Set 1 weight plus"]').click();
step('the dumbbell weight step is 2 kg', (await weightVals())[0] === '22', (await weightVals()).join());
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- refused values ----------
await page.click('.list-row:has-text("Dumbbell Row") .row-main');
await page.waitForSelector('.modal .set-rows');
await weight(2).fill('-5');
await page.click('.modal-actions button:has-text("Save")');
step('a negative weight is refused', (await page.locator('.modal').count()) === 1 && await page.isVisible('.toast.error:has-text("negative")'));
await weight(2).fill('22.5');
await reps(3).fill('-3');
await page.click('.modal-actions button:has-text("Save")');
step('negative reps are refused', (await page.locator('.modal').count()) === 1);
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- old data ----------
const oldRow = page.locator('.list-row:has-text("Goblet Squat")');
step('an old log still reads 3 × 10 @ 20 kg', /3 × 10 @ 20 kg/.test(await oldRow.textContent()), await oldRow.textContent());
await oldRow.locator('.row-main').click();
await page.waitForSelector('.modal .set-rows');
step('it opens as three sets of 10 at 20 kg', (await repVals()).join() === '10,10,10' && (await weightVals()).join() === '20,20,20');
await save();
step('saving it untouched keeps its exact shape',
  JSON.stringify((await logs()).find((l) => l.id === 'old-squat').actual) === '{"sets":3,"reps":10,"weight":20}');

// ---------- a weighted set among bodyweight ones ----------
await page.click('.list-row:has-text("Push-Up") .row-main');
await page.waitForSelector('.modal .set-rows');
await page.click('.modal button:has-text("+ Add weight")');
step('+ Add weight shows the weight column', (await page.locator('.modal [data-name="weight"]').count()) === 4);
for (const n of [1, 2, 3]) await weight(n).fill('0');
await weight(4).fill('10');
await save();
push = await logFor('ex-push');
step('bodyweight and weighted sets in one log', JSON.stringify(push.actual) === '{"sets":4,"reps":18,"setWeights":[0,0,0,10]}', JSON.stringify(push.actual));
step('read per set', /4 sets: 18 @ bodyweight, 18 @ bodyweight, 18 @ bodyweight, 18 @ 10 kg/.test(await page.textContent('.list-row:has-text("Push-Up")')));
await page.click('.list-row:has-text("Push-Up") .row-main');
await page.waitForSelector('.modal .set-rows');
step('a log with added weight reopens with the weight column', (await page.locator('.modal [data-name="weight"]').count()) === 4);
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- pounds ----------
await page.evaluate(() => localStorage.setItem('ft.units', JSON.stringify({ weight: 'lb', distance: 'km', length: 'cm' })));
await page.reload();
await page.click('.segmented button:has-text("History")');
await page.click('.list-row:has-text("Goblet Squat") .row-main');
await page.waitForSelector('.modal .set-rows');
step('kilograms show in pounds', (await weightVals()).join() === '44.1,44.1,44.1'
  && /Weight \(lb\)/.test(await page.textContent('.modal .set-head')), (await weightVals()).join());
await save();
step('an untouched weight stays exactly 20 kg (not via 44.1 lb)',
  JSON.stringify((await logs()).find((l) => l.id === 'old-squat').actual) === '{"sets":3,"reps":10,"weight":20}');
await page.click('.list-row:has-text("Goblet Squat") .row-main');
await page.waitForSelector('.modal .set-rows');
await weight(1).fill('135');
await save();
const sq = (await logs()).find((l) => l.id === 'old-squat').actual;
step('135 lb is stored as ≈61.235 kg', Math.abs(sq.setWeights[0] - 61.235) < 0.001, JSON.stringify(sq));
await page.click('.list-row:has-text("Goblet Squat") .row-main');
await page.waitForSelector('.modal .set-rows');
step('…and shows as 135 again', (await weightVals())[0] === '135', (await weightVals()).join());
await row(1).locator('button[aria-label="Set 1 weight plus"]').click();
step('the pound step is 5 lb', (await weightVals())[0] === '140');
await page.click('.modal-actions button:has-text("Cancel")');
await page.evaluate(() => localStorage.setItem('ft.units', JSON.stringify({ weight: 'kg', distance: 'km', length: 'cm' })));

// ---------- RWI counts each set ----------
await page.evaluate(() => {
  const k = 'ft.data.data/logs.json';
  const all = JSON.parse(localStorage.getItem(k));
  all.find((l) => l.exerciseId === 'ex-push').actual = { sets: 5, setReps: [20, 20, 20, 15, 12] };
  localStorage.setItem(k, JSON.stringify(all));
});
await page.goto('about:blank');
await page.goto(`${BASE}/#/library/exercise/ex-push`);
await page.reload();
await page.waitForSelector('text=RWI');
const rwi = await page.textContent('#view');
// goal 70 ÷ weight 80 = 0.875 per rep: 17.5 ×3, 13.1, 10.5; 87 reps → 76.1
step('RWI is per set, from each set’s own reps', /RWI 17\.5 \/ 17\.5 \/ 17\.5 \/ 13\.1 \/ 10\.5 · total 76\.1/.test(rwi), rwi.match(/RWI[^·]*· total [\d.]+/)?.[0]);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
