// Today: each planned session is a button that opens to the full session
// (Full / Minimum, its exercises, its own "+ Log ad-hoc activity", Finish)
// and closes again; a second "+ Log ad-hoc activity" sits outside them.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

await page.evaluate(async () => {
  const store = await import('/js/storage/store.js');
  const { todayStr } = await import('/js/dates.js');
  localStorage.setItem('ft.welcomed', '1');
  await store.save('exercises', [
    { id: 'squat', name: 'Squat', category: 'strength', modality: 'barbell', measurementType: 'reps' },
    { id: 'plank', name: 'Plank', category: 'strength', modality: 'bodyweight', measurementType: 'duration' },
  ]);
  await store.save('plans', [{
    id: 'p1', name: 'Strength Base', status: 'active', startDate: todayStr(), weeks: [{ index: 1, sessions: [{
      id: 's1', label: 'Lower body', dayOffset: 0, blocks: [{ type: 'main', items: [
        { id: 'i1', exerciseId: 'squat', target: { kind: 'reps', sets: 3, reps: 5 } },
        { id: 'i2', exerciseId: 'plank', target: { kind: 'duration', sets: 2, durationSec: 30 } },
      ] }],
    }] }],
  }]);
  location.hash = '#/logs';
});
await page.reload();
await page.waitForSelector('.session-toggle');

const toggle = page.locator('.session-toggle');
step('a session today shows as one button', (await toggle.count()) === 1);
step('naming the session, its plan and progress',
  /Lower body/.test(await toggle.textContent()) && /Strength Base/.test(await toggle.textContent()) && /0 of 2 done/.test(await toggle.textContent()),
  await toggle.textContent());
step('closed at first: no exercises, no mode toggle, no Finish',
  (await page.locator('.session-mode').count()) === 0 && (await page.locator('[data-action="finish"]').count()) === 0
  && (await toggle.getAttribute('aria-expanded')) === 'false');
step('the stand-alone “+ Log ad-hoc activity” is there', await page.locator('.today-adhoc').isVisible());
const box = await toggle.boundingBox();
step('the button is a comfortable tap target at phone width', box.height >= 44 && box.width > 300, JSON.stringify(box));

await toggle.click();
await page.waitForSelector('.session-mode');
step('tapped, it opens: Full / Minimum toggle', await page.locator('.session-mode button:has-text("Full session")').isVisible()
  && await page.locator('.session-mode button:has-text("Minimum")').isVisible());
step('…its exercises', /Squat/.test(await page.textContent('.session-body')) && /Plank/.test(await page.textContent('.session-body')));
step('…its own “+ Log ad-hoc activity”', await page.locator('.session-body .session-adhoc').isVisible());
step('…and Finish', await page.locator('[data-action="finish"]').isVisible());
step('while it is open, the stand-alone ad-hoc button is hidden (the session has its own)',
  (await page.locator('button:has-text("Log ad-hoc activity")').count()) === 1 && (await page.locator('.today-adhoc').count()) === 0);

await page.click('.session-mode button:has-text("Minimum")');
await page.waitForSelector('.min-note');
step('the Minimum toggle still works inside', /won’t trigger/.test(await page.textContent('.min-note')));
await page.reload();
await page.waitForSelector('.session-toggle');
step('open stays open across a reload', (await page.locator('.session-toggle').getAttribute('aria-expanded')) === 'true'
  && await page.locator('.session-mode').isVisible());

await page.click('.session-toggle');
await page.waitForFunction(() => document.querySelector('.session-toggle')?.getAttribute('aria-expanded') === 'false');
step('tapped again, it closes', (await page.locator('.session-mode').count()) === 0 && (await page.locator('[data-action="finish"]').count()) === 0);
step('and the stand-alone ad-hoc button is back', await page.locator('.today-adhoc').isVisible());

// Outside the session: a run on its own, not tagged with the plan.
const logAdhoc = async (button) => {
  await page.click(button);
  await page.fill('.modal input[placeholder^="Search"]', 'Plank');
  await page.click('.modal .list-row:has-text("Plank")');
  await page.waitForSelector('.modal-actions button:has-text("Save")');
  await page.click('.modal-actions button:has-text("Save")');
  await page.waitForSelector('.toast:has-text("Logged")');
};
await logAdhoc('.today-adhoc');
let logs = await page.evaluate(async () => (await import('/js/storage/store.js')).get('logs'));
step('the outside button logs an activity on its own', logs.length === 1 && logs[0].planId == null && logs[0].plannedExerciseId == null, JSON.stringify(logs));
step('…which does not count toward the session', /0 of 2 done/.test(await page.textContent('.session-toggle')));

await page.click('.session-toggle');
await page.waitForSelector('.session-adhoc');
await logAdhoc('.session-adhoc');
logs = await page.evaluate(async () => (await import('/js/storage/store.js')).get('logs'));
const inSession = logs.find((l) => l.planId);
step('the in-session button tags the log with the session’s plan', !!inSession && inSession.planId === 'p1' && inSession.plannedExerciseId == null, JSON.stringify(logs));

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
