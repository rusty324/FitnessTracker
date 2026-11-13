// "Move to tomorrow": push a session back a day before its day is over —
// just that session, or it and every later one (a slide). Writes schedule
// records only; the plan and logs are untouched. On Today and on Plans.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

// ---------- pure ----------
const P = await page.evaluate(async () => {
  const S = await import('/js/schedule.js');
  const plan = { id: 'p', startDate: '2026-11-02', status: 'active', weeks: [{ index: 1, sessions: [{ id: 'a', dayOffset: 0 }, { id: 'b', dayOffset: 2 }] }] };
  const moved = S.moveSession({ plan, session: plan.weeks[0].sessions[0], key: 'p:a', date: '2026-11-02', days: 1, schedule: [] });
  const rep = { id: 'repeat:p:a:1', kind: 'repeat', planId: 'p', sessionId: 'a', date: '2026-11-09' };
  const movedRep = S.moveSession({ plan, session: plan.weeks[0].sessions[0], key: rep.id, date: rep.date, days: 1, schedule: [rep] });
  return {
    moved, movedRep,
    dates: S.occurrences([plan], moved).map((o) => `${o.session.id}@${o.date}`),
  };
});
step('just this session: one move record, the rest stay', JSON.stringify(P.moved) === '[{"id":"p:a","kind":"move","planId":"p","sessionId":"a","date":"2026-11-03"}]'
  && P.dates.join() === 'a@2026-11-03,b@2026-11-04', P.dates.join());
step('a repeated session moves its own repeat record', P.movedRep.length === 1 && P.movedRep[0].kind === 'repeat' && P.movedRep[0].date === '2026-11-10');

// ---------- seed: sessions today, +2, +4, +7, +9 ----------
const seed = (offsets = [0, 2, 4, 7, 9]) => page.evaluate(async (offs) => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const bench = { ...m.makeExercise({ name: 'Bench', modality: 'dumbbell' }), id: 'b' };
  const plan = m.makePlan({ name: 'Gym', startDate: d(0) });
  plan.id = 'gym';
  const w1 = m.makeWeek(1);
  const w2 = m.makeWeek(2);
  offs.forEach((off, k) => {
    (off < 7 ? w1 : w2).sessions.push({ ...m.makeSession({ label: `S${k + 1}`, dayOffset: off }), id: `s${k + 1}`,
      blocks: [{ id: `k${k}`, type: 'strength', items: [{ id: `i${k + 1}`, exerciseId: 'b', target: { kind: 'reps', sets: 2, reps: 10 } }] }] });
  });
  plan.weeks.push(w1, w2);
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([bench]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
}, offsets);
const stored = (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(`ft.data.data/${key}.json`) ?? '[]'), k);
const day = (n) => page.evaluate((k) => { const p = (x) => String(x).padStart(2, '0'); const x = new Date(); x.setDate(x.getDate() + k); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; }, n);

await seed();
await page.goto(`${BASE}#/logs`);
await page.reload();
await page.waitForSelector('.session-head');
step('Today: “Move to tomorrow” on the planned session', await page.isVisible('[data-action="move-tomorrow"]')
  && (await page.textContent('[data-action="move-tomorrow"]')) === 'Move to tomorrow');
const plansBefore = await page.evaluate(() => localStorage.getItem('ft.data.data/plans.json'));
await page.click('[data-action="move-tomorrow"]');
await page.waitForSelector('.modal-title:has-text("Move to tomorrow")');
step('the choice says what happens to the next session', /S2 stays on/.test(await page.textContent('.modal'))
  && /4 later sessions each move a day/.test(await page.textContent('.modal')), await page.textContent('.modal'));
const fits = await page.evaluate(() => [...document.querySelectorAll('.modal-actions button')].every((b) => b.getBoundingClientRect().right <= innerWidth)
  && document.documentElement.scrollWidth <= innerWidth);
step('390px: all three choices fit', fits);
await page.click('.modal-actions button:has-text("Just this session")');
await page.waitForSelector('.toast:has-text("Moved to")');
const s1 = await stored('schedule');
step('Just this session: one move record, to tomorrow', s1.length === 1 && s1[0].id === 'gym:s1' && s1[0].kind === 'move' && s1[0].date === await day(1), JSON.stringify(s1));
step('…the plan itself is untouched', (await page.evaluate(() => localStorage.getItem('ft.data.data/plans.json'))) === plansBefore);
await page.waitForSelector('text=Nothing planned for today');
step('…and today is now free', !(await page.isVisible('.session-head')));

// Slide the rest too.
await seed();
await page.reload();
await page.click('[data-action="move-tomorrow"]');
await page.click('.modal-actions button:has-text("Slide the rest too")');
await page.waitForSelector('.toast:has-text("Plan slid a day")');
const s2 = await stored('schedule');
const want = await Promise.all([1, 3, 5, 8, 10].map(day));
step('Slide the rest too: every session moves a day, spacing kept', s2.length === 5
  && ['s1', 's2', 's3', 's4', 's5'].every((id, i) => s2.find((r) => r.sessionId === id)?.date === want[i]), JSON.stringify(s2.map((r) => r.date)));

// Started already: no move.
await seed();
await page.reload();
await page.waitForSelector('.ex-card.is-open');
await page.locator('.ex-card.is-open .set-row[data-set="1"] .set-check').click();
await page.click('[data-action="move-tomorrow"]');
await page.waitForSelector('.toast.error:has-text("You’ve started this one")');
step('once a set is ticked, it can’t be moved (and the option goes)', (await page.locator('.modal').count()) === 0
  && !(await page.isVisible('[data-action="move-tomorrow"]')) && (await stored('schedule')).length === 0);

// The next session is tomorrow: say so.
await seed([0, 1, 4]);
await page.reload();
await page.click('[data-action="move-tomorrow"]');
step('if the next one is tomorrow, it warns you’d have two', /the same day, so you’d have two/.test(await page.textContent('.modal')));
await page.click('.modal-actions button:has-text("Cancel")');
step('Cancel writes nothing', (await stored('schedule')).length === 0);

// ---------- Plans ----------
await seed();
await page.click('.tabbar button[data-tab="plans"]');
await page.waitForSelector('.plan-head');
const cards = page.locator('.session-cards .session-card');
step('Plans: today’s card “Move to tomorrow”, later ones “Move a day later”',
  (await cards.nth(0).locator('[data-action="move-later"]').textContent()) === 'Move to tomorrow'
  && (await cards.nth(1).locator('[data-action="move-later"]').textContent()) === 'Move a day later');
await cards.nth(1).locator('[data-action="move-later"]').click();
await page.waitForSelector('.modal-title:has-text("Move a day later")');
step('…the button doesn’t also open the session editor', (await page.locator('.modal').count()) === 1);
await page.click('.modal-actions button:has-text("Just this session")');
await page.waitForSelector('.toast:has-text("Moved to")');
const s3 = await stored('schedule');
step('…moves that session a day', s3.length === 1 && s3[0].sessionId === 's2' && s3[0].date === await day(3));
await page.waitForFunction(() => /moved/.test(document.querySelectorAll('.session-cards .session-card')[1]?.textContent ?? ''));
step('…and its card says moved', true);

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
