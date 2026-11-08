// Cardio logging (duration h:mm:ss, distance, avg/max HR, calories,
// elevation, treadmill/outside, gear) and the gear mileage tracker. Runs in
// miles, which is where unit conversion bugs would show.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const TODAY = day(0);
const SHARD = `data/activities/activities-${day(2).slice(0, 7)}.json`;

const get = (c) => page.evaluate((k) => JSON.parse(localStorage.getItem(`ft.data.data/${k}.json`) ?? '[]'), c);
const gearCard = (name) => page.locator(`.gear-card:has-text("${name}")`);
const cardDistance = async (name) => (await gearCard(name).locator('.gear-distance').textContent()).trim();
const openGear = async () => {
  await page.click('.tabbar button[data-tab="library"]');
  await page.click('.segmented button:has-text("Gear")');
};
const pick = async (exercise) => {
  await page.click('.tabbar button[data-tab="logs"]');
  await page.click('.segmented button:has-text("Today")');
  await page.click('button:has-text("Log ad-hoc activity")');
  await page.fill('.modal input[placeholder="Search exercises…"]', exercise);
  await page.click(`.modal .list-row.tappable:has-text("${exercise}")`);
};
const f = (name) => `.modal [data-name="${name}"]`;

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate(([shard, d2, d5]) => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.units', JSON.stringify({ weight: 'lb', distance: 'mi', length: 'in' }));
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([
    { id: 'ex-run', name: 'Easy run', category: 'cardio', modality: 'run', measurementType: 'duration' },
    { id: 'ex-int', name: 'Run/walk intervals', category: 'cardio', modality: 'run', measurementType: 'duration' },
    { id: 'ex-plank', name: 'Plank', category: 'strength', modality: 'bodyweight', measurementType: 'duration' },
  ]));
  // Logged before this feature: a cardio run held minutes only.
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    { id: 'old-int', date: d5, planId: null, plannedExerciseId: null, exerciseId: 'ex-int', actual: { durationSec: 1800 }, notes: '', rpe: null, source: 'manual' },
  ]));
  // A synced Polar run, no gear named: it should count toward the default.
  localStorage.setItem('ft.data.ft.activity.index', JSON.stringify([shard]));
  localStorage.setItem('ft.data.' + shard, JSON.stringify([
    { id: 'polar-9', date: d2, name: 'Morning run', type: 'RUNNING', distanceM: 5000, movingSec: 1800, avgHr: 145, source: 'polar' },
  ]));
}, [SHARD, day(2), day(5)]);
await page.reload();
await page.waitForSelector('.tabbar button');

// ---------- add a pair of shoes ----------
await openGear();
step('Gear starts empty with an explanation', /count toward the default/.test(await page.textContent('.empty-state')));
await page.click('button:has-text("+ Add gear")');
await page.waitForSelector('.modal-title:has-text("Add gear")');
step('new shoes default to running', await page.isChecked('.modal input[type="checkbox"][value="run"]'));
step('and offer a 400 mi replace-at distance', (await page.inputValue(f('alert'))) === '400');
await page.fill(f('name'), 'Pegasus 40');
await page.fill(f('start'), '12');
await page.fill(f('addedOn'), day(30));
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Added Pegasus 40")');
const [peg] = await get('gear');
step('stored in canonical meters', peg.startDistanceM === 19312 && peg.alertDistanceM === 643738,
  `${peg.startDistanceM} / ${peg.alertDistanceM}`);
step('as the running default from 30 days ago', peg.isDefault && peg.sports.join() === 'run' && peg.addedOn === day(30));
step('the synced run counts toward it without being edited',
  (await cardDistance('Pegasus 40')) === '15.11 mi', await cardDistance('Pegasus 40'));
step('so does the old minutes-only run (no distance)', /2 activities/.test(await gearCard('Pegasus 40').textContent()));
step('marked as the current running default', /default · running/.test(await gearCard('Pegasus 40').textContent()));

// ---------- log a treadmill run with every field ----------
await pick('Easy run');
await page.waitForSelector(f('duration'));
const labels = await page.textContent('.modal .cardio-fields');
step('cardio exercises get the full form, in the user’s units',
  ['Duration (h:mm:ss)', 'Distance (mi)', 'Avg HR', 'Max HR', 'Calories', 'Elevation gain (ft)', 'Where', 'Gear'].every((l) => labels.includes(l)));
step('gear defaults to the shoes', (await page.locator(`${f('gearId')} option:checked`).textContent()) === 'Default — Pegasus 40');

await page.fill(f('duration'), '45:30');
await page.fill(f('distance'), '5');
await page.fill(f('avgHr'), '150');
await page.fill(f('maxHr'), '140');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast.error:has-text("Max HR is lower")');
step('max HR below average is refused, form stays open', (await page.locator(f('duration')).count()) === 1);
await page.fill(f('maxHr'), '172');
await page.fill(f('duration'), '45 min');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast.error:has-text("Duration should look like")');
step('a duration that isn’t h:mm:ss is refused', (await page.locator(f('duration')).count()) === 1);
await page.fill(f('duration'), '45:30');
await page.fill(f('calories'), '600');
await page.fill(f('elevation'), '300');
await page.selectOption(f('environment'), 'indoor');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
const run = (await get('logs')).find((l) => l.exerciseId === 'ex-run');
step('every field stored in canonical units', JSON.stringify(run.actual) === JSON.stringify({
  movingSec: 2730, distanceM: 8047, avgHr: 150, maxHr: 172, calories: 600, elevationM: 91.4, environment: 'indoor', gearId: peg.id,
}), JSON.stringify(run.actual));
step('the default is pinned at save time', run.actual.gearId === peg.id);

await page.click('.segmented button:has-text("History")');
const row = await page.locator('.list-row:has-text("Easy run")').first().textContent();
step('History shows distance, time and pace', /5\.00 mi · 45m 30s · 9:06\/mi · 150 bpm/.test(row), row);
step('and the extras line', /Treadmill · ↑ 300 ft · 600 kcal · max 172 bpm · 👟 Pegasus 40/.test(row), row);

await openGear();
step('the run adds to the shoes', (await cardDistance('Pegasus 40')) === '20.11 mi', await cardDistance('Pegasus 40'));

// ---------- typing a duration on a phone's number pad (no colon key) ----------
await pick('Easy run');
await page.waitForSelector(f('duration'));
const dur = page.locator(f('duration'));
step('the duration field asks for the number pad', (await dur.getAttribute('inputmode')) === 'numeric');
const typed = [];
for (const key of '4530') { await dur.press(key); typed.push(await dur.inputValue()); }
step('digits fill in like a timer, colons placed automatically',
  typed.join(' → ') === '0:04 → 0:45 → 4:53 → 45:30', typed.join(' → '));
await dur.press('0');
step('a fifth digit moves into hours', (await dur.inputValue()) === '4:53:00');
await dur.press('Backspace');
step('backspace steps back', (await dur.inputValue()) === '45:30');
for (let i = 0; i < 4; i++) await dur.press('Backspace');
step('and backspacing to the start clears it', (await dur.inputValue()) === '');
await dur.pressSequentially('13000');
step('13000 reads 1:30:00', (await dur.inputValue()) === '1:30:00');
// A hardware keyboard can type colons; then the value means what it says.
await dur.fill('');
await dur.pressSequentially('1:5:30');
step('a typed colon is taken literally', (await dur.inputValue()) === '1:5:30');
await dur.fill('');
await dur.pressSequentially('4530');
await page.fill(f('distance'), '5');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
const timed = (await get('logs')).filter((l) => l.exerciseId === 'ex-run').at(-1);
step('digits-only entry saves the right duration', timed.actual.movingSec === 2730, String(timed.actual.movingSec));
// Keep the gear totals below unchanged by this extra run.
await page.evaluate((id) => {
  const k = 'ft.data.data/logs.json';
  localStorage.setItem(k, JSON.stringify(JSON.parse(localStorage.getItem(k)).filter((l) => l.id !== id)));
}, timed.id);
await page.reload();
await page.waitForSelector('.tabbar button');

// ---------- non-cardio is untouched ----------
await pick('Plank');
await page.waitForSelector('.modal-title:has-text("Plank")');
step('a plank keeps the simple minutes form',
  (await page.locator('.modal label:has-text("Duration (min)")').count()) === 1 && (await page.locator(f('avgHr')).count()) === 0);
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- an old minutes-only run opens in the cardio form ----------
await page.click('.segmented button:has-text("History")');
await page.click('.list-row:has-text("Run/walk intervals") .row-main');
await page.waitForSelector(f('duration'));
step('a minutes-only run shows its time as h:mm:ss', (await page.inputValue(f('duration'))) === '30:00');
await page.fill(f('distance'), '2');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Logged")');
const old = (await get('logs')).find((l) => l.id === 'old-int');
step('re-saving keeps the time and adds the distance',
  old.actual.movingSec === 1800 && old.actual.distanceM === 3219 && !('durationSec' in old.actual), JSON.stringify(old.actual));

// ---------- a synced run can name different gear ----------
await page.click('.list-row:has-text("Morning run") .row-main');
await page.waitForSelector('.modal-title:has-text("Edit activity")');
step('the activity editor has the same cardio fields', (await page.locator(f('maxHr')).count()) === 1);
step('its gear shows the default', (await page.locator(`${f('gearId')} option:checked`).textContent()) === 'Default — Pegasus 40');
await page.selectOption(f('gearId'), 'none');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Activity updated")');
const edit = (await get('activity-edits'))[0];
step('“No gear” is stored as an edit, nothing else changed',
  edit.gearId === 'none' && Object.keys(edit).sort().join() === 'gearId,id,updatedAt', JSON.stringify(edit));
await openGear();
step('and the run leaves the shoes’ total', (await cardDistance('Pegasus 40')) === '19.00 mi', await cardDistance('Pegasus 40'));

// ---------- replace-at warning ----------
await gearCard('Pegasus 40').click();
await page.fill(f('alert'), '20');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Gear updated")');
step('past 90% of the limit says replace soon', /replace soon/.test(await gearCard('Pegasus 40').textContent()));
step('with what’s left', /1\.00 mi left of 20\.00 mi/.test(await gearCard('Pegasus 40').textContent()));

// ---------- new shoes take over; old runs stay ----------
await page.click('button:has-text("+ Add gear")');
await page.fill(f('name'), 'Trail shoes');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.toast:has-text("Added Trail shoes")');
step('the newer default takes over for running', /default · running/.test(await gearCard('Trail shoes').textContent())
  && !/default · running/.test(await gearCard('Pegasus 40').textContent()));
step('runs already logged stay with the old pair', (await cardDistance('Pegasus 40')) === '19.00 mi');
await pick('Easy run');
await page.waitForSelector(f('gearId'));
step('a new run defaults to the new shoes', (await page.locator(`${f('gearId')} option:checked`).textContent()) === 'Default — Trail shoes');
await page.click('.modal-actions button:has-text("Cancel")');

// ---------- retiring ----------
await openGear();
await gearCard('Pegasus 40').click();
await page.click('.modal-actions button:has-text("Retire")');
await page.waitForSelector('.toast:has-text("Pegasus 40 retired")');
step('retired gear moves to its own section', /Retired/.test(await page.textContent('#view'))
  && /retired/.test(await gearCard('Pegasus 40').textContent()));
step('and keeps its mileage', (await cardDistance('Pegasus 40')) === '19.00 mi');
step('without a replace warning', !/replace soon/.test(await gearCard('Pegasus 40').textContent()));
await pick('Easy run');
await page.waitForSelector(f('gearId'));
const options = await page.locator(`${f('gearId')} option`).allTextContents();
step('retired gear isn’t offered for new runs', !options.some((o) => o.includes('Pegasus')), options.join(' | '));
await page.click('.modal-actions button:has-text("Cancel")');
await page.click('.segmented button:has-text("History")');
step('but old runs still show it', /👟 Pegasus 40/.test(await page.locator('.list-row:has-text("Easy run")').first().textContent()));

// ---------- imports fill the new fields ----------
const parsed = await page.evaluate(async () => {
  const { parseActivityFile } = await import('/js/gps.js');
  const tcx = `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
    <Activities><Activity Sport="Running"><Lap><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters>
    <Calories>140</Calories><MaximumHeartRateBpm><Value>171</Value></MaximumHeartRateBpm><Track>
    <Trackpoint><Time>2026-10-01T07:00:00Z</Time><Position><LatitudeDegrees>60.1</LatitudeDegrees><LongitudeDegrees>24.9</LongitudeDegrees></Position><AltitudeMeters>10</AltitudeMeters><HeartRateBpm><Value>150</Value></HeartRateBpm></Trackpoint>
    <Trackpoint><Time>2026-10-01T07:05:00Z</Time><Position><LatitudeDegrees>60.11</LatitudeDegrees><LongitudeDegrees>24.91</LongitudeDegrees></Position><AltitudeMeters>30</AltitudeMeters><HeartRateBpm><Value>165</Value></HeartRateBpm></Trackpoint>
    <Trackpoint><Time>2026-10-01T07:10:00Z</Time><Position><LatitudeDegrees>60.12</LatitudeDegrees><LongitudeDegrees>24.92</LongitudeDegrees></Position><AltitudeMeters>12</AltitudeMeters><HeartRateBpm><Value>160</Value></HeartRateBpm></Trackpoint>
    </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  // GPS altitude jitter of ±1-2 m on a flat loop, then one real 10 m climb.
  const eles = [50, 51, 49, 51.5, 50, 49.5, 51, 50, 60, 60.5];
  const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><type>treadmill</type><trkseg>${
    eles.map((e, i) => `<trkpt lat="60.${10 + i}" lon="24.9"><ele>${e}</ele><time>2026-10-02T07:${String(i).padStart(2, '0')}:00Z</time></trkpt>`).join('')
  }</trkseg></trk></gpx>`;
  return { tcx: await parseActivityFile('a.tcx', tcx), gpx: await parseActivityFile('b.gpx', gpx) };
});
step('TCX: calories and lap max HR come through', parsed.tcx.calories === 140 && parsed.tcx.maxHr === 171,
  `${parsed.tcx.calories} / ${parsed.tcx.maxHr}`);
step('TCX: elevation gain from altitude', parsed.tcx.elevationM === 20, String(parsed.tcx.elevationM));
step('TCX: a GPS track means outside', parsed.tcx.environment === 'outdoor');
step('GPX: altitude jitter isn’t counted as climbing', parsed.gpx.elevationM === 10, String(parsed.gpx.elevationM));
step('GPX: a treadmill sport means indoor', parsed.gpx.environment === 'indoor');

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
