// The app opens with no connection (service worker), and pulls from the data
// repo again when it comes back to the foreground instead of only at load.
import { BASE, chromium, reporter, stubGithub } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const context = await browser.newContext({ viewport: { width: 390, height: 820 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const gh = await stubGithub(page, { dirs: { 'data/activities': [], 'data/imported': [], 'data/strava': [] } });

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate(() => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.datarepo', JSON.stringify({ owner: 'rusty324', repo: 'fitness-data', branch: 'main' }));
  localStorage.setItem('ft.pat', 'tok');
});
await page.reload();
await page.waitForFunction(() => document.getElementById('sync-badge').textContent === 'synced');

// ---- foreground refresh ----
const gets = () => gh.calls.filter((c) => c.method === 'GET' && c.url.includes('/contents/data/logs.json')).length;
const show = (state) => page.evaluate((s) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
  document.dispatchEvent(new Event('visibilitychange'));
}, state);
await page.waitForTimeout(1200); // the startup refresh is still landing
const atLoad = gets();
await show('hidden');
await show('visible');
await page.waitForTimeout(300);
step('coming back within a minute does not pull again', gets() === atLoad, `${gets()} vs ${atLoad}`);
await page.evaluate(() => { const now = Date.now(); Date.now = () => now + 61000; });
await show('hidden');
await show('visible');
await page.waitForFunction((n) => true, null).then(() => page.waitForTimeout(500));
step('coming back later pulls the data repo again', gets() === atLoad + 1, `${gets()} vs ${atLoad}`);

// ---- offline start ----
// The app warms its cache by itself a moment after load; wait for that.
await page.reload();
await page.evaluate(() => new Promise((resolve) => {
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'precached') resolve(); });
}));
step('the service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));
await context.setOffline(true);
await page.reload();
await page.waitForSelector('.tabbar button', { timeout: 15000 }).catch(() => {});
step('the app opens with no connection', (await page.locator('.tabbar button').count()) >= 3);
// The title is set once the tab has mounted; under load that is a moment
// after the tab bar appears.
await page.waitForFunction(() => document.getElementById('page-title')?.textContent === 'Today', null, { timeout: 10000 }).catch(() => {});
step('on Today', (await page.textContent('#page-title')) === 'Today', await page.textContent('#page-title').catch(() => ''));
await page.click('.tabbar button:has-text("Library")');
await page.waitForTimeout(400);
step('other tabs load offline too', (await page.textContent('#page-title')) !== 'Today' && (await page.locator('#view').innerText()).length > 0);
await context.setOffline(false);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
