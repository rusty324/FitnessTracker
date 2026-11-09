// Different reps and weight for each set: 5 sets planned at 20 can be
// logged as 20, 20, 20, 15, 12, with a weight or "bodyweight" per set, and
// everything that reads sets sees each one.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const boxes = () => page.locator('.modal .sets-table input[data-set]').evaluateAll((els) => els.map((e) => e.value));
const weights = () => page.locator('.modal .sets-table input[data-set-weight]').evaluateAll((els) => els.map((e) => e.value));
const setBox = (n) => page.locator(`.modal .sets-table input[data-set="${n}"]`);
const setWeight = (n) => page.locator(`.modal .sets-table input[data-set-weight="${n}"]`);
const setBw = (n) => page.locator(`.modal .sets-table input[data-set-bw="${n}"]`);
const logs = () => page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json') ?? '[]'));
const logFor = async (exId) => (await logs()).filter((l) => l.exerciseId === exId).at(-1);
const plannedRow = (name) => page.locator(`.card .list-row:has(.row-title:has-text("${name}"))`);

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
  block.items.push(m.makeBlockItem({ exerciseId: row.id, target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 10, weight: 20 } }));
  session.blocks.push(block);
  week.sessions.push(session);
  plan.weeks.push(week);
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([pushup, row, squat]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  // Logged before this feature: the old shape, which must come back unchanged.
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    { ...m.makeLogEntry({ date: d(3), exerciseId: squat.id, actual: { sets: 3, reps: 10, weight: 20 } }), id: 'old-squat' },
  ]));
  localStorage.setItem('ft.data.data/goals.json', JSON.stringify([{ ...m.makeGoal({ type: 'bodyweight' }), targetWeight: 70 }]));
  localStorage.setItem('ft.data.data/metrics.json', JSON.stringify([m.makeBodyMetric({ date: d(1), weight: 80 })]));
});
await page.reload();
await page.waitForSelector('.list-row:has-text("Push-Up")');

// ---------- start from the plan: 5 × 20 ----------
await plannedRow('Push-Up').locator('button:has-text("Log")').click();
await page.waitForSelector('.modal .sets-table');
step('the plan’s 5 × 20 fills five set boxes', (await boxes()).join() === '20,20,20,20,20', (await boxes()).join());
step('with 20 as the every-set value', (await page.inputValue('.modal [data-name="reps"]')) === '20');

// The last two came up short.
await setBox(4).fill('15');
await setBox(5).fill('12');
step('editing a set marks the every-set value as varying',
  (await page.inputValue('.modal [data-name="reps"]')) === '' && (await page.getAttribute('.modal [data-name="reps"]', 'placeholder')) === 'varies');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
let push = await logFor('ex-push');
step('each set’s reps are stored — a bodyweight exercise as bodyweight',
  JSON.stringify(push.actual) === '{"sets":5,"setReps":[20,20,20,15,12],"weight":0}', JSON.stringify(push.actual));
step('Today shows every set', /5 sets: 20, 20, 20, 15, 12 @ bodyweight/.test(await plannedRow('Push-Up').textContent()));

// ---------- edit it ----------
await plannedRow('Push-Up').locator('button:has-text("Edit")').click();
await page.waitForSelector('.modal .sets-table');
step('reopening shows each set as logged', (await boxes()).join() === '20,20,20,15,12');
await page.fill('.modal [data-name="sets"]', '');
step('clearing Sets to retype it removes nothing', (await boxes()).length === 5);
await page.fill('.modal [data-name="sets"]', '3');
step('lowering Sets drops sets from the end', (await boxes()).join() === '20,20,20');
step('three equal sets read as one value again', (await page.inputValue('.modal [data-name="reps"]')) === '20');
await page.fill('.modal [data-name="sets"]', '5');
step('raising it again brings the dropped sets back', (await boxes()).join() === '20,20,20,15,12', (await boxes()).join());
await page.fill('.modal [data-name="sets"]', '6');
step('a new set starts from the last one', (await boxes()).at(-1) === '12');
await page.fill('.modal [data-name="reps"]', '18');
step('Reps (every set) fills every box', (await boxes()).join() === '18,18,18,18,18,18');
await page.fill('.modal [data-name="sets"]', '4');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
push = await logFor('ex-push');
step('equal sets save in the original shape', JSON.stringify(push.actual) === '{"sets":4,"reps":18,"weight":0}', JSON.stringify(push.actual));
step('and read as 4 × 18 @ bodyweight', /4 × 18 @ bodyweight/.test(await plannedRow('Push-Up').textContent()));

// ---------- a rep range, and a skipped set ----------
await plannedRow('Dumbbell Row').locator('button:has-text("Log")').click();
await page.waitForSelector('.modal .sets-table');
step('a rep range leaves the boxes empty with the range as a hint',
  (await boxes()).join() === ',,' && (await setBox(1).getAttribute('placeholder')) === '8–10');
await setBox(1).fill('10');
await setBox(3).fill('8');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
step('a blank set is one that wasn’t done',
  JSON.stringify((await logFor('ex-row')).actual) === '{"sets":2,"setReps":[10,8],"weight":20}', JSON.stringify((await logFor('ex-row')).actual));

await plannedRow('Dumbbell Row').locator('button:has-text("Edit")').click();
await setBox(2).fill('-3');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast.error:has-text("whole numbers")');
step('negative reps are refused', (await page.locator('.modal .sets-table').count()) === 1);
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- an old log comes back unchanged ----------
await page.click('.segmented button:has-text("History")');
const oldRow = page.locator('.list-row:has-text("Goblet Squat")');
step('an old log still reads 3 × 10', /3 × 10 @ 20 kg/.test(await oldRow.textContent()), await oldRow.textContent());
await oldRow.locator('.row-sub').first().click();
await page.waitForSelector('.modal .sets-table');
step('it opens as three sets of 10', (await boxes()).join() === '10,10,10');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
step('saving it untouched keeps its exact shape',
  JSON.stringify((await logs()).find((l) => l.id === 'old-squat').actual) === '{"sets":3,"reps":10,"weight":20}');

// ---------- weight per set ----------
await page.click('.segmented button:has-text("Today")');
await plannedRow('Dumbbell Row').locator('button:has-text("Edit")').click();
await page.waitForSelector('.modal .sets-table');
step('logged weights fill the weight column', (await weights()).join() === '20,20');
step('with 20 as the all-sets weight', (await page.inputValue('.modal [data-name="weight"]')) === '20');
await page.fill('.modal [data-name="sets"]', '3');
step('a new set copies the last one’s reps and weight', (await boxes()).join() === '10,8,8' && (await weights()).join() === '20,20,20');
await setWeight(2).fill('22.5');
await setWeight(3).fill('25');
step('different weights mark the all-sets weight as varying',
  (await page.inputValue('.modal [data-name="weight"]')) === '' && (await page.getAttribute('.modal [data-name="weight"]', 'placeholder')) === 'varies');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
let row = await logFor('ex-row');
step('each set’s weight is stored', JSON.stringify(row.actual) === '{"sets":3,"setReps":[10,8,8],"setWeights":[20,22.5,25]}', JSON.stringify(row.actual));
step('and shown per set', /3 sets: 10 @ 20 kg, 8 @ 22\.5 kg, 8 @ 25 kg/.test(await plannedRow('Dumbbell Row').textContent()),
  await plannedRow('Dumbbell Row').textContent());

await plannedRow('Dumbbell Row').locator('button:has-text("Edit")').click();
await page.fill('.modal [data-name="weight"]', '30');
step('the all-sets weight fills every set', (await weights()).join() === '30,30,30');
await setWeight(1).fill('-5');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast.error:has-text("Weights can’t be negative")');
step('a negative weight is refused', (await page.locator('.modal .sets-table').count()) === 1);
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- bodyweight toggles ----------
await plannedRow('Push-Up').locator('button:has-text("Edit")').click();
await page.waitForSelector('.modal .sets-table');
step('a bodyweight log opens with every set ticked BW',
  await page.isChecked('.modal [data-name="bw"]') && (await setBw(1).isChecked()) && (await setWeight(1).isDisabled()));
await setBw(4).uncheck();
await setWeight(4).fill('10');
step('unticking one set lets it take a weight', !(await setWeight(4).isDisabled()));
step('and the all-sets BW shows part-ticked', await page.evaluate(() => document.querySelector('.modal [data-name="bw"]').indeterminate));
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
push = await logFor('ex-push');
step('a weighted set among bodyweight ones', JSON.stringify(push.actual) === '{"sets":4,"reps":18,"setWeights":[0,0,0,10]}', JSON.stringify(push.actual));
step('reads per set', /4 sets: 18 @ bodyweight, 18 @ bodyweight, 18 @ bodyweight, 18 @ 10 kg/.test(await plannedRow('Push-Up').textContent()));

await plannedRow('Push-Up').locator('button:has-text("Edit")').click();
await setBw(4).check();
step('ticking BW clears and locks the weight', (await setWeight(4).inputValue()) === '' && (await setWeight(4).isDisabled()));
await setBw(4).uncheck();
step('unticking it brings the weight back', (await setWeight(4).inputValue()) === '10');
// Part-ticked, the all-sets box behaves like any checkbox: one tap ticks
// every set, the next frees them all.
await page.click('.modal [data-name="bw"]');
step('tapping a part-ticked all-sets BW makes every set bodyweight',
  (await Promise.all([1, 2, 3, 4].map((n) => setBw(n).isChecked()))).every(Boolean));
await page.click('.modal [data-name="bw"]');
step('tapping it again frees every set', (await Promise.all([1, 2, 3, 4].map((n) => setWeight(n).isDisabled()))).every((d) => !d));
step('and the weight set 4 had comes back', (await setWeight(4).inputValue()) === '10');
await page.click('.modal-actions button:has-text("Cancel")');

// New entries: bodyweight exercises start ticked, weighted ones don't.
await page.click('button:has-text("Log ad-hoc activity")');
await page.click('.modal .list-row.tappable:has-text("Push-Up")');
step('a new bodyweight-exercise log starts as bodyweight, before any sets', await page.isChecked('.modal [data-name="bw"]'));
await page.fill('.modal [data-name="sets"]', '2');
step('and so do the sets added', (await setBw(1).isChecked()) && (await setBw(2).isChecked()));
await page.click('.modal-actions button:has-text("Cancel")');
await page.click('button:has-text("Log ad-hoc activity")');
await page.click('.modal .list-row.tappable:has-text("Goblet Squat")');
await page.fill('.modal [data-name="weight"]', '24');
await page.fill('.modal [data-name="sets"]', '2');
step('a weighted exercise doesn’t, and sets added take the all-sets weight',
  !(await page.isChecked('.modal [data-name="bw"]')) && (await weights()).join() === '24,24');
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- weights in pounds stay exact ----------
await page.evaluate(() => localStorage.setItem('ft.units', JSON.stringify({ weight: 'lb', distance: 'km', length: 'cm' })));
await page.reload();
await page.click('.segmented button:has-text("History")');
await page.locator('.list-row:has-text("Goblet Squat") .row-sub').first().click();
await page.waitForSelector('.modal .sets-table');
step('kilograms show in pounds', (await weights()).join() === '44.1,44.1,44.1' && /Weight \(lb\)/.test(await page.textContent('.modal .sets-table thead')));
await setBox(3).fill('8');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
step('an untouched weight stays exactly 20 kg (not 20.0 via 44.1 lb)',
  JSON.stringify((await logs()).find((l) => l.id === 'old-squat').actual) === '{"sets":3,"setReps":[10,10,8],"weight":20}',
  JSON.stringify((await logs()).find((l) => l.id === 'old-squat').actual));
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
step('the exercise history shows every set', /5 sets: 20, 20, 20, 15, 12/.test(rwi));

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
