// Exercise library search + filters (muscle group, weights, position), the
// editor fields behind them, and filling positions into a library imported
// before positions existed.
import { BASE, chromium, reporter } from './lib.mjs';
import { readFile } from 'node:fs/promises';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let manifestFetches = 0;
page.on('request', (r) => { if (r.url().endsWith('/presets/index.json')) manifestFetches++; });

// A library as an older install has it: every pack exercise, but no
// positions (and a few fields missing), plus one of the user's own and an
// archived one.
const packs = ['running-and-calisthenics', 'barbell-basics', 'dumbbell-essentials', 'cardio-cross-training'];
const seed = [];
for (const p of packs) {
  const lib = JSON.parse(await readFile(`presets/exercises/${p}.json`, 'utf8')).exerciseLibrary;
  for (const [key, def] of Object.entries(lib)) {
    seed.push({
      id: `seed-${key}`, name: def.name, category: def.category, modality: def.modality,
      measurementType: def.measurementType, equipment: def.equipment ?? [], primaryTargets: def.primaryTargets ?? [],
      archived: false,
    });
  }
}
seed.push({ id: 'mine', name: 'My Cable Fly', category: 'strength', modality: 'machine', measurementType: 'reps', equipment: ['cable machine'], primaryTargets: ['chest'], archived: false });
const dip = seed.find((e) => e.name === 'Parallel Bar Dip');
const jump = seed.find((e) => e.name === 'Jump Rope');
jump.archived = true;

const names = () => page.locator('#view .card .row-title').allTextContents();
const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/exercises.json')));
const byName = async (n) => (await lib()).find((e) => e.name === n);
const setFilter = (key, value) => page.selectOption(`select[data-filter="${key}"]`, value);
const optionText = (key, value) => page.locator(`select[data-filter="${key}"] option[value="${value}"]`).textContent();
const clear = async () => {
  if (await page.locator('button:has-text("Clear filters")').count()) await page.click('button:has-text("Clear filters")');
};

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate((s) => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify(s));
}, seed);
await page.reload();
await page.click('.tabbar button[data-tab="library"]');

// ---------- the one-time fill from the bundled packs ----------
await page.waitForSelector('.toast:has-text("from the starter packs")');
step('an older library gets positions filled in from the packs',
  /Filled in muscles, equipment, positions and load settings for \d+ exercises/.test(await page.textContent('.toast')), await page.textContent('.toast'));
step('push-up: plank', JSON.stringify((await byName('Push-Up')).positions) === '["plank"]');
step('dumbbell shoulder press: standing or seated',
  JSON.stringify((await byName('Dumbbell Shoulder Press')).positions) === '["standing","sitting"]');
step('your own exercise is left alone', !(await byName('My Cable Fly')).positions);
step('an archived exercise stays archived', (await byName('Jump Rope')).archived === true);
step('and nothing was added', (await lib()).length === seed.length);

// ---------- filters ----------
step('option counts guide the choice', (await optionText('position', 'lying')) === 'Lying down (4)', await optionText('position', 'lying'));
await setFilter('muscle', 'chest');
await setFilter('weight', 'dumbbell');
step('chest + dumbbells', (await names()).join() === 'Dumbbell Bench Press', (await names()).join());
step('the summary says how many match', /1 of \d+ exercises/.test(await page.textContent('.filter-summary')));
await clear();

await setFilter('position', 'hanging');
await setFilter('weight', 'bodyweight');
step('hanging + bodyweight', (await names()).sort().join() === 'Front Lever,Hanging Leg Raise,Human Flag,L-Sit,Parallel Bar Dip,Pull-Up,Side Lever',
  (await names()).sort().join());
await clear();

await setFilter('position', 'lying');
step('lying down', (await names()).sort().join() === 'Barbell Bench Press,Clamshell,Dumbbell Bench Press,Single-Leg Glute Bridge',
  (await names()).sort().join());
await clear();

await setFilter('weight', 'machine');
step('machines include your own cable exercise', (await names()).sort().join() === 'Elliptical Trainer,Incline Treadmill Walk,My Cable Fly,Rowing Machine,Stationary Bike',
  (await names()).sort().join());
await clear();

await setFilter('position', '__none');
step('“Not set” finds the gaps to fill in', (await names()).sort().join() === 'Lap Swimming,My Cable Fly', (await names()).sort().join());
await clear();

await setFilter('muscle', 'calves');
const calves = await names();
step('muscle groups come from the free-text targets (gastrocnemius, tibialis…)',
  ['Calf Raise', 'Standing Calf Stretch', 'Standing Tibialis Raises', 'Ankle Circles & Calf Pumps'].every((n) => calves.includes(n))
  && !calves.includes('Squat'), calves.join(', '));
await clear();

// ---------- search ----------
const search = page.locator('input[data-filter="query"]');
await search.click();
await search.pressSequentially('dumbbell row');
step('every search word must match', (await names()).join() === 'Single-Arm Dumbbell Row', (await names()).join());
step('the search box keeps focus while you type',
  await page.evaluate(() => document.activeElement?.dataset?.filter === 'query'));
await search.fill('triceps');
step('search covers muscles too', (await names()).includes('Push-Up') && !(await names()).includes('Squat'));
await search.fill('');
await setFilter('weight', 'bodyweight');
await search.fill('rope');
step('archived matches are listed under Archived',
  /Archived/.test(await page.textContent('#view')) && (await names()).includes('Jump Rope'));
await search.fill('');
await setFilter('weight', '');

// ---------- filters survive opening an exercise ----------
await setFilter('position', 'kneeling');
await page.click('.list-row:has-text("Bird-Dog")');
await page.waitForSelector('button:has-text("‹ Library")');
step('the detail page shows the position', /Position: Kneeling \/ all fours/.test(await page.textContent('#view')));
await page.click('button:has-text("‹ Library")');
step('back in the list, the filter is still on',
  (await page.inputValue('select[data-filter="position"]')) === 'kneeling' && (await names()).includes('Bird-Dog'));
await clear();

// ---------- the editor ----------
await page.click('.list-row:has-text("My Cable Fly")');
await page.click('button:has-text("Edit")');
await page.waitForSelector('.modal-title:has-text("Edit exercise")');
step('the editor shows muscles and what they filter as',
  (await page.inputValue('[data-name="muscles"]')) === 'chest' && /Filters as: Chest/.test(await page.textContent('.modal')));
await page.fill('[data-name="muscles"]', 'chest, front delts');
step('the hint follows as you type', /Filters as: Chest, Shoulders/.test(await page.textContent('.modal')));
await page.check('.modal input[type="checkbox"][value="standing"]');
await page.click('.modal-actions button:has-text("Save")');
const mine = await byName('My Cable Fly');
step('muscles and position are saved',
  JSON.stringify(mine.primaryTargets) === '["chest","front delts"]' && JSON.stringify(mine.positions) === '["standing"]',
  JSON.stringify(mine));

// Equipment items with commas inside must survive an edit that doesn't touch them.
await page.click('button:has-text("‹ Library")');
await page.click('.list-row:has-text("Parallel Bar Dip")');
await page.click('button:has-text("Edit")');
step('equipment is one item per line', (await page.inputValue('[data-name="equipment"]')) === dip.equipment.join('\n'));
await page.check('.modal input[type="checkbox"][value="hanging"]');
await page.click('.modal-actions button:has-text("Save")');
step('untouched equipment keeps its commas', JSON.stringify((await byName('Parallel Bar Dip')).equipment) === JSON.stringify(dip.equipment),
  JSON.stringify((await byName('Parallel Bar Dip')).equipment));

// ---------- export keeps positions ----------
await page.click('button:has-text("‹ Library")');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export")')]);
const exported = JSON.parse(await readFile(await dl.path(), 'utf8'));
step('exported definitions carry positions',
  JSON.stringify(exported.exerciseLibrary.push_up.positions) === '["plank"]'
  && JSON.stringify(exported.exerciseLibrary.my_cable_fly.positions) === '["standing"]');

// ---------- no second fill on the same page load ----------
const before = manifestFetches;
await page.click('.tabbar button[data-tab="logs"]');
await page.click('.tabbar button[data-tab="library"]');
await page.waitForSelector('select[data-filter="muscle"]');
await page.waitForTimeout(300);
step('the fill runs once per page load, not on every visit', before === 1 && manifestFetches === 1, `${before} → ${manifestFetches}`);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
