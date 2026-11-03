// "sync error" is clickable and opens a copyable report; and a repo file that
// isn't a list is refused rather than overwritten, as this app experiences it.
import { BASE, chromium, reporter, stubGithub } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const context = await browser.newContext({ viewport: { width: 390, height: 820 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const gh = await stubGithub(page, { dirs: { 'data/activities': [], 'data/imported': [], 'data/strava': [] } });

const TOKEN = 'github_pat_SHOULD_NEVER_APPEAR';
const METRICS = 'https://api.github.com/**/contents/data/metrics.json**';
const badge = () => page.textContent('#sync-badge');
const waitBadge = (t) => page.waitForFunction((x) => document.getElementById('sync-badge').textContent === x, t);
const report = () => page.inputValue('.modal textarea.gh-report');
const closeModal = () => page.click('.modal-actions button:has-text("Close")');

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate((tok) => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.datarepo', JSON.stringify({ owner: 'rusty324', repo: 'fitness-data', branch: 'main' }));
  localStorage.setItem('ft.pat', tok);
}, TOKEN);
await page.reload();
await waitBadge('synced');

// ---- a healthy badge does nothing ----
step('a synced badge is not a button', (await page.getAttribute('#sync-badge', 'role')) === null);
await page.click('#sync-badge');
await page.waitForTimeout(200);
step('and clicking it opens nothing', (await page.locator('.modal').count()) === 0);

// ---- GitHub rejects a write: "sync error", clickable ----
await page.route(METRICS, (route) => (route.request().method() === 'PUT'
  ? route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"Problems parsing JSON"}' })
  : route.fallback()));
await page.fill('.card:has-text("Morning weigh-in") input', '80');
await page.click('.card:has-text("Morning weigh-in") button:has-text("Log")');
await waitBadge('sync error');
step('a rejected write shows sync error', (await badge()) === 'sync error');
step('which is now a button', (await page.getAttribute('#sync-badge', 'role')) === 'button');

await page.click('#sync-badge');
await page.waitForSelector('.modal-title:has-text("Sync error")');
const text = await report();
step('the pop-up shows GitHub’s message', /RequestError: GitHub rejected data\/metrics\.json \(400\): Problems parsing JSON/.test(text), text.split('\n')[2]);
step('with the file, HTTP status, repo and version',
  /File:\s+data\/metrics\.json/.test(text) && /HTTP:\s+400/.test(text)
  && /rusty324\/fitness-data\/data \(branch main\)/.test(text) && /^ghsync 1\.2 /.test(text));
step('and what is still queued', /Queued:\s+data\/metrics\.json/.test(text));
step('the token is never in the report', !text.includes(TOKEN) && /Token:\s+saved \(not shown\)/.test(text));
step('the token is nowhere in the page either',
  !(await page.evaluate((t) => document.documentElement.outerHTML.includes(t)
    || [...document.querySelectorAll('input, textarea')].some((i) => i.value.includes(t)), TOKEN)));

await page.click('.modal button:has-text("Copy")');
await page.waitForSelector('.toast:has-text("Copied")');
step('Copy puts exactly the report on the clipboard',
  (await page.evaluate(() => navigator.clipboard.readText())) === text);

// keyboard: the badge is reachable and opens the same pop-up
await closeModal();
await page.focus('#sync-badge');
await page.keyboard.press('Enter');
await page.waitForSelector('.modal-title:has-text("Sync error")');
step('Enter on the focused badge opens it too', true);

// ---- fixed upstream: Retry now clears it ----
await page.unroute(METRICS);
await page.click('.modal button:has-text("Retry now")');
await waitBadge('synced');
await page.waitForFunction(() => !document.querySelector('.modal'));
step('Retry now syncs, closes the pop-up and resets the badge',
  (await badge()) === 'synced' && (await page.getAttribute('#sync-badge', 'role')) === null);

// ---- a repo file that isn't a list: refused, never overwritten ----
// What another app's file looks like when two apps share a folder.
const foreign = JSON.stringify({ app: 'someone-else', entries: [{ id: 'keep-me' }] });
let overwrites = 0;
await page.route(METRICS, (route) => {
  const req = route.request();
  if (req.method() === 'GET') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: Buffer.from(foreign).toString('base64'), sha: 'foreign-sha' }),
    });
  }
  // Like GitHub: a write to an existing file must name its current sha.
  const body = JSON.parse(req.postData());
  if (body.sha !== 'foreign-sha') {
    return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }) });
  }
  overwrites++;
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"content":{"sha":"new"}}' });
});
await page.evaluate(() => {
  // A device that never saw the file, with no weigh-in yet today.
  localStorage.removeItem('ft.sha.data/metrics.json');
  localStorage.setItem('ft.data.data/metrics.json', '[]');
});
await page.reload();
await waitBadge('sync error');
step('loading a non-list file is refused at startup', (await badge()) === 'sync error');
step('the foreign object never reaches the app: metrics stay a list',
  (await page.evaluate(() => localStorage.getItem('ft.data.data/metrics.json'))) === '[]'
  && (await page.locator('.card:has-text("Morning weigh-in")').count()) === 1);

await page.fill('.card:has-text("Morning weigh-in") input', '79');
await page.click('.card:has-text("Morning weigh-in") button:has-text("Log")');
await page.waitForTimeout(800);
step('a new weigh-in does not overwrite the foreign file', overwrites === 0, `${overwrites} overwrites`);
step('it is kept locally and queued',
  (await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/metrics.json')).some((m) => m.weight === 79)))
  && (await page.evaluate(() => JSON.parse(localStorage.getItem('ft.queue')).includes('data/metrics.json'))));
await page.click('#sync-badge');
await page.waitForSelector('.modal-title:has-text("Sync error")');
const shape = await report();
step('the pop-up says which file and why, and that nothing was lost',
  /ShapeError: data\/metrics\.json in the data repo isn’t a list of records with ids \(found an object\)/.test(shape)
  && /local copy is kept/.test(shape), shape.split('\n')[2]);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
