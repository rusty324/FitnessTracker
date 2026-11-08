// Boot smoke test: every tab mounts, the bundled presets load, and a couple
// of writes round-trip through the store in local-only mode.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const stored = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), key);

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate(() => localStorage.setItem('ft.welcomed', '1'));

const tabs = await page.evaluate(() => [...document.querySelectorAll('.tabbar button')].map((b) => b.textContent));
step('three tabs, Fitness Library right of Logs', tabs.join(',') === 'Plans,Logs,Fitness Library', tabs.join(','));
step('opens on Logs → Today', (await page.locator('.segmented button.active').textContent()) === 'Today');
step('no data repo means local-only', (await page.textContent('#sync-badge')) === 'local only');

// ---- quick weigh-in ----
await page.fill('.card:has-text("Morning weigh-in") input', '80');
await page.click('.card:has-text("Morning weigh-in") button:has-text("Log")');
await page.waitForSelector('.pill.ok:has-text("weighed in")');
const metrics = await stored('ft.data.data/metrics.json');
step('the weigh-in is stored in canonical kg', metrics[0]?.weight === 80, JSON.stringify(metrics));

// ---- ad-hoc log ----
await page.click('button:has-text("Log ad-hoc activity")');
await page.waitForSelector('.modal-title:has-text("Pick exercise")');
step('ad-hoc logging opens the exercise picker', true);
await page.click('.modal-actions button:has-text("Cancel")');

// ---- plans tab: import a bundled starter plan ----
await page.click('.tabbar button[data-tab="plans"]');
await page.click('button:has-text("Import")');
await page.waitForSelector('.modal-title');
await page.waitForSelector('.list-row.tappable');
const presets = await page.locator('.modal .list-row.tappable').count();
step('bundled starter plans are listed', presets >= 2, `${presets} plans`);
await page.click('.modal .list-row.tappable >> nth=0');
await page.waitForSelector('.toast:has-text("Imported")');
step('importing a preset creates a plan', (await stored('ft.data.data/plans.json')).length === 1);
step('and its exercises land in the library',
  (await stored('ft.data.data/exercises.json')).length > 0);

// ---- library tab ----
await page.click('.tabbar button[data-tab="library"]');
await page.waitForSelector('.segmented button:has-text("Exercises")');
const libRows = await page.locator('.list-row').count();
step('the library lists the exercises the plan created', libRows > 0, `${libRows} rows`);

// ---- metrics view renders a chart ----
await page.click('.tabbar button[data-tab="logs"]');
await page.click('.segmented button:has-text("Metrics")');
await page.waitForSelector('svg, .empty-state');
step('metrics view mounts', true);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
