// Exercise names on the Logs page link to the exercise's page in the
// Fitness Library, and Back returns to where you were.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const hash = () => page.evaluate(() => location.hash);
const activeTab = () => page.textContent('.tabbar button.active');
const detailTitle = () => page.locator('#view h2').first().textContent();

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
// A plan with today's session (a run and a plank), one past log of each, and
// a log whose exercise has since been deleted.
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const today = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => {
    const x = new Date(today);
    x.setDate(x.getDate() - back);
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };
  const run = { ...m.makeExercise({ name: 'Easy Run', category: 'cardio', modality: 'run', measurementType: 'duration' }), id: 'ex/run 1' };
  const plank = { ...m.makeExercise({ name: 'Front Plank', category: 'strength', modality: 'bodyweight', measurementType: 'duration' }), id: 'ex-plank', description: 'Hold a straight line from head to heels.' };
  const plan = m.makePlan({ name: 'Base Building', startDate: d(0) });
  const week = m.makeWeek(1);
  const session = m.makeSession({ label: 'Run + core', dayOffset: 0 });
  const block = m.makeBlock({ type: 'main' });
  block.items.push(m.makeBlockItem({ exerciseId: run.id, target: { kind: 'duration', durationSec: 1800 } }));
  block.items.push(m.makeBlockItem({ exerciseId: plank.id, target: { kind: 'duration', durationSec: 60 } }));
  session.blocks.push(block);
  week.sessions.push(session);
  plan.weeks.push(week);
  const logs = [
    { ...m.makeLogEntry({ date: d(2), exerciseId: plank.id, actual: { durationSec: 60 } }), id: 'log-plank' },
    { ...m.makeLogEntry({ date: d(3), exerciseId: 'gone', actual: { sets: 3, reps: 10 } }), id: 'log-gone' },
  ];
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([run, plank]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify(logs));
});
await page.reload();
await page.waitForSelector('.list-row:has-text("Front Plank")');

// ---------- Today: planned exercise names are links ----------
const plankLink = page.locator('.card .row-title a.ex-link:has-text("Front Plank")');
step('a planned exercise name is a link', (await plankLink.count()) === 1);
step('to its library page', (await plankLink.getAttribute('href')) === '#/library/exercise/ex-plank');
step('ids are encoded in the link', (await page.getAttribute('a.ex-link:has-text("Easy Run")', 'href')) === '#/library/exercise/ex%2Frun%201');

await plankLink.click();
await page.waitForSelector('button:has-text("‹ Back")');
step('it opens the exercise in the Fitness Library',
  (await activeTab()) === 'Fitness Library' && (await detailTitle()) === 'Front Plank', `${await activeTab()} / ${await detailTitle()}`);
step('with its description', /Hold a straight line from head to heels/.test(await page.textContent('#view')));
step('the address names the exercise', (await hash()) === '#/library/exercise/ex-plank');
await page.click('button:has-text("‹ Back")');
await page.waitForSelector('.list-row:has-text("Front Plank")');
// The page was opened with no hash, which is the Logs tab.
step('‹ Back returns to the Logs page', (await activeTab()) === 'Logs' && ['', '#/logs'].includes(await hash()), `${await activeTab()} ${await hash()}`);

// The browser's own back works the same way.
await page.click('a.ex-link:has-text("Easy Run")');
await page.waitForSelector('button:has-text("‹ Back")');
step('an id with odd characters opens the right exercise',
  (await detailTitle()) === 'Easy Run' && (await hash()) === '#/library/exercise/ex%2Frun%201');
await page.goBack();
await page.waitForSelector('.list-row:has-text("Front Plank")');
step('the browser back button returns too', (await activeTab()) === 'Logs');

// ---------- History: the name is a link; the rest of the row still edits ----------
await page.click('.segmented button:has-text("History")');
await page.waitForSelector('.list-row:has-text("Front Plank")');
await page.click('.list-row .row-title a.ex-link:has-text("Front Plank")');
await page.waitForSelector('button:has-text("‹ Back")');
step('tapping the name in History opens the exercise, not the log',
  (await page.locator('.modal').count()) === 0 && (await detailTitle()) === 'Front Plank');
await page.click('button:has-text("‹ Back")');
await page.waitForSelector('.segmented button.active:has-text("History")');
step('and Back lands on History, where you were', true);
await page.click('.list-row:has-text("Front Plank") .row-sub >> nth=0');
await page.waitForSelector('.modal');
step('tapping elsewhere on the row still opens the log', (await page.locator('.modal-title:has-text("Front Plank")').count()) === 1);
await page.click('.modal-actions button:has-text("Cancel")');
step('a deleted exercise is plain text, not a dead link',
  (await page.locator('.list-row:has-text("Activity") a').count()) === 0 && (await page.locator('.list-row .row-title:text-is("Activity")').count()) === 1);

// ---------- arriving at the address directly ----------
// A different page first: a goto that only changes the hash is an in-page
// navigation, not a fresh load.
await page.goto('about:blank');
await page.goto(`${BASE}/#/library/exercise/ex-plank`);
await page.waitForSelector('button:has-text("‹ Library")');
step('opening the address directly shows the exercise', (await detailTitle()) === 'Front Plank');
step('with ‹ Library, since there’s nothing in the app to go back to', (await page.locator('button:has-text("‹ Back")').count()) === 0);
await page.click('button:has-text("‹ Library")');
await page.waitForSelector('select[data-filter="muscle"]');
step('which goes to the list and tidies the address', (await hash()) === '#/library');

// In-library navigation keeps the address in step, so a reload stays put.
await page.click('.list-row:has-text("Easy Run")');
step('opening from the list updates the address', (await hash()) === '#/library/exercise/ex%2Frun%201');
await page.reload();
await page.waitForSelector('button:has-text("‹ Library")');
step('a reload stays on that exercise', (await detailTitle()) === 'Easy Run');
await page.click('.segmented button:has-text("Goals")');
step('switching to Goals drops the exercise from the address', (await hash()) === '#/library');
await page.goto(`${BASE}/#/library/exercise/no-such-id`);
await page.waitForSelector('select[data-filter="muscle"]');
step('an unknown exercise falls back to the list', (await hash()) === '#/library');

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
