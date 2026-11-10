// Bulk exercise editing (export → edit → import updates in place, adds the
// rest, skips repeats and bad entries; a template to start from) and
// exercise GIFs (a link or an upload; card, variant thumbs, lightbox).
import { BASE, chromium, reporter } from './lib.mjs';
import { readFile } from 'node:fs/promises';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
// A GIF "on the web" for link tests.
await page.route('https://gifs.example/**', (route) => route.fulfill({ status: 200, contentType: 'image/gif', body: GIF }));

await page.goto(BASE);
await page.waitForSelector('.tabbar button');

// ---------- pure: the import plan ----------
const P = await page.evaluate(async () => {
  const io = await import('/js/exercise-io.js');
  const lib = [
    { id: 'a', name: 'Push-Up', category: 'strength', modality: 'bodyweight', description: 'old', cues: ['x'] },
    { id: 'b', name: 'Goblet Squat', category: 'strength', modality: 'dumbbell' },
    { id: 'c', name: 'Plank', category: 'strength', modality: 'other' },
  ];
  const before = JSON.stringify(lib);
  let n = 0;
  const plan = io.planExerciseImport([
    { name: 'push up', description: 'new text' }, // name match, ignoring case/punctuation
    { id: 'b', name: 'Goblet Squat (heels raised)' }, // id match, renamed
    { name: 'Plank' }, // nothing to change
    { name: 'Dead Bug', category: 'strength', modality: 'bodyweight', primaryTargets: ['core'] }, // new
    { name: 'dead-bug' }, // twice in the file
    { name: 'Bad One', category: 'yoga' }, // invalid value
    { description: 'no name' },
    { name: 'Goblet Squat (example)' }, // template example
  ], lib, { newId: () => `new${++n}` });
  const applied = io.applyExerciseImport(lib, plan);
  const tpl = io.exerciseTemplate();
  const tplPlan = io.planExerciseImport(io.extractExerciseDefs(JSON.parse(JSON.stringify(tpl))), lib);
  return {
    creates: plan.creates.map((c) => `${c.id}:${c.name}`),
    updates: plan.updates.map((u) => `${u.after.id}:${u.fields.join('+')}`),
    unchanged: plan.unchanged.map((x) => x.id),
    skipped: plan.skipped.map((x) => `${x.name} — ${x.reason}`),
    pushAfter: applied.find((x) => x.id === 'a'),
    squatAfter: applied.find((x) => x.id === 'b').name,
    count: applied.length,
    untouched: JSON.stringify(lib) === before,
    tplNothing: tplPlan.creates.length === 0 && tplPlan.updates.length === 0 && tplPlan.skipped.length === 2,
    tplReadme: tpl._readme.some((l) => /category: cardio \| strength/.test(l)) && tpl._readme.some((l) => /gif/.test(l)),
  };
});
step('import: a name match ignores case and punctuation, and updates', P.updates.includes('a:description'), P.updates.join());
step('import: an id match updates even after a rename', P.updates.includes('b:name') && P.squatAfter === 'Goblet Squat (heels raised)');
step('import: fields the file leaves out are kept', P.pushAfter.cues[0] === 'x' && P.pushAfter.name === 'Push-Up' && P.pushAfter.description === 'new text');
step('import: nothing to change is reported as unchanged', P.unchanged.join() === 'c');
step('import: new exercises are added', P.creates.join() === 'new1:Dead Bug' && P.count === 4);
step('import: a repeat within the file is skipped, not doubled', P.skipped.some((s) => /dead-bug — appears twice/.test(s)));
step('import: invalid values and missing names are skipped, with the reason',
  P.skipped.some((s) => /Bad One — invalid category/.test(s)) && P.skipped.some((s) => /no name/.test(s)));
step('import: template examples are skipped', P.skipped.some((s) => /\(example\) — template example/.test(s)));
step('import: planning never changes the library', P.untouched);
step('template: imported as-is it changes nothing', P.tplNothing);
step('template: explains the allowed values and gifs', P.tplReadme);

// ---------- the UI round trip ----------
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const lib = [
    { ...m.makeExercise({ name: 'Push-Up', modality: 'bodyweight' }), id: 'ex-push', description: 'Hands under shoulders.',
      variants: [{ level: 1, name: 'Wall Push-Up' }, { level: 2, name: 'Knee Push-Up' }] },
    { ...m.makeExercise({ name: 'Goblet Squat', modality: 'dumbbell' }), id: 'ex-squat' },
  ];
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify(lib));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([m.makeLogEntry({ date: '2026-11-01', exerciseId: 'ex-squat', actual: { sets: 3, reps: 8, weight: 16 } })]));
});
await page.goto(`${BASE}#/library`);
await page.reload();
await page.waitForSelector('button:has-text("Export")');
const [exp] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export")')]);
const exported = JSON.parse(await readFile(await exp.path(), 'utf8'));
const defs = Object.values(exported.exerciseLibrary);
step('export: every exercise carries its id', defs.length >= 2 && defs.every((d) => typeof d.id === 'string'));

// Edit in bulk: change one, rename the other, add one, with a GIF link.
const squat = defs.find((d) => d.id === 'ex-squat');
squat.name = 'Heels-Raised Goblet Squat';
squat.cues = ['Heels on a plate'];
const push = defs.find((d) => d.id === 'ex-push');
push.gif = 'https://gifs.example/push-up.gif';
push.variants[1].gif = 'https://gifs.example/knee.gif';
exported.exerciseLibrary.dead_bug = { name: 'Dead Bug', category: 'strength', modality: 'bodyweight', primaryTargets: ['core'] };

await page.click('button:has-text("Import")');
await page.waitForSelector('.modal-title:has-text("Import exercises")');
const [tpl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="template"]')]);
step('Download template gives a template file', tpl.suggestedFilename() === 'exercise-template.json'
  && JSON.parse(await readFile(await tpl.path(), 'utf8')).format === 'fitness-tracker-exercise-library');
await page.fill('[data-name="import-json"]', '{ not json');
await page.waitForSelector('.import-preview .import-error');
step('a broken file says so', /isn’t valid JSON/.test(await page.textContent('.import-preview')));
await page.fill('[data-name="import-json"]', JSON.stringify(exported));
await page.waitForSelector('.import-counts');
step('preview before importing: 1 new · 2 updated', /^1 new · 2 updated/.test(await page.textContent('.import-counts')), await page.textContent('.import-counts'));
step('…naming what changes', /Heels-Raised Goblet Squat \(name, cues\)/.test(await page.textContent('.import-preview')));
const libBefore = await page.evaluate(() => localStorage.getItem('ft.data.data/exercises.json'));
step('nothing is saved until Import', libBefore === (await page.evaluate(() => localStorage.getItem('ft.data.data/exercises.json'))));
await page.click('.modal-actions button:has-text("Import")');
await page.waitForSelector('.toast:has-text("1 new, 2 updated")');
const lib = await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/exercises.json')));
step('updates apply in place, ids kept', lib.find((e) => e.id === 'ex-squat').name === 'Heels-Raised Goblet Squat'
  && lib.find((e) => e.id === 'ex-squat').cues[0] === 'Heels on a plate' && lib.length === 3);
step('…so logs still point at the renamed exercise', await page.evaluate(() => {
  const l = JSON.parse(localStorage.getItem('ft.data.data/logs.json'))[0];
  return JSON.parse(localStorage.getItem('ft.data.data/exercises.json')).some((e) => e.id === l.exerciseId && /Heels-Raised/.test(e.name));
}));
step('the new exercise is added once', lib.filter((e) => e.name === 'Dead Bug').length === 1);

// Starter packs still never overwrite your edits.
await page.evaluate(() => {
  const k = 'ft.data.data/exercises.json';
  const l = JSON.parse(localStorage.getItem(k));
  l.find((e) => e.id === 'ex-push').description = 'My own words.';
  localStorage.setItem(k, JSON.stringify(l));
});
await page.reload();
await page.click('button:has-text("Import")');
await page.click('.modal .list-row:has-text("Running & Calisthenics")');
await page.waitForSelector('.toast:has-text("Imported")');
step('a starter pack only fills blanks', (await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/exercises.json'))
  .find((e) => e.id === 'ex-push').description)) === 'My own words.');

// ---------- GIFs: links ----------
await page.goto(`${BASE}#/library/exercise/ex-push`);
await page.reload();
await page.waitForSelector('.gif-figure img[src]');
step('exercise page: the GIF beside the description', (await page.getAttribute('.gif-figure img', 'src')) === 'https://gifs.example/push-up.gif');
step('variant rows: a smaller GIF', (await page.locator('.variant-row .gif-thumb').count()) === 1
  && (await page.locator('.variant-row .gif-thumb').evaluate((n) => n.getBoundingClientRect().width)) <= 56);
await page.click('.gif-figure .gif-wrap');
await page.waitForSelector('.lightbox img[src]');
const lb = await page.evaluate(() => {
  const r = document.querySelector('.lightbox-img').getBoundingClientRect();
  return { w: r.width, max: innerWidth };
});
step('tap: a full-size pop-up, never wider than the screen', lb.w <= lb.max);
await page.keyboard.press('Escape');
step('…closed with Escape (or a tap)', !(await page.isVisible('.lightbox')));
await page.click('.variant-row .gif-wrap');
step('variant GIFs open the pop-up too', /Knee Push-Up/.test(await page.textContent('.lightbox')));
await page.click('.lightbox');

// ---------- GIFs: upload ----------
await page.goto(`${BASE}#/library/exercise/ex-squat`);
await page.reload();
await page.click('button:has-text("Edit")');
await page.waitForSelector('.gif-editor');
await page.setInputFiles('[data-gif-file="exercise"]', { name: 'squat.gif', mimeType: 'image/gif', buffer: GIF });
await page.waitForSelector('.gif-editor .row-sub:has-text("Uploaded GIF")');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.gif-figure img[src^="data:image/gif"]');
const sq = await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/exercises.json')).find((e) => e.id === 'ex-squat'));
step('upload: stored as media:<id> and shown from this device', /^media:[0-9a-f-]{36}$/.test(sq.gif), sq.gif);
const idb = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('ft.media', 1);
  r.onsuccess = () => {
    const q = r.result.transaction('blobs').objectStore('blobs').getAll();
    q.onsuccess = () => res(q.result.map((x) => ({ id: x.id, state: x.state, mime: x.mime })));
  };
}));
step('…kept offline (IndexedDB), as a GIF, queued for the data repo', (await idb()).some((x) => `media:${x.id}` === sq.gif && x.mime === 'image/gif'));

// An upload in an editor that's then cancelled leaves nothing behind.
await page.click('button:has-text("Edit")');
await page.waitForSelector('.gif-editor');
const beforeCancel = (await idb()).length;
await page.setInputFiles('[data-gif-file="exercise"]', { name: 'other.gif', mimeType: 'image/gif', buffer: GIF });
await page.waitForFunction(async (n) => (await new Promise((res) => {
  const r = indexedDB.open('ft.media', 1);
  r.onsuccess = () => { const q = r.result.transaction('blobs').objectStore('blobs').count(); q.onsuccess = () => res(q.result); };
})) > n, beforeCancel);
await page.click('.modal-actions button:has-text("Cancel")');
let dropped = false;
for (let i = 0; i < 20 && !dropped; i++) {
  dropped = (await idb()).length === beforeCancel;
  if (!dropped) await page.waitForTimeout(100);
}
step('cancelling the editor drops an unsaved upload', dropped);

// Remove.
await page.click('button:has-text("Edit")');
await page.click('.gif-row:has-text("Exercise") button:has-text("Remove")');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.modal', { state: 'detached' });
step('Remove clears the GIF', !(await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/exercises.json')).find((e) => e.id === 'ex-squat').gif))
  && !(await page.isVisible('.gif-figure')));
// The blob removal is asynchronous (IndexedDB): poll briefly.
let gone = false;
for (let i = 0; i < 20 && !gone; i++) {
  gone = !(await idb()).some((x) => `media:${x.id}` === sq.gif);
  if (!gone) await page.waitForTimeout(100);
}
step('…and the uploaded file is removed too', gone);

// A non-image is refused.
await page.click('button:has-text("Edit")');
await page.setInputFiles('[data-gif-file="exercise"]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
await page.waitForSelector('.toast.error:has-text("isn’t an image")');
step('a non-image upload is refused', true);
await page.click('.modal-actions button:has-text("Cancel")');

const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('390px: no horizontal overflow', ov <= 0);
step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
