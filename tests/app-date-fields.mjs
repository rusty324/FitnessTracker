// Date fields stay inside the screen on a phone. The bug itself is iOS
// Safari's: its native date control has an intrinsic minimum width and
// ignores width:100%. Chromium can't reproduce that, so this checks the
// two things that prevent it on every date field the app shows — no native
// appearance, no minimum width — and that none overflows at 390px.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// Every visible date input: does it overflow its parent or the screen, and
// does it still carry the native sizing that iOS stretches?
const audit = () => page.evaluate(() => [...document.querySelectorAll('input[type="date"]')]
  .filter((i) => i.offsetParent)
  .map((i) => {
    const r = i.getBoundingClientRect();
    const p = i.parentElement.getBoundingClientRect();
    const cs = getComputedStyle(i);
    return {
      overflow: Math.max(0, r.right - Math.min(p.right, document.documentElement.clientWidth)),
      appearance: cs.appearance || cs.webkitAppearance,
      minWidth: cs.minWidth,
    };
  }));
const check = async (where) => {
  const found = await audit();
  step(`${where}: ${found.length} date field${found.length === 1 ? '' : 's'} inside the screen`,
    found.length > 0 && found.every((f) => f.overflow < 0.5), JSON.stringify(found));
  step(`${where}: without the native sizing iOS stretches`,
    found.every((f) => f.appearance === 'none' && f.minWidth === '0px'), JSON.stringify(found));
};

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([
    { ...m.makeExercise({ name: 'Push-Up', modality: 'bodyweight' }), id: 'ex-push' },
  ]));
});
await page.reload();
await page.waitForSelector('.tabbar button');

await page.click('button:has-text("Log ad-hoc activity")');
await page.click('.modal .list-row.tappable:has-text("Push-Up")');
await page.waitForSelector('.modal input[type="date"]');
await check('log form');
await page.click('.modal-actions button:has-text("Cancel")');

await page.click('.segmented button:has-text("History")');
await page.waitForSelector('.card input[type="date"]');
await check('History filters (two side by side)');

await page.click('.tabbar button[data-tab="library"]');
await page.click('.segmented button:has-text("Gear")');
await page.click('button:has-text("+ Add gear")');
await page.waitForSelector('.modal input[type="date"]');
await check('gear form');
await page.click('.modal-actions button:has-text("Cancel")');

await page.click('.tabbar button[data-tab="plans"]');
await page.click('button:has-text("Import")');
await page.waitForSelector('.modal input[type="date"]');
await check('plan import start date');

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
