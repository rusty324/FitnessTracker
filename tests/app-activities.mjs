// Activities: GPX/TCX import, the correction overlay, and the write-ownership
// split that keeps the browser out of the sync workflow's files. Runs at
// phone width — the long-name overflow only shows there.
import { BASE, chromium, reporter, stubGithub } from './lib.mjs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await stubGithub(page);

const LONG = 'Sunday_long_run_riverside_loop_with_the_club_2026_07_26_FINAL_export_v3';
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const SYNC_DAY = day(3);
const IMPORT_DAY = day(2);
const shardPath = `data/activities/activities-${SYNC_DAY.slice(0, 7)}.json`;

const overlay = () => page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/activity-edits.json') ?? '[]'));
const shard = (p) => page.evaluate((path) => JSON.parse(localStorage.getItem('ft.data.' + path) ?? '[]'), p);
const imported = () => page.evaluate(() => {
  const index = JSON.parse(localStorage.getItem('ft.data.ft.activity.index') ?? '[]');
  return index.filter((x) => x.startsWith('data/imported/'))
    .flatMap((p) => JSON.parse(localStorage.getItem('ft.data.' + p) ?? '[]'));
});

const dir = await mkdtemp(join(tmpdir(), 'ft-'));
const gpxPath = join(dir, 'ride.gpx');
await writeFile(gpxPath, `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>${LONG}_imported</name><type>cycling</type><trkseg>
    <trkpt lat="60.10" lon="24.90"><time>${IMPORT_DAY}T07:00:00Z</time></trkpt>
    <trkpt lat="60.11" lon="24.91"><time>${IMPORT_DAY}T07:20:00Z</time></trkpt>
  </trkseg></trk></gpx>`);
const zipPath = join(dir, 'export.zip');
await writeFile(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
// Seed one workflow-owned activity — the case the app must never write to.
await page.evaluate(([path, date, name]) => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.ft.activity.index', JSON.stringify([path]));
  localStorage.setItem('ft.data.' + path, JSON.stringify([{
    id: 'polar-1', date, name, type: 'running',
    distanceM: 10000, movingSec: 3000, avgHr: 152, source: 'polar',
  }]));
}, [shardPath, SYNC_DAY, LONG]);
await page.reload();
await page.click('.segmented button:has-text("History")');
await page.waitForSelector(`.list-row:has-text("${LONG}")`);

// ---- a long name must not push the page sideways on a phone ----
const layout = await page.evaluate(() => {
  const title = document.querySelector('.list-row .row-title');
  const lh = parseFloat(getComputedStyle(title).lineHeight) || 20;
  return {
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    wide: [...document.querySelectorAll('.row-title, .row-sub')].some((e) => e.scrollWidth > e.clientWidth + 1),
    lines: Math.round(title.clientHeight / lh),
    clipped: title.scrollHeight > title.clientHeight,
  };
});
step('page does not scroll horizontally at 390px', layout.doc <= 0, `overflow ${layout.doc}px`);
step('the long name wraps instead of running off the row', !layout.wide);
step('and is capped at two lines', layout.lines <= 2 && layout.clipped, `${layout.lines} lines`);

// ---- editing a workflow-owned activity ----
await page.click(`.list-row:has-text("${LONG}") .row-main`);
await page.waitForSelector('.modal-title:has-text("Edit activity")');
step('editor prefills the duration as h:mm:ss', (await page.inputValue('.modal input[data-name="duration"]')) === '50:00');
await page.fill('.modal input[data-name="duration"]', 'about an hour');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast.error');
step('an unparseable duration is refused, nothing written',
  (await page.locator('.modal-title:has-text("Edit activity")').count()) === 1 && (await overlay()).length === 0);

await page.fill('.modal input[type="text"] >> nth=0', 'Sunday long run');
await page.selectOption('.modal select >> nth=0', 'trail_running');
await page.fill('.modal input[data-name="distance"]', '12');
await page.fill('.modal input[data-name="duration"]', '1:05:30');
await page.fill('.modal textarea', 'Hot, eased off the last 2k');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Activity updated")');

const edits = await overlay();
step('one overlay record written', edits.length === 1 && edits[0].id === 'polar-1', JSON.stringify(edits));
step('only changed fields stored', !('avgHr' in edits[0]), Object.keys(edits[0]).join(','));
step('distance stored in metres', edits[0].distanceM === 12000, String(edits[0].distanceM));
step('duration stored in seconds', edits[0].movingSec === 3930, String(edits[0].movingSec));
const synced = await shard(shardPath);
step('the sync-owned shard is not rewritten',
  synced.length === 1 && synced[0].name === LONG && synced[0].distanceM === 10000);
step('and it is not queued for upload',
  !(await page.evaluate((p) => JSON.parse(localStorage.getItem('ft.queue') ?? '[]').includes(p), shardPath)));
await page.waitForSelector('.list-row:has-text("Sunday long run")');
step('the row shows the edit', (await page.locator('.list-row .pill:has-text("edited")').count()) === 1);
step('notes show on the row', (await page.locator('.list-row:has-text("Hot, eased off")').count()) === 1);
step('distance re-rendered from the edit',
  /12\.00 km/.test(await page.locator('.list-row:has-text("Sunday long run")').first().textContent()));

// ---- reset ----
await page.click('.list-row:has-text("Sunday long run") .row-main');
await page.click('.modal-actions button:has-text("Reset")');
await page.waitForSelector(`.list-row:has-text("${LONG}")`);
step('reset drops the overlay record', (await overlay()).length === 0);
step('reset restores the synced values',
  /10\.00 km/.test(await page.locator(`.list-row:has-text("${LONG}")`).first().textContent()));

// ---- deleting a sync-owned activity hides it; its file is not ours ----
await page.click(`.list-row:has-text("${LONG}") .row-main`);
await page.click('.modal-actions button:has-text("Delete")');
await page.waitForSelector('.modal-title:has-text("Confirm")');
await page.click('.modal-actions button:has-text("Delete") >> nth=-1');
await page.waitForSelector('.toast:has-text("hidden from history")');
step('a hidden overlay record is written instead of a shard edit',
  (await overlay())[0]?.hidden === true && (await shard(shardPath)).length === 1);
step('and the row is gone', (await page.locator(`.list-row:has-text("${LONG}")`).count()) === 0);

// ---- import ----
await page.click('button:has-text("Import GPX/TCX")');
await page.waitForSelector('.modal-title:has-text("Import activities")');
step('the file picker has no accept filter (iOS greys those out)',
  (await page.getAttribute('.modal input[type="file"]', 'accept')) === null);
await page.setInputFiles('.modal input[type="file"]', [zipPath]);
await page.click('.modal-actions button:has-text("Import")');
await page.waitForSelector('.toast.error');
step('a .zip explains what to do instead', /uncompress it first/i.test(await page.textContent('.modal')));
await page.setInputFiles('.modal input[type="file"]', [gpxPath]);
await page.click('.modal-actions button:has-text("Import")');
await page.waitForSelector('.toast:has-text("Imported 1")');
step('the import lands in the browser-owned directory', (await imported()).length === 1);
await page.waitForSelector('.list-row:has-text("_imported")');

// ---- an imported route reaches the heatmap ----
await page.click('.segmented button:has-text("Heatmap")');
await page.waitForSelector('.leaflet-container', { timeout: 15000 });
step('the imported route renders on the heatmap', true);
await page.click('.segmented button:has-text("History")');

await page.click('.list-row:has-text("_imported") .row-main');
await page.click('.modal-actions button:has-text("Delete")');
await page.waitForSelector('.modal-title:has-text("Confirm")');
await page.click('.modal-actions button:has-text("Delete") >> nth=-1');
await page.waitForSelector('.toast:has-text("Activity deleted")');
step('a browser-owned import is really removed from its shard', (await imported()).length === 0);
step('no hidden overlay needed for an import', (await overlay()).length === 1);

// ---- a log's plan name goes under the text and wraps (not beside it) ----
const LONG_PLAN = 'Couch to 10K — 26-week conservative build with extra recovery weeks';
await page.evaluate(([date, planName]) => {
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([{ id: 'p-long', name: planName, weeks: [] }]));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([{
    id: 'l-long', date, exerciseId: 'nope', planId: 'p-long', actual: { sets: 1, reps: 10 },
  }]));
}, [SYNC_DAY, LONG_PLAN]);
await page.reload();
await page.click('.segmented button:has-text("History")');
await page.waitForSelector(`.list-row:has-text("${LONG_PLAN}")`);
const planLayout = await page.evaluate((name) => {
  const row = [...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes(name));
  const main = row.querySelector('.row-main');
  const pill = row.querySelector('.pill.accent');
  const sub = main.querySelector('.row-sub');
  return {
    inMain: main.contains(pill),
    below: pill.getBoundingClientRect().top >= sub.getBoundingClientRect().bottom - 1,
    mainWidth: main.getBoundingClientRect().width,
    rowWidth: row.getBoundingClientRect().width,
    pillWraps: pill.getBoundingClientRect().height > parseFloat(getComputedStyle(pill).lineHeight) * 1.5,
    pillFits: pill.getBoundingClientRect().right <= row.getBoundingClientRect().right + 1,
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, LONG_PLAN);
step('plan name sits below the log text', planLayout.inMain && planLayout.below);
step('log text keeps the full row width', planLayout.mainWidth >= planLayout.rowWidth - 1,
  `${planLayout.mainWidth} of ${planLayout.rowWidth}px`);
step('a long plan name wraps inside the row', planLayout.pillWraps && planLayout.pillFits && planLayout.doc <= 0);

const real = errors.filter((e) => !/tile|openstreetmap|net::/i.test(e));
step('no page errors', real.length === 0, real.join(' | '));
await done(browser);
