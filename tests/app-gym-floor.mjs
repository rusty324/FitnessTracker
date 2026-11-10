// Phase A — gym-floor logging: last performance, set rows on Today (ghosts,
// one-tap ✓), drafts that survive a reload and flush on pagehide, the rest
// timer (timestamp-based, fake clock), Finish session, sanity checks, Undo
// instead of confirm, and the 390px layout.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

// ---------- pure: lastPerformance, ghostSet, checkSet, sessionStatus ----------
const pure = await page.evaluate(async () => {
  const H = await import('/js/history.js');
  const { checkSet } = await import('/js/sanity.js');
  const S = await import('/js/sessions.js');
  const ex = { id: 'e', variants: [{ level: 1, name: 'A' }, { level: 2, name: 'B' }] };
  const logs = [
    { id: 'a', date: '2026-11-01', exerciseId: 'e', actual: { sets: 3, reps: 10, variantLevel: 1 } },
    { id: 'b', date: '2026-11-03', exerciseId: 'e', actual: { sets: 2, setReps: [8, 6], variantLevel: 2 } },
    { id: 'c', date: '2026-11-05', exerciseId: 'e', actual: { sets: 3, reps: 12, variantLevel: 1 } },
  ];
  const lp = (lvl, before) => H.lastPerformance({ exerciseId: 'e', variantLevel: lvl, logs, beforeDate: before, exercise: ex });
  const two = lp(2, '2026-11-10');
  const hist = [{ weightKg: 60 }, { weightKg: 60 }, { weightKg: 62.5 }];
  const session = { id: 's1', blocks: [{ items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3', optional: true }] }] };
  return {
    sameVariant: lp(1, '2026-11-10')?.logId,
    otherVariant: two?.logId,
    strictlyBefore: lp(1, '2026-11-05')?.logId,
    none: lp(1, '2026-11-01'),
    ghosts: [0, 1, 2, 3].map((i) => H.ghostSet(two, i)?.reps),
    normal: checkSet({ weightKg: 62.5, reps: 8, history: hist }),
    triple: checkSet({ weightKg: 200, reps: 5, history: hist })?.message,
    tripleTooLittleHistory: checkSet({ weightKg: 200, reps: 5, history: hist.slice(0, 2) }),
    unitMix: checkSet({ weightKg: 132.3, reps: 5, history: hist })?.message,
    unitMixDown: checkSet({ weightKg: 27.2, reps: 5, history: hist })?.message,
    nan: checkSet({ weightKg: NaN, reps: 5 }),
    negative: checkSet({ reps: -1 }),
    manyReps: checkSet({ reps: 150 })?.message,
    heavyFirst: checkSet({ weightKg: 600, reps: 1 })?.message,
    allLogged: S.sessionStatus({ session, date: 'd', doneIds: new Set(['i1', 'i2']) }).completed,
    partLogged: S.sessionStatus({ session, date: 'd', doneIds: new Set(['i1']) }).completed,
    finished: S.sessionStatus({ session, date: 'd', doneIds: new Set(), records: [{ id: 'd:s1', kind: 'minimum' }] }),
  };
});
step('lastPerformance: only logs at the same variant', pure.sameVariant === 'c' && pure.otherVariant === 'b');
step('lastPerformance: strictly before the date', pure.strictlyBefore === 'a' && pure.none === null);
step('fewer sets last time: the last one repeats', pure.ghosts.join() === '8,6,6,6');
step('checkSet: a normal set has no warning', pure.normal === null);
step('checkSet: over 3× the heaviest (with ≥3 prior sets)', /3×/.test(pure.triple ?? '') && pure.tripleTooLittleHistory === null);
step('checkSet: lb/kg mix-up both ways', /lb and kg/.test(pure.unitMix ?? '') && /lb and kg/.test(pure.unitMixDown ?? ''));
step('checkSet: NaN and negatives are rejected', pure.nan?.reject === true && pure.negative?.reject === true);
step('checkSet: 100+ reps or 500 kg with no history warn', /typo/.test(pure.manyReps) && /500 kg/.test(pure.heavyFirst));
step('completed: every non-optional item logged', pure.allLogged === true && pure.partLogged === false);
step('completed: a Finish record counts (minimum too)', pure.finished.completed && pure.finished.kind === 'minimum');

// ---------- seed: today's session, last week's numbers ----------
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const bench = { ...m.makeExercise({ name: 'Dumbbell Bench Press', modality: 'dumbbell' }), id: 'ex-bench' };
  const row = { ...m.makeExercise({ name: 'Dumbbell Row', modality: 'dumbbell' }), id: 'ex-row' };
  const plank = { ...m.makeExercise({ name: 'Front Plank', modality: 'other', measurementType: 'duration' }), id: 'ex-plank' };
  const plan = m.makePlan({ name: 'Gym', startDate: d(0) });
  const week = m.makeWeek(1);
  const session = { ...m.makeSession({ label: 'Upper', dayOffset: 0 }), id: 'sess-1' };
  const block = m.makeBlock({ type: 'strength' });
  block.items.push({ ...m.makeBlockItem({ exerciseId: bench.id, target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 90 } }), id: 'pi-bench' });
  block.items.push({ ...m.makeBlockItem({ exerciseId: row.id, target: { kind: 'reps', sets: 2, reps: 10 } }), id: 'pi-row' });
  block.items.push({ ...m.makeBlockItem({ exerciseId: plank.id, target: { kind: 'duration', sets: 3, durationSec: 30 } }), id: 'pi-plank' });
  session.blocks.push(block);
  week.sessions.push(session);
  plan.weeks.push(week);
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.units', JSON.stringify({ weight: 'lb', distance: 'mi', length: 'in' }));
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([bench, row, plank]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  // 12/12/11 at 40 lb (18.144 kg) six days ago.
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    { ...m.makeLogEntry({ date: d(6), exerciseId: bench.id, actual: { sets: 3, setReps: [12, 12, 11], weight: 18.144 } }), id: 'last-bench' },
  ]));
});
await page.reload();
await page.waitForSelector('.ex-card.is-open');

const open = page.locator('.ex-card.is-open');
const rowOf = (n) => open.locator(`.set-row[data-set="${n}"]`);
const draft = () => page.evaluate(() => {
  const k = Object.keys(localStorage).find((x) => x.startsWith('ft.draft.'));
  return k ? JSON.parse(localStorage.getItem(k)) : null;
});
const logs = () => page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json') ?? '[]'));
const todaysBench = async () => (await logs()).find((l) => l.plannedExerciseId === 'pi-bench');

step('the first rep exercise opens on its own', /Dumbbell Bench Press/.test(await open.textContent()));
step('it says what you did last time', /Last time .*12 \/ 12 \/ 11 @ 40 lb/.test(await open.textContent()), await open.locator('.last-time').textContent());
const ph = (n, name) => rowOf(n).locator(`[data-name="${name}"]`).getAttribute('placeholder');
step('ghosts are last session’s sets, in pounds', (await ph(1, 'weight')) === '40' && (await ph(3, 'reps')) === '11');
step('nothing is filled in until you act', (await rowOf(1).locator('[data-name="reps"]').inputValue()) === '');

// ---------- one tap: same as last time ----------
await rowOf(1).locator('.set-check').click();
let dr = await draft();
step('✓ on untouched fields commits the ghosts (to the draft)',
  dr?.items['pi-bench']?.rows[0].reps === 12 && Math.abs(dr.items['pi-bench'].rows[0].kg - 18.144) < 0.001 && dr.items['pi-bench'].rows[0].done);
step('…and no log is written per set', !(await todaysBench()));
step('the rest timer starts at the plan’s 1:30', await page.isVisible('.rest-bar') && (await page.textContent('.rest-time')) === '1:30');

// ---------- edited fields commit as typed ----------
await rowOf(2).locator('[data-name="weight"]').fill('45');
await rowOf(2).locator('[data-name="reps"]').fill('9');
await rowOf(2).locator('.set-check').click();
dr = await draft();
step('edited fields commit as typed (45 lb ≈ 20.412 kg × 9)',
  dr.items['pi-bench'].rows[1].reps === 9 && Math.abs(dr.items['pi-bench'].rows[1].kg - 20.412) < 0.001);
step('a ticked row shows its values', (await rowOf(2).locator('[data-name="weight"]').inputValue()) === '45');

// ---------- rest timer: from timestamps, on a fake clock ----------
const clock = (ms) => page.evaluate(async (dt) => {
  const R = await import('/js/rest-timer.js');
  const base = window.__t0 ??= Date.now();
  R._setClock(() => base + dt);
  R.render();
}, ms);
await page.evaluate(async () => {
  const R = await import('/js/rest-timer.js');
  window.__t0 = Date.now();
  R._setClock(() => window.__t0);
  R.startRest(90);
});
await clock(30_000);
step('timer: 30 s later it reads 1:00', (await page.textContent('.rest-time')) === '1:00');
await page.click('.rest-bar button:has-text("+15")');
step('timer: +15 → 1:15', (await page.textContent('.rest-time')) === '1:15');
await page.click('.rest-bar button:has-text("−15")');
await page.click('.rest-bar button:has-text("−15")');
step('timer: −15 twice → 0:45', (await page.textContent('.rest-time')) === '0:45');
// The screen locks for 40 s: no ticks run, then the page is visible again.
await page.evaluate(async () => {
  const R = await import('/js/rest-timer.js');
  R._setClock(() => window.__t0 + 70_000);
  document.dispatchEvent(new Event('visibilitychange'));
});
step('timer: right after a hidden → visible return (0:05)', (await page.textContent('.rest-time')) === '0:05');
await page.click('.rest-bar button:has-text("Skip")');
step('timer: Skip clears it', await page.isHidden('.rest-bar'));
await page.evaluate(async () => (await import('/js/rest-timer.js'))._setClock(null));

// ---------- the draft survives a reload, and flushes on pagehide ----------
await page.reload();
await page.waitForSelector('.ex-card.is-open');
step('a reload keeps ticked sets', (await rowOf(1).locator('.set-check').getAttribute('aria-pressed')) === 'true'
  && (await rowOf(2).locator('[data-name="reps"]').inputValue()) === '9');
await page.evaluate(() => dispatchEvent(new Event('pagehide')));
let bench = await todaysBench();
step('pagehide writes the ticked sets as a log',
  JSON.stringify(bench?.actual) === JSON.stringify({ sets: 2, setReps: [12, 9], setWeights: [18.144, 20.412] }), JSON.stringify(bench?.actual));

// ---------- finishing the exercise writes it and opens the next ----------
await rowOf(3).locator('.set-check').click();
await page.waitForSelector('.ex-card.is-open:has-text("Dumbbell Row")');
bench = await todaysBench();
step('the last ✓ updates the same log (no duplicate)', bench.actual.sets === 3
  && (await logs()).filter((l) => l.plannedExerciseId === 'pi-bench').length === 1);
step('the next exercise opens', /Dumbbell Row/.test(await page.textContent('.ex-card.is-open')));
step('with the plan’s reps as ghosts when there is no history', (await ph(1, 'reps')) === '10' && (await ph(1, 'weight')) === '');

// ---------- sanity warning: inline, never blocking ----------
await rowOf(1).locator('[data-name="weight"]').fill('1200'); // 544 kg, no history
await rowOf(1).locator('.set-check').click();
step('a suspicious set warns inline but still counts', await page.isVisible('.set-warn:has-text("500 kg")')
  && (await rowOf(1).locator('.set-check').getAttribute('aria-pressed')) === 'true');

// ---------- layout at 390px ----------
const lay = await page.evaluate(() => {
  const rect = (e) => e.getBoundingClientRect();
  const ctrls = [...document.querySelectorAll('.ex-card.is-open .set-row:not(.set-head) .step-btn, .ex-card.is-open .set-check, .ex-card.is-open .stepper')];
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: ctrls.filter((e) => rect(e).height < 44 || rect(e).width < 44).length,
    count: ctrls.length,
  };
});
step('390px: no horizontal overflow', lay.overflow <= 0, `${lay.overflow}px`);
step('set-row controls are ≥ 44 px', lay.count > 0 && lay.small === 0, `${lay.small} of ${lay.count} too small`);
await page.evaluate(() => scrollTo(0, 0));
const fb = await page.evaluate(() => {
  const r = document.querySelector('.finish-bar').getBoundingClientRect();
  return { top: r.top, vh: innerHeight, scroll: document.documentElement.scrollHeight > innerHeight };
});
step('Finish session sits in the bottom 40% of the screen', !fb.scroll || fb.top >= fb.vh * 0.6, `${fb.top} of ${fb.vh}`);

// ---------- Finish session ----------
await page.click('[data-action="finish"]');
await page.waitForSelector('.toast:has-text("Session finished")');
const sessions = await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/sessions.json') ?? '[]'));
step('Finish records the session as full', sessions.length === 1 && sessions[0].kind === 'full' && sessions[0].plannedSessionId === 'sess-1'
  && /:sess-1$/.test(sessions[0].id), JSON.stringify(sessions));
step('…writes the ticked row set', (await logs()).some((l) => l.plannedExerciseId === 'pi-row' && l.actual.sets === 1));
step('…and clears the draft', (await draft()) === null);
step('the session shows as done', await page.isVisible('.session-head .pill:has-text("done")') && !(await page.isVisible('[data-action="finish"]')));

// ---------- Undo instead of confirm ----------
await page.click('.segmented button:has-text("History")');
await page.click('.list-row:has-text("Dumbbell Row") .row-main');
await page.click('.modal-actions button:has-text("Delete")');
step('delete asks nothing: the entry disappears with an Undo toast',
  !(await page.isVisible('.modal-title:has-text("Confirm")')) && await page.isVisible('.toast-undo')
  && !(await page.isVisible('.list-row:has-text("Dumbbell Row")')));
step('…but is still stored while Undo is offered', (await logs()).some((l) => l.plannedExerciseId === 'pi-row'));
await page.click('.toast-undo button:has-text("Undo")');
await page.waitForSelector('.list-row:has-text("Dumbbell Row")');
step('Undo restores it', (await logs()).some((l) => l.plannedExerciseId === 'pi-row'));
await page.click('.list-row:has-text("Dumbbell Row") .row-main');
await page.click('.modal-actions button:has-text("Delete")');
await page.waitForSelector('.toast-undo', { state: 'detached', timeout: 8000 });
step('when the toast expires, the removal is committed', !(await logs()).some((l) => l.plannedExerciseId === 'pi-row'));

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
