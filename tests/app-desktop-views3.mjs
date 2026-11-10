// Desktop redesign, batch 3: Plans opens on the current plan — week N of M
// with a progress bar, the weeks (a sidebar on desktop, chips on a phone),
// the missed-session card, the week's session cards — and "Switch plan"
// opens the plan list, where each plan keeps its editor.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const errors = [];

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForSelector('.tabbar button');
  await page.evaluate(async () => {
    const m = await import('/js/models.js');
    const p = (n) => String(n).padStart(2, '0');
    const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
    const bench = { ...m.makeExercise({ name: 'Bench', modality: 'dumbbell' }), id: 'b' };
    // 12 weeks of 3 sessions, started 15 days ago: weeks 1–2 done, week 3 now
    // (its first session, 1 day ago, missed).
    const plan = m.makePlan({ name: 'Strength Block', startDate: d(15) });
    plan.id = 'gym';
    const logs = [];
    for (let w = 1; w <= 12; w++) {
      const week = m.makeWeek(w);
      for (const [k, off] of [[1, 0], [2, 2], [3, 4]]) {
        const dayOffset = (w - 1) * 7 + off;
        week.sessions.push({ ...m.makeSession({ label: `Full body ${k}`, dayOffset }), id: `s${w}${k}`, ...(k === 2 ? { estimatedDurationMin: 50 } : {}),
          blocks: [{ id: `k${w}${k}`, type: 'strength', name: 'Main', items: [{ id: `i${w}${k}`, exerciseId: 'b', target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12 } }] }] });
        if (w <= 2) logs.push({ ...m.makeLogEntry({ date: d(15 - dayOffset), exerciseId: 'b', planId: plan.id, plannedExerciseId: `i${w}${k}`, actual: { sets: 3, reps: 10, weight: 20 } }), id: `L${w}${k}` });
      }
      plan.weeks.push(week);
    }
    const other = m.makePlan({ name: 'Run Base', startDate: d(3) });
    other.id = 'run';
    const ow = m.makeWeek(1);
    ow.sessions.push({ ...m.makeSession({ label: 'Easy run', dayOffset: 5 }), id: 'r1', blocks: [] });
    other.weeks.push(ow);
    localStorage.clear();
    localStorage.setItem('ft.welcomed', '1');
    localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([bench]));
    localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan, other]));
    localStorage.setItem('ft.data.data/logs.json', JSON.stringify(logs));
  });
  await page.goto(`${BASE}#/plans`);
  await page.reload();
  await page.waitForSelector('.segmented button');
  return page;
}

let page = await open({ width: 1280, height: 900 });
await page.waitForSelector('.plan-head');
step('Plans opens on the current plan (the one running today)', (await page.textContent('.plan-head .page-h1')) === 'Strength Block');
const prog = await page.textContent('.plan-progress');
step('“Week 3 of 12” and “2 weeks done”', /Week 3 of 12/.test(prog) && /2 weeks done/.test(prog), prog);
step('the progress bar is 2/12 full', (await page.getAttribute('.progress-bar', 'aria-valuenow')) === '2');
const lay = await page.evaluate(() => {
  const s = document.querySelector('.week-side').getBoundingClientRect();
  const m = document.querySelector('.plan-layout .col-main').getBoundingClientRect();
  return { side: s.right <= m.left + 1, wide: document.getElementById('view').classList.contains('wide') };
});
step('desktop: weeks as a sidebar beside the sessions, full width', lay.side && lay.wide, JSON.stringify(lay));
const weeks = await page.locator('.week-btn').allTextContents();
step('the sidebar: a window of weeks around this one, then “N more weeks”', weeks[0].includes('Week 1') && weeks.length === 8
  && /4 more weeks/.test(await page.textContent('.week-list')), weeks.join());
step('…done weeks ticked, this one marked and selected', (await page.locator('.week-btn[data-week="1"] .week-mark.done').count()) === 1
  && (await page.locator('.week-btn[data-week="3"] .week-mark.current').count()) === 1
  && (await page.getAttribute('.week-btn[data-week="3"]', 'aria-current')) === 'true');
step('the missed session card shows on Plans', await page.isVisible('.plan-layout .overdue-card'));
const cards = page.locator('.session-cards .session-card');
step('three session cards for this week', (await cards.count()) === 3);
const pills = await page.locator('.session-cards .status-pill').allTextContents();
step('…each with its status (Open for the missed one)', pills[0] === 'Open' && ['Planned', 'Today'].includes(pills[1]), pills.join());
step('…the label, date, minutes and a block summary', /Full body 1/.test(await cards.first().textContent())
  && /~5 min/.test(await cards.first().textContent()) && /Main.*3 × 8–12/.test(await cards.first().locator('.block-row').textContent()),
  await cards.first().textContent());
const link = cards.first().locator('.session-exercises a.ex-link');
step('each session lists its exercises as library links', (await link.count()) === 1 && (await link.textContent()) === 'Bench'
  && (await link.getAttribute('href')) === '#/library/exercise/b');
step('the plan’s own session length wins over the estimate', /~50 min/.test(await cards.nth(1).textContent()), await cards.nth(1).textContent());
step('the next week as a row below', /Week 4.*3 sessions/.test(await page.textContent('[data-action="next-week"]')));
await page.click('.week-btn[data-week="1"]');
step('picking a week shows its sessions, all Done', (await page.locator('.session-cards .status-pill').allTextContents()).every((t) => t === 'Done'));
await page.click('.week-list .link-btn');
step('“more weeks” shows them all', (await page.locator('.week-btn').count()) === 12);
await page.click('.session-cards .session-card >> nth=0');
step('tapping a session opens its editor', (await page.locator('.modal').count()) === 1);
await page.keyboard.press('Escape');
await page.evaluate(() => document.querySelector('.modal-backdrop, .modal')?.closest('.modal-backdrop, .modal-root')?.remove());

// Switch plan → the list; tapping a plan makes it current.
await link.click();
await page.waitForSelector('.page-h1:has-text("Bench")');
step('tapping a name opens the exercise (not the session editor)', page.url().endsWith('#/library/exercise/b') && (await page.locator('.modal').count()) === 0);
await page.click('.tabbar button[data-tab="plans"]');
await page.waitForSelector('.plan-head');
await page.click('[data-action="edit-plan"]');
await page.waitForSelector('#view h2:has-text("Strength Block")');
const dl = page.locator('.card a.ex-link').first();
step('the plan editor’s session cards link their exercises too', (await dl.getAttribute('href')) === '#/library/exercise/b');
await dl.click();
await page.waitForSelector('.page-h1:has-text("Bench")');
step('…and the link wins over opening the session', (await page.locator('.modal').count()) === 0);
await page.click('.tabbar button[data-tab="plans"]');
await page.waitForFunction(() => location.hash === '#/plans' && !document.querySelector('.lib-side, .col-lib'));
const back = await page.evaluate(() => ({ hash: location.hash, head: !!document.querySelector('.plan-head'), links: document.querySelectorAll('#view .card a.ex-link').length, h: document.querySelector('#view h2')?.textContent }));
step('back on Plans: still in the editor you left', !back.head && back.links > 0, JSON.stringify(back));
await page.click('.segmented button:has-text("Plans")');
await page.waitForSelector('.plan-head');
await page.click('[data-action="switch-plan"]');
await page.waitForSelector('h2:has-text("Training plans")');
step('Switch plan opens the plan list (with Import)', await page.isVisible('button:has-text("Import")'));
await page.click('.card[data-plan="run"]');
await page.waitForSelector('.plan-head');
step('tapping a plan makes it the current one', (await page.textContent('.plan-head .page-h1')) === 'Run Base'
  && (await page.evaluate(() => localStorage.getItem('ft.currentPlan'))) === 'run');
await page.click('[data-action="switch-plan"]');
await page.click('.card[data-plan="gym"] [data-action="edit"]');
step('each plan keeps its editor (Edit)', await page.isVisible('text=Strength Block') && (await page.locator('.plan-head').count()) === 0);
await page.click('.segmented button:has-text("Plans")');
await page.click('[data-action="edit-plan"]');
step('Edit plan opens the current plan’s editor', (await page.locator('.plan-head').count()) === 0);
await page.click('.segmented button:has-text("Calendar")');
step('Calendar still there', await page.isVisible('.cal-grid'));
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('1280px: no horizontal overflow', ov <= 0);

// ---------- phone ----------
page = await open({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
await page.waitForSelector('.plan-head');
const ph = await page.evaluate(() => {
  const list = document.querySelector('.week-list');
  const a = document.querySelectorAll('.week-btn')[0].getBoundingClientRect();
  const b = document.querySelectorAll('.week-btn')[1].getBoundingClientRect();
  return { row: Math.abs(a.top - b.top) < 2, scrolls: getComputedStyle(list).overflowX === 'auto',
    wide: document.getElementById('view').classList.contains('wide'),
    ov: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
step('phone: weeks as a scrolling row of chips', ph.row && ph.scrolls && !ph.wide, JSON.stringify(ph));
step('phone: session cards one per row', await page.evaluate(() => {
  const c = [...document.querySelectorAll('.session-card')].map((x) => x.getBoundingClientRect());
  return c.length === 3 && c[1].top > c[0].bottom - 1;
}));
step('phone: no horizontal overflow', ph.ov <= 0);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
