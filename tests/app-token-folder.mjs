// Rotating the GitHub token, and the data-repo folder setting, as this app
// uses them. Token rotation is the path that was reported misbehaving: an
// expired token, writes queuing behind it, then a new token pasted in.
import { BASE, chromium, reporter, stubGithub } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const gh = await stubGithub(page, { dirs: { 'data/activities': [], 'data/imported': [], 'data/strava': [] } });

// GitHub answers 401 to the old token and normally to the new one.
const OLD = 'github_pat_OLD_expired';
const NEW = 'github_pat_NEW_working';
const seenTokens = [];
await page.route('https://api.github.com/**', (route) => {
  const auth = route.request().headers().authorization ?? '';
  seenTokens.push(auth.replace('Bearer ', ''));
  if (auth === `Bearer ${OLD}`) {
    return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
  }
  return route.fallback();
});

const badge = () => page.textContent('#sync-badge');
const waitBadge = (t) => page.waitForFunction((x) => document.getElementById('sync-badge').textContent === x, t);
const queue = () => page.evaluate(() => JSON.parse(localStorage.getItem('ft.queue') ?? '[]'));
const expand = (id) => page.evaluate((i) => {
  document.querySelector(`.settings-section[data-section="${i}"]`).open = true;
}, id);

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate((tok) => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.datarepo', JSON.stringify({ owner: 'rusty324', repo: 'fitness-data', branch: 'main' }));
  localStorage.setItem('ft.pat', tok);
}, OLD);
await page.reload();
await waitBadge('sync error');

// ---- an expired token ----
step('an expired token shows sync error, not pending', (await badge()) === 'sync error');
step('and the tooltip says it was auth', /auth failed \(401\)/i.test(await page.getAttribute('#sync-badge', 'title')),
  await page.getAttribute('#sync-badge', 'title'));
await page.fill('.card:has-text("Morning weigh-in") input', '81');
await page.click('.card:has-text("Morning weigh-in") button:has-text("Log")');
await page.waitForSelector('.pill.ok:has-text("weighed in")');
step('a write made meanwhile is kept locally and queued', (await queue()).includes('data/metrics.json'));

// ---- paste the new one ----
await page.click('#settings-btn');
await page.waitForSelector('.modal-title:has-text("Settings")');
await expand('token');
step('the saved token is never rendered into the page',
  !(await page.evaluate((t) => document.documentElement.outerHTML.includes(t)
    || [...document.querySelectorAll('input')].some((i) => i.value.includes(t)), OLD)));
seenTokens.length = 0;
gh.reset();
await page.fill('.settings-section[data-section="token"] input[type="password"]', NEW);
await page.click('.settings-section[data-section="token"] button:has-text("Save token")');
await page.waitForSelector('.toast:has-text("Token saved — syncing")');
await waitBadge('synced');
step('the new token replaces the old one', (await page.evaluate(() => localStorage.getItem('ft.pat'))) === NEW);
step('the queued write goes out', (await queue()).length === 0
  && gh.puts().some((c) => c.url.endsWith('/contents/data/metrics.json')));
step('with the new token only, from the moment it was saved',
  seenTokens.length > 0 && seenTokens.every((t) => t === NEW), [...new Set(seenTokens)].join(','));
step('the badge recovers without a reload', (await badge()) === 'synced');
step('and its tooltip clears', (await page.getAttribute('#sync-badge', 'title')) === '');

await page.reload();
await waitBadge('synced');
step('still synced after a reload', (await badge()) === 'synced');

// ---- clearing the token returns to local-only ----
await page.click('#settings-btn');
await expand('token');
await page.click('.settings-section[data-section="token"] button:has-text("Clear token")');
await page.waitForSelector('.toast:has-text("Token cleared")');
step('Clear token goes local-only', (await badge()) === 'local only'
  && (await page.evaluate(() => localStorage.getItem('ft.pat'))) === null);
await page.fill('.settings-section[data-section="token"] input[type="password"]', NEW);
await page.click('.settings-section[data-section="token"] button:has-text("Save token")');
// Saving re-opens Settings once validation returns; wait for that before
// touching the modal, or the next step acts on the one being replaced.
await page.waitForSelector('.toast:has-text("Token saved — syncing")');
await waitBadge('synced');

// ---- "Folder in the repo" maps every path, activity shards included ----
await expand('datarepo');
await page.fill('.settings-section[data-section="datarepo"] input[aria-label="Folder"]', 'apps/fitness');
step('the folder preview shows where files will go',
  /apps\/fitness\/logs\.json/.test(await page.textContent('.settings-section[data-section="datarepo"]')));
// Let the refresh started by the token save finish first, so every request
// logged below belongs to the refresh this save starts.
await page.waitForTimeout(500);
gh.reset();
await page.click('button:has-text("Save data repo")');
await page.waitForSelector('.settings-section[data-section="token"][open]');
const logged = () => gh.calls.map((c) => c.url.split('/contents/')[1]?.split('?')[0]).filter(Boolean);
for (let i = 0; i < 50 && !logged().includes('apps/fitness/strava'); i++) await page.waitForTimeout(100);
const paths = logged();
step('collections are read from the chosen folder',
  paths.includes('apps/fitness/metrics.json') && !paths.some((p) => p.startsWith('data/')), paths.slice(0, 6).join(', '));
step('activity shards are listed from it too',
  ['activities', 'imported', 'strava'].every((d) => paths.includes(`apps/fitness/${d}`)),
  paths.filter((p) => !p.endsWith('.json')).join(', '));
step('the folder is stored with the repo config',
  (await page.evaluate(() => JSON.parse(localStorage.getItem('ft.datarepo')).dir)) === 'apps/fitness');
step('Activity sync explains the matching DATA_DIR variable',
  /DATA_DIR/.test(await page.textContent('.settings-section[data-section="activitysync"]')));

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
