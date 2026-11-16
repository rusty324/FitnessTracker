// Today with nothing planned shows the next session; Polar's time is labelled
// as total duration; a sync merge that took in another device's changes
// shows a toast.
import { BASE, chromium, reporter, stubGithub } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

const today = await page.evaluate(async () => (await import('/js/dates.js')).todayStr());
const plus = (n) => page.evaluate(async ([t, d]) => (await import('/js/dates.js')).addDays(t, d), [today, n]);

// ---- next session ----
await page.evaluate(async ([start]) => {
  const store = await import('/js/storage/store.js');
  await store.save('plans', [{
    id: 'p1', name: 'Base Plan', status: 'active', startDate: start, weeks: [{ index: 0, sessions: [
      { id: 's1', label: 'Easy run', dayOffset: 3, blocks: [{ type: 'main', items: [{ id: 'i1', exerciseId: 'e1' }, { id: 'i2', exerciseId: 'e2' }] }] },
    ] }],
  }]);
}, [today]);
await page.evaluate(() => { location.hash = '#/logs'; });
await page.reload();
await page.waitForSelector('.next-session');
const card = await page.textContent('.next-session');
step('an empty Today names the next session', /Next: Easy run/.test(card), card);
step('with when, the plan, and its size', /in 3 days/.test(card) && /Base Plan/.test(card) && /2 exercises/.test(card), card);

await page.evaluate(async ([start]) => {
  const store = await import('/js/storage/store.js');
  const plans = store.get('plans');
  plans[0].startDate = start;
  await store.save('plans', plans);
}, [await plus(-2)]);
await page.waitForFunction(() => /Tomorrow/.test(document.querySelector('.next-session')?.textContent || ''));
step('a session tomorrow says so', true);

await page.evaluate(async () => { const store = await import('/js/storage/store.js'); await store.save('plans', []); });
await page.waitForFunction(() => /no plan has a session coming up/.test(document.querySelector('.next-session')?.textContent || ''));
step('with no plan running it says that instead', true);

// ---- Polar time is total time ----
const sums = await page.evaluate(async () => {
  const { actualSummary } = await import('/js/ui/logs-tab.js');
  const run = { distanceM: 5000, movingSec: 1800 };
  return [actualSummary({ ...run, source: 'polar' }), actualSummary({ ...run, source: 'gpx' }), actualSummary({ ...run, source: 'polar', edited: true })];
});
step('a Polar activity shows total time and pace incl. stops', /30m total/.test(sums[0]) && /incl\. stops/.test(sums[0]), sums[0]);
step('other sources are unchanged', !/total|incl/.test(sums[1]), sums[1]);
step('and so is a Polar activity whose time was edited', !/total|incl/.test(sums[2]), sums[2]);

// ---- merge toast ----
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 820 } });
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push(String(e)));
let remoteSha = 'r1';
const gh = await stubGithub(p2, { dirs: { 'data/activities': [], 'data/imported': [], 'data/strava': [] } });
void gh;
// metrics.json: a PUT conflicts once, and the repo's copy holds another device's weigh-in.
let conflicted = false;
await p2.route('https://api.github.com/**/contents/data/metrics.json**', (route) => {
  const req = route.request();
  if (req.method() === 'PUT' && !conflicted) {
    conflicted = true;
    return route.fulfill({ status: 409, contentType: 'application/json', body: '{"message":"does not match"}' });
  }
  if (req.method() === 'GET') {
    const body = JSON.stringify([{ id: 'theirs', date: '2026-01-01', weight: 70 }]);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: Buffer.from(body).toString('base64'), sha: remoteSha }) });
  }
  return route.fallback();
});
await p2.goto(BASE);
await p2.waitForSelector('.tabbar button');
await p2.evaluate(() => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.datarepo', JSON.stringify({ owner: 'rusty324', repo: 'fitness-data', branch: 'main' }));
  localStorage.setItem('ft.pat', 'tok');
  location.hash = '#/logs';
});
await p2.reload();
await p2.waitForSelector('.card:has-text("Morning weigh-in")');
remoteSha = 'r2'; // the repo moves on after this device loaded it
await p2.fill('.card:has-text("Morning weigh-in") input', '80');
await p2.click('.card:has-text("Morning weigh-in") button:has-text("Log")');
const toastSeen = await p2.waitForSelector('.toast:has-text("Merged changes from another device")', { timeout: 8000 }).then(() => true, () => false);
step('a merge that took in another device\'s changes shows a toast', toastSeen && conflicted);
await ctx2.close();

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
