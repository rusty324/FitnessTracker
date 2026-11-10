// Phone-width layout regressions the owner found on an iPhone: stray
// "false"/"null" text in set rows, Finish session below the ad-hoc button,
// no weight column on mobility work, and nothing pushing the page sideways
// (the calendar's long session labels, a long data-repo path in Settings).
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

await page.goto(BASE);
await page.waitForSelector('.tabbar button');
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const ankles = { ...m.makeExercise({ name: 'Ankle Circles & Calf Pumps', category: 'mobility', modality: 'mobility' }), id: 'ex-ank' };
  const walk = { ...m.makeExercise({ name: 'Warm-Up Walk', category: 'cardio', modality: 'walk', measurementType: 'duration' }), id: 'ex-walk' };
  const plan = m.makePlan({ name: 'Couch to 10K — 26-Week Conservative Build', startDate: d(0) });
  for (let w = 1; w <= 5; w++) {
    const week = m.makeWeek(w);
    for (const [i, off] of [[1, 0], [2, 2], [3, 4]]) {
      const s = m.makeSession({ label: `Week ${w} · Session ${i} — Run/Walk`, dayOffset: (w - 1) * 7 + off });
      const b = m.makeBlock({ type: 'warmup', name: 'Warm-up & activation' });
      b.items.push(m.makeBlockItem({ exerciseId: walk.id, target: { kind: 'duration', durationSec: 300 } }));
      b.items.push(m.makeBlockItem({ exerciseId: ankles.id, target: { kind: 'reps', sets: 1, reps: 10, perSide: true } }));
      s.blocks.push(b);
      week.sessions.push(s);
    }
    plan.weeks.push(week);
  }
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([ankles, walk]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    // logged with the old bodyweight convention (weight 0)
    { ...m.makeLogEntry({ date: d(2), exerciseId: ankles.id, actual: { sets: 1, reps: 10, weight: 0 } }), id: 'old' },
  ]));
});
await page.reload();
await page.waitForSelector('.ex-card.is-open');

// ---------- set rows ----------
const openCard = page.locator('.ex-card.is-open');
const stray = () => openCard.evaluate((n) => /false|null|undefined/.test(n.textContent));
step('no stray "false"/"null" text with one set', !(await stray()), await openCard.textContent());
await openCard.locator('button:has-text("+ Add set")').click();
step('…or with two', !(await stray()));
step('a mobility exercise has no weight column', (await openCard.locator('[data-name="weight"]').count()) === 0
  && await openCard.locator('button:has-text("+ Add weight")').isVisible());
step('…even when its last log stored the bodyweight 0', /Last time/.test(await openCard.textContent()));

// ---------- Finish session sits last ----------
const order = await page.evaluate(() => {
  const all = [...document.querySelectorAll('#view button')];
  return {
    finish: all.findIndex((b) => b.dataset.action === 'finish'),
    adhoc: all.findIndex((b) => /Log ad-hoc/.test(b.textContent)),
    last: document.querySelector('#view').lastElementChild?.classList.contains('finish-bar'),
  };
});
step('Finish session comes after “+ Log ad-hoc activity”', order.finish > order.adhoc && order.adhoc >= 0, JSON.stringify(order));
step('…as the last thing on the page', order.last);
step('Today: no sideways scroll', (await overflow()) <= 0, `${await overflow()}px`);

// ---------- the calendar ----------
await page.click('.tabbar button[data-tab="plans"]');
await page.click('.segmented button:has-text("Calendar")');
await page.waitForSelector('.cal-grid');
step('calendar: long session labels don’t push the page sideways', (await overflow()) <= 0, `${await overflow()}px`);
const cols = await page.$$eval('.cal-grid > *', (cells) => [...new Set(cells.slice(7, 14).map((c) => Math.round(c.getBoundingClientRect().width)))]);
step('calendar: the seven columns are equal', cols.length === 1, cols.join(','));
const dot = page.locator('.cal-cell.today .cal-dot').first();
step('calendar: phone labels are compact (W1 S1) with the full label kept for tooltips',
  (await dot.innerText()) === 'W1 S1' && /Week 1 · Session 1 — Run\/Walk/.test(await dot.getAttribute('title')), await dot.innerText());

// ---------- Settings: a long repo path ----------
await page.evaluate(() => localStorage.setItem('ft.datarepo', JSON.stringify({
  owner: 'rusty324', repo: 'aVeryLongPrivateRepositoryName', branch: 'main', dir: 'fitnessTrackerLogsWithALongFolderName',
})));
await page.reload();
await page.click('#settings-btn');
await page.waitForSelector('.settings-section');
const wide = await page.evaluate(() => {
  const modal = document.querySelector('.modal');
  const box = modal.getBoundingClientRect();
  return [...modal.querySelectorAll('.sec-state, .settings-body *, .check-row *')]
    .filter((e) => e.getBoundingClientRect().right > box.right + 1).map((e) => e.textContent.slice(0, 40));
});
step('settings: a long data-repo path stays inside its box', wide.length === 0, wide.join(' | '));
step('settings: no sideways scroll', (await overflow()) <= 0);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
