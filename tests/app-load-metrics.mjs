// Load metrics in the app: the log form's Variant select, variant resolution
// for old logs, inference for exercises with no loadModel, presets carrying
// fractions, the Push-Up ladder migration, the goal-weight toggle (display
// only), and phone layout. The math itself is in app-load.mjs.
import { BASE, chromium, reporter } from './lib.mjs';
import { readFile } from 'node:fs/promises';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const readJson = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8'));
const stored = (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(`ft.data.data/${key}.json`) ?? '[]'), k);
const byName = async (name) => (await stored('exercises')).find((e) => e.name === name);
const pack = await readJson('presets/exercises/running-and-calisthenics.json');
const planFile = await readJson('presets/plans/couch-to-10k-26-week.plan.json');

// ---------- the plan's variant levels mean what the plan says ----------
{
  const bad = [];
  for (const w of planFile.weeks) for (const s of w.sessions) for (const b of s.blocks) for (const it of b.items ?? []) {
    const lvl = it.target?.variantLevel;
    if (lvl == null) continue;
    const embedded = planFile.exerciseLibrary[it.exerciseId];
    const inPack = Object.values(pack.exerciseLibrary).find((e) => e.name.toLowerCase() === embedded.name.toLowerCase());
    const name = (lib) => lib?.variants?.find((v) => v.level === lvl)?.name;
    // The plan's copy and the pack's (which import resolves to by name)
    // must agree on what each level is.
    if (!name(embedded) || name(embedded) !== name(inPack)) bad.push(`${it.exerciseId} L${lvl}: ${name(embedded)} vs ${name(inPack)}`);
  }
  step('every plan variantLevel names the same variant in the plan and the pack', bad.length === 0, [...new Set(bad)].join('; '));
  const push = planFile.exerciseLibrary.push_up.variants;
  step('push-up L3/L4/L5 are Low Incline, Knee, Standard',
    ['Low Incline Push-Up', 'Knee Push-Up', 'Standard Push-Up'].every((n, i) => push.find((v) => v.level === i + 3).name === n));
  const fr = (key) => pack.exerciseLibrary[key].variants.map((v) => v.bodyweightFraction);
  const nonDecreasing = (xs) => xs.filter((x) => x != null).every((x, i, a) => i === 0 || x >= a[i - 1]);
  step('ladder fractions never decrease (nulls aside)',
    ['push_up', 'pull_up', 'parallel_bar_dip', 'squat'].every((k) => nonDecreasing(fr(k))));
  const files = ['running-and-calisthenics', 'barbell-basics', 'dumbbell-essentials', 'cardio-cross-training'];
  const missing = [];
  for (const f of files) {
    for (const e of Object.values((await readJson(`presets/exercises/${f}.json`)).exerciseLibrary)) if (!e.loadModel) missing.push(e.name);
  }
  for (const e of Object.values(planFile.exerciseLibrary)) if (!e.loadModel) missing.push(e.name);
  step('every pack and plan exercise declares a loadModel', missing.length === 0, missing.join(', '));
}

// ---------- seed: an old-ladder Push-Up, an edited Dip, logs ----------
await page.goto(BASE);
await page.waitForSelector('.tabbar button');
const OLD = ['Knee Push-Up', 'Standard Push-Up', 'Diamond (Triceps) Push-Up', 'Archer Push-Up',
  'Typewriter Push-Up', 'One-Arm Push-Up (Assisted)', 'One-Arm Push-Up (Full)'];
await page.evaluate(async (OLD) => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const push = { ...m.makeExercise({ name: 'Push-Up', modality: 'bodyweight' }), id: 'ex-push',
    variants: OLD.map((name, i) => ({ level: i + 1, name })) };
  const bench = { ...m.makeExercise({ name: 'Old Bench', modality: 'barbell' }), id: 'ex-bench' }; // no loadModel
  const plan = m.makePlan({ name: 'P', startDate: d(0) });
  const week = m.makeWeek(1);
  const session = m.makeSession({ label: 'Day 1', dayOffset: 0 });
  const block = m.makeBlock({});
  block.items.push({ ...m.makeBlockItem({ exerciseId: push.id, target: { kind: 'reps', sets: 2, reps: 8, variantLevel: 5 } }), id: 'pi-push' });
  session.blocks.push(block); week.sessions.push(session); plan.weeks.push(week);
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([push, bench]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    // logged against the plan before variantLevel existed: resolves to L5
    { ...m.makeLogEntry({ date: d(3), exerciseId: push.id, planId: plan.id, plannedExerciseId: 'pi-push', actual: { sets: 2, reps: 8 } }), id: 'old-push' },
    { ...m.makeLogEntry({ date: d(4), exerciseId: bench.id, actual: { sets: 3, reps: 5, weight: 100 } }), id: 'b1' },
    { ...m.makeLogEntry({ date: d(2), exerciseId: bench.id, actual: { sets: 3, reps: 5, weight: 105 } }), id: 'b2' },
  ]));
  localStorage.setItem('ft.data.data/goals.json', JSON.stringify([{ ...m.makeGoal({ type: 'bodyweight' }), targetWeight: 75 }]));
  localStorage.setItem('ft.data.data/metrics.json', JSON.stringify([m.makeBodyMetric({ date: d(10), weight: 80 })]));
}, OLD);
await page.reload();
await page.waitForSelector('.toast:has-text("Push-Up ladder")');

// ---------- migration ----------
const pushRec = await byName('Push-Up');
step('an exact old Push-Up ladder is replaced with the new one',
  pushRec.variants.length === 11 && pushRec.variants[0].name === 'Wall Push-Up' && pushRec.variants[4].name === 'Standard Push-Up');
step('… with its fractions', pushRec.variants[4].bodyweightFraction === 0.64);
step('the explicit loadModel arrives from the pack', pushRec.loadModel === 'bw_e1rm');
step('an exercise with no pack match keeps no loadModel (inferred instead)', (await byName('Old Bench')).loadModel === undefined);

// ---------- variant select: prefill from the plan target, save ----------
await page.waitForSelector('.ex-card:has-text("Push-Up") button:has-text("Details")');
await page.click('.ex-card:has-text("Push-Up") button:has-text("Details")');
await page.waitForSelector('.modal [data-name="variant"]');
step('Variant prefills from the plan target (L5 Standard)',
  (await page.inputValue('.modal [data-name="variant"]')) === '5'
  && /L5 · Standard Push-Up/.test(await page.$eval('.modal [data-name="variant"]', (s) => s.selectedOptions[0].textContent)));
await page.selectOption('.modal [data-name="variant"]', '4');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
const newLog = (await stored('logs')).find((l) => l.exerciseId === 'ex-push' && l.id !== 'old-push');
step('the chosen level is saved as actual.variantLevel', newLog?.actual.variantLevel === 4, JSON.stringify(newLog?.actual));

// An old log opened and saved untouched gains nothing.
await page.click('.segmented button:has-text("History")');
await page.click('.list-row:has(.row-sub:has-text("2 × 8")) >> nth=-1');
await page.waitForSelector('.modal [data-name="variant"]');
step('an old log’s select shows what it resolves to (the plan’s L5)', (await page.inputValue('.modal [data-name="variant"]')) === '5');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
step('saving it untouched writes no variantLevel',
  !('variantLevel' in (await stored('logs')).find((l) => l.id === 'old-push').actual));

// A new ad-hoc log (no plan target) prefills the last level logged.
await page.click('.segmented button:has-text("Today")');
await page.click('button:has-text("Log ad-hoc")');
await page.fill('.modal input[placeholder^="Search"]', 'Push-Up');
await page.click('.modal .list-row:has-text("Push-Up")');
await page.waitForSelector('.modal [data-name="variant"]');
step('ad-hoc: prefills the level last logged (L4)', (await page.inputValue('.modal [data-name="variant"]')) === '4');
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- exercise page ----------
await page.goto(`${BASE}/#/library/exercise/ex-push`);
await page.reload();
await page.waitForSelector('.load-section');
let text = await page.textContent('.load-section');
// Standard (0.64) × 80 kg = 51.2 kg × 8 reps → 51.2·32/29 = 56.5
step('old plan-linked log scores at the plan’s variant: 56.5 kg', /Bodyweight-adjusted est\. 5-rep max/.test(text) && /56\.5 kg · 4-wk best/.test(text), text.slice(0, 300));
step('its row names the variant', /8 reps at 51\.2 kg effective · Standard Push-Up/.test(text));

await page.goto(`${BASE}/#/library/exercise/ex-bench`);
await page.reload();
await page.waitForSelector('.load-section');
text = await page.textContent('.load-section');
step('a barbell exercise with no loadModel is inferred as est. 1RM', /Est\. 1RM/.test(text) && /118\.1 kg · 4-wk best/.test(text) && /112\.5 kg · 4-wk best/.test(text), text.slice(0, 300));
step('the rolling 4-week best rides along', /118\.1 kg · 4-wk best 118\.1 kg/.test(text));
step('a chart is drawn', await page.isVisible('.load-section svg polyline, .load-section svg path'));

// ---------- goal-weight toggle: display only ----------
const logsBefore = await page.evaluate(() => localStorage.getItem('ft.data.data/logs.json'));
await page.check('.load-section [data-name="loadScale"]');
await page.waitForSelector('.load-section:has-text("scaled to goal")');
text = await page.textContent('.load-section');
// 118.125 × 75/80 = 110.7
step('scaled: value × goal ÷ body weight', /110\.7 kg · 4-wk best/.test(text), text.slice(0, 300));
step('the toggle persists in localStorage', await page.evaluate(() => localStorage.getItem('ft.loadScale')) === '1');
step('…and nothing scaled is written to the logs', await page.evaluate(() => localStorage.getItem('ft.data.data/logs.json')) === logsBefore);
await page.reload();
await page.waitForSelector('.load-section');
step('still on after a reload', await page.isChecked('.load-section [data-name="loadScale"]'));
await page.uncheck('.load-section [data-name="loadScale"]');
await page.waitForSelector('.load-section:has-text("118.1 kg")');
step('off removes the key', await page.evaluate(() => localStorage.getItem('ft.loadScale')) === null);

const layout = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('390px: no horizontal overflow on the exercise page', layout <= 0, `${layout}px`);

// ---------- over the cap: falls back to reps, says why ----------
await page.evaluate(async () => {
  const k = 'ft.data.data/logs.json';
  const all = JSON.parse(localStorage.getItem(k));
  all.push({ id: 'push-14', date: all[0].date, exerciseId: 'ex-push', planId: null, plannedExerciseId: null,
    actual: { sets: 1, reps: 14, variantLevel: 3 }, notes: '', rpe: null, source: 'manual' });
  localStorage.setItem(k, JSON.stringify(all));
});
await page.goto(`${BASE}/#/library/exercise/ex-push`);
await page.reload();
await page.waitForSelector('.load-section');
text = await page.textContent('.load-section');
step('14 reps falls back to “Best set: 14 reps · Low Incline”', /Best set: 14 reps · Low Incline Push-Up/.test(text));
step('…with the reason', /Over the 12-rep cap, so showing reps\./.test(text));

// ---------- an edited ladder is left alone, once-only notice ----------
const page2 = await browser.newPage({ viewport: { width: 390, height: 820 } });
page2.on('pageerror', (e) => errors.push(String(e)));
await page2.goto(BASE);
await page2.waitForSelector('.tabbar button');
await page2.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([{
    id: 'ex-p', name: 'Push-Up', modality: 'bodyweight', category: 'strength', measurementType: 'reps', positions: ['plank'],
    variants: [{ level: 1, name: 'Knee Push-Up' }, { level: 2, name: 'My Standard' }],
  }, {
    id: 'ex-pu', name: 'Pull-Up', modality: 'bodyweight', category: 'strength', measurementType: 'reps', positions: ['hanging'],
    variants: [{ level: 1, name: 'Inverted Row (Feet Planted, High Bar)' }, { level: 2, name: 'My Own Row' }],
  }]));
});
await page2.reload();
await page2.waitForSelector('.toast:has-text("left as is")');
const ex2 = await page2.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/exercises.json')));
step('an edited Push-Up ladder is untouched', JSON.stringify(ex2[0].variants) === JSON.stringify([{ level: 1, name: 'Knee Push-Up' }, { level: 2, name: 'My Standard' }]));
step('fractions fill by level only where names match',
  ex2[1].variants[0].bodyweightFraction === 0.4 && !('bodyweightFraction' in ex2[1].variants[1]), JSON.stringify(ex2[1].variants));
await page2.reload();
await page2.waitForSelector('.tabbar button');
await page2.waitForTimeout(800);
step('the edited-ladder notice shows once', !(await page2.isVisible('.toast:has-text("left as is")')));

// ---------- importing a plan brings the fields along ----------
const imported = await page2.evaluate(async (data) => {
  localStorage.setItem('ft.data.data/exercises.json', '[]');
  const { importPlan } = await import('/js/ui/plans-tab.js');
  importPlan(data, '2026-01-05');
  return JSON.parse(localStorage.getItem('ft.data.data/exercises.json'));
}, planFile);
const ip = imported.find((e) => e.name === 'Push-Up');
step('plan import creates exercises with loadModel and variant fractions',
  ip.loadModel === 'bw_e1rm' && ip.variants[2].bodyweightFraction === 0.48
  && imported.find((e) => e.name === 'Run/Walk Intervals').loadModel === 'cardio');
const exported = await page2.evaluate(async () => {
  const { exerciseDef } = await import('/js/ui/plans-tab.js');
  const lib = JSON.parse(localStorage.getItem('ft.data.data/exercises.json'));
  return exerciseDef({ ...lib.find((e) => e.name === 'Push-Up'), referenceReps: 6, bodyweightFraction: 0.6 });
});
step('export carries loadModel, referenceReps, bodyweightFraction and variant fractions',
  exported.loadModel === 'bw_e1rm' && exported.referenceReps === 6 && exported.bodyweightFraction === 0.6
  && exported.variants[4].bodyweightFraction === 0.64);

// ---------- the exercise editor ----------
await page.goto(`${BASE}/#/library/exercise/ex-bench`);
await page.reload();
await page.click('button:has-text("Edit")');
await page.waitForSelector('.modal [data-name="loadModel"]');
step('editor: Auto shows the inferred model', /Auto \(Est\. 1RM/.test(await page.$eval('.modal [data-name="loadModel"]', (s) => s.selectedOptions[0].textContent)));
step('editor: reference reps hidden unless erm_ref', await page.isHidden('.modal [data-name="referenceReps"]'));
await page.selectOption('.modal [data-name="loadModel"]', 'erm_ref');
step('…shown for erm_ref', await page.isVisible('.modal [data-name="referenceReps"]'));
await page.fill('.modal [data-name="referenceReps"]', '20');
await page.click('.modal-actions button:has-text("Save")');
step('reference reps over 15 are refused', await page.isVisible('.toast:has-text("1 to 15")'));
await page.fill('.modal [data-name="referenceReps"]', '6');
await page.fill('.modal [data-name="bodyweightFraction"]', '0.5');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.modal', { state: 'detached' });
let benchRec = await byName('Old Bench');
step('saves loadModel, referenceReps, bodyweightFraction',
  benchRec.loadModel === 'erm_ref' && benchRec.referenceReps === 6 && benchRec.bodyweightFraction === 0.5, JSON.stringify(benchRec));
await page.waitForSelector('.load-section:has-text("Est. 6-rep max")');
step('the page follows the new model (est. 6-rep max)', true);
await page.click('button:has-text("Edit")');
await page.waitForSelector('.modal [data-name="loadModel"]');
await page.selectOption('.modal [data-name="loadModel"]', '');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.modal', { state: 'detached' });
benchRec = await byName('Old Bench');
step('Auto removes loadModel; untouched fields stay', benchRec.loadModel === undefined && benchRec.referenceReps === 6 && benchRec.bodyweightFraction === 0.5);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
