// Timed exercises (planks, holds, stretches) as sets × reps × time per rep:
// the stored shape and every older one, set rows on Today with time in place
// of weight (ghosts from last time, timer-style typing, ±5 s steppers), the
// log form, History, the plan's target editor, the weekly "longest hold",
// and the 390px layout.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

// ---------- pure ----------
const pure = await page.evaluate(async () => {
  const S = await import('/js/sets.js');
  const H = await import('/js/history.js');
  const { rwiWork } = await import('/js/rwi.js');
  const { longestHold } = await import('/js/load.js');
  const { targetSummary } = await import('/js/ui/plans-tab.js');
  const { actualFromRows, rowsFromActual } = await import('/js/ui/set-rows.js');
  const { weeklyReview } = await import('/js/review.js');
  const uniform = S.timedFields([{ reps: 1, sec: 20 }, { reps: 1, sec: 20 }]);
  const varied = S.timedFields([{ reps: 1, sec: 30 }, { reps: 1, sec: 25 }, { reps: 2, sec: 20 }]);
  const ex = { id: 'p', name: 'Front Plank', category: 'strength', measurementType: 'duration', primaryTargets: ['core'] };
  const review = weeklyReview({
    weekStart: '2026-11-09', today: '2026-11-11', exercises: [ex],
    logs: [
      { id: 'a', date: '2026-11-02', exerciseId: 'p', actual: { durationSec: 30 } }, // the old shape
      { id: 'b', date: '2026-11-10', exerciseId: 'p', actual: { sets: 2, holdReps: 1, setHoldSec: [45, 40] } },
    ],
  });
  return {
    uniform, varied,
    old: S.timedPerSet({ durationSec: 25 }),
    oldSets: S.timedPerSet({ sets: 3, durationSec: 30 }),
    notTimed: [S.timedPerSet({ sets: 3, reps: 10, weight: 20 }).length, S.timedPerSet({ movingSec: 1800, distanceM: 5000 }).length],
    text: [S.formatTimedSets(uniform), S.formatTimedSets(varied), S.formatTimedSets({ sets: 3, holdReps: 5, holdSec: 10 }),
      S.formatTimedSets({ durationSec: 90 })],
    total: S.totalTimedSec({ sets: 3, holdReps: 5, holdSec: 10 }),
    setsOf: H.setsOf({ actual: varied }),
    noRepsLeak: S.repsPerSet(varied).length,
    rwi: rwiWork({ sets: 3, holdReps: 5, holdSec: 10 }),
    rwiOld: rwiWork({ durationSec: 40 }),
    hold: [longestHold({ actual: varied }), longestHold({ actual: { durationSec: 50 } })],
    targets: [targetSummary({ kind: 'duration', sets: 2, durationSec: 20 }), targetSummary({ kind: 'duration', sets: 3, reps: 5, durationSec: 10 }),
      targetSummary({ kind: 'duration', durationSec: 1800 })],
    rows: actualFromRows([{ reps: 1, sec: 20, done: true }, { reps: 1, sec: 25, done: true }, { reps: 1, sec: 30, done: false }], { timed: true }),
    back: rowsFromActual({ sets: 2, holdReps: 3, holdSec: 30 }, { timed: true }),
    prs: review.prs.map((p) => ({ kind: p.kind, value: p.value, was: p.was })),
    core: review.volume.find((v) => v.group === 'core')?.sets ?? null,
  };
});
step('stored: alike sets stay compact, differing ones become lists', JSON.stringify(pure.uniform) === '{"sets":2,"holdReps":1,"holdSec":20}'
  && JSON.stringify(pure.varied) === '{"sets":3,"setHoldReps":[1,1,2],"setHoldSec":[30,25,20]}', JSON.stringify([pure.uniform, pure.varied]));
step('older logs read: one duration is one hold (or N sets of it)', JSON.stringify(pure.old) === '[{"reps":1,"sec":25}]' && pure.oldSets.length === 3);
step('reps × weight and cardio aren’t read as timed', pure.notTimed.join() === '0,0');
step('text: 2 × 20s · 3 sets: 30s, 25s, 2 × 20s · 3 × 5 × 10s · 1:30', pure.text.join(' | ') === '2 × 20s | 3 sets: 30s, 25s, 2 × 20s | 3 × 5 × 10s | 1:30', pure.text.join(' | '));
step('time under tension counts every rep (3 × 5 × 10s = 150 s)', pure.total === 150);
step('history: each set’s reps and time per rep (the ghosts)', pure.setsOf.map((x) => `${x.reps}×${x.durationSec}`).join() === '1×30,1×25,2×20');
step('timed reps never leak into reps maths (load, progression)', pure.noRepsLeak === 0);
step('RWI: total time, old shape unchanged', pure.rwi.basis === 'time' && pure.rwi.perSet[0] === 150 && pure.rwiOld.perSet[0] === 40);
step('load metrics: longest single hold', pure.hold.join() === '30,50');
step('plan targets: 2 × 20s, 3 × 5 × 10s, 30m', pure.targets.join(' | ') === '2 × 20s | 3 × 5 × 10s | 30m', pure.targets.join(' | '));
step('rows → stored: only ticked sets', JSON.stringify(pure.rows) === '{"sets":2,"holdReps":1,"setHoldSec":[20,25]}', JSON.stringify(pure.rows));
step('stored → rows (editing a log)', pure.back.length === 2 && pure.back.every((r) => r.reps === 3 && r.sec === 30 && r.done));
step('weekly review: a longer hold is a personal best', pure.prs.length === 1 && pure.prs[0].kind === 'hold' && pure.prs[0].value === 45 && pure.prs[0].was === 30, JSON.stringify(pure.prs));
step('…and a plank’s sets count toward core volume', pure.core === 2);

// ---------- seed: today's session ----------
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const plank = { ...m.makeExercise({ name: 'Front Plank', modality: 'bodyweight', measurementType: 'duration' }), id: 'ex-plank' };
  const stretch = { ...m.makeExercise({ name: 'Hamstring Stretch', category: 'mobility', modality: 'other', measurementType: 'duration' }), id: 'ex-ham' };
  const plan = m.makePlan({ name: 'Core', startDate: d(0) });
  const week = m.makeWeek(1);
  const session = { ...m.makeSession({ label: 'Core day', dayOffset: 0 }), id: 'sess-1' };
  const block = m.makeBlock({ type: 'main' });
  block.items.push({ ...m.makeBlockItem({ exerciseId: plank.id, target: { kind: 'duration', sets: 2, durationSec: 20, restSec: 45 } }), id: 'pi-plank' });
  block.items.push({ ...m.makeBlockItem({ exerciseId: stretch.id, target: { kind: 'duration', sets: 2, reps: 3, durationSec: 30 } }), id: 'pi-ham' });
  session.blocks.push(block);
  week.sessions.push(session);
  plan.weeks.push(week);
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([plank, stretch]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  // Last time, in the old one-number shape: 25 s.
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    { ...m.makeLogEntry({ date: d(3), exerciseId: plank.id, actual: { durationSec: 25 } }), id: 'old-plank' }]));
});
await page.reload();
await page.waitForSelector('.ex-card.is-open');
const open = page.locator('.ex-card.is-open');
const rowOf = (n) => open.locator(`.set-row[data-set="${n}"]`);
const logs = () => page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json') ?? '[]'));

step('Today: a plank opens as set rows', /Front Plank/.test(await open.locator('.ex-title').textContent()) && (await rowOf(2).count()) === 1);
step('…columns Time and Reps (no weight)', (await open.locator('.set-head').textContent()).replace(/\s/g, '') === 'SetTimeReps'
  && (await open.locator('[data-name="weight"], button:has-text("+ Add weight")').count()) === 0, await open.locator('.set-head').textContent());
step('ghosts: last time’s 0:25, one rep', (await rowOf(1).locator('[data-name="time"]').getAttribute('placeholder')) === '0:25'
  && (await rowOf(1).locator('[data-name="reps"]').getAttribute('placeholder')) === '1');
step('…and “Last time” says 25s', /Last time .*25s/.test(await open.locator('.last-time').textContent()));
await rowOf(1).locator('.set-check').click();
const dr = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ft.draft.')))));
step('✓ commits the ghost to the draft (not the repo)', dr.items['pi-plank'].rows[0].sec === 25 && dr.items['pi-plank'].timed === true
  && !(await logs()).some((l) => l.plannedExerciseId === 'pi-plank'));
step('…and starts the plan’s 45 s rest', await page.isVisible('.rest-bar') && /0:4[45]/.test(await page.textContent('.rest-time')));
await page.click('.rest-bar button:has-text("Skip")');
// Timer-style typing: 3, 0 -> 0:30.
const t2 = rowOf(2).locator('[data-name="time"]');
await t2.click();
await t2.pressSequentially('30');
step('typing digits fills like a timer (30 → 0:30)', (await t2.inputValue()) === '0:30');
await rowOf(2).locator('.set-check').click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json')).some((l) => l.plannedExerciseId === 'pi-plank'));
const plankLog = (await logs()).find((l) => l.plannedExerciseId === 'pi-plank');
step('all sets ticked: written as one log, sets × reps × time', JSON.stringify(plankLog.actual) === '{"sets":2,"holdReps":1,"setHoldSec":[25,30]}', JSON.stringify(plankLog.actual));

// The stretch opens next: 2 × 3 × 0:30 from the plan.
step('the next exercise opens: the stretch, 2 × 3 × 30s', /Hamstring Stretch/.test(await open.locator('.ex-title').textContent())
  && /2 × 3 × 30s/.test(await open.textContent()));
step('…planned reps and time as ghosts', (await rowOf(1).locator('[data-name="reps"]').getAttribute('placeholder')) === '3'
  && (await rowOf(1).locator('[data-name="time"]').getAttribute('placeholder')) === '0:30');
await rowOf(1).locator('[aria-label="Set 1 time plus"]').click();
step('time stepper: +5 s', (await rowOf(1).locator('[data-name="time"]').inputValue()) === '0:35');
await rowOf(1).locator('[aria-label="Set 1 reps minus"]').click();
await rowOf(1).locator('.set-check').click();
await page.click('.rest-bar button:has-text("Skip")').catch(() => {});
await rowOf(2).locator('.set-check').click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json')).some((l) => l.plannedExerciseId === 'pi-ham'));
const hamLog = (await logs()).find((l) => l.plannedExerciseId === 'pi-ham');
step('stored per set: 2 × 35s, 3 × 30s', JSON.stringify(hamLog.actual) === '{"sets":2,"setHoldReps":[2,3],"setHoldSec":[35,30]}', JSON.stringify(hamLog.actual));
step('the collapsed card says what was done', /✓ 2 sets: 2 × 35s, 3 × 30s/.test(await page.textContent('.ex-card[data-item="pi-ham"]')), await page.textContent('.ex-card[data-item="pi-ham"]'));
const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('390px: no horizontal overflow', ov <= 0);
await page.click('.ex-card[data-item="pi-plank"]');
const cols = await page.evaluate(() => {
  const r = document.querySelector('.ex-card.is-open .set-row[data-set="1"]');
  const t = r.querySelector('[data-name="time"]').getBoundingClientRect();
  const n = r.querySelector('[data-name="reps"]').getBoundingClientRect();
  return { side: t.right <= n.left, fits: r.getBoundingClientRect().right <= innerWidth, w: t.width };
});
step('390px: time beside reps, each field wide enough for 1:30', cols.side && cols.fits && cols.w >= 36, JSON.stringify(cols));

// ---------- History and the log form ----------
await page.click('.segmented button:has-text("History")');
await page.waitForSelector('.list-row:has-text("Front Plank")');
step('History: “2 sets: 25s, 30s”', /2 sets: 25s, 30s/.test(await page.textContent('.list-row:has-text("Front Plank") >> nth=0')),
  await page.textContent('.list-row:has-text("Front Plank") >> nth=0'));
step('History: the old one-number log reads as 25s', (await page.locator('.list-row:has-text("Front Plank"):has-text("25s")').count()) >= 1);
// Open the old log: it shows as one done set of 0:25; saving rewrites it in the new shape.
const oldRow = page.locator('.list-row:has-text("Front Plank")').last();
await oldRow.locator('.row-sub').first().click();
await page.waitForSelector('.modal .set-rows');
step('log form: timed set rows instead of “Duration (min)”', (await page.locator('.modal label:has-text("Duration (min)")').count()) === 0
  && (await page.inputValue('.modal .set-row[data-set="1"] [data-name="time"]')) === '0:25');
await page.click('.modal .set-footer button:has-text("+ Add set")');
const t = page.locator('.modal .set-row[data-set="2"] [data-name="time"]');
await t.click();
await t.pressSequentially('40');
await page.click('.modal-actions button:has-text("Save")');
await page.waitForSelector('.modal', { state: 'detached' });
const old = (await logs()).find((l) => l.id === 'old-plank');
step('log form: a typed time counts without ✓ (reps default to 1)', JSON.stringify(old.actual) === '{"sets":2,"holdReps":1,"setHoldSec":[25,40]}', JSON.stringify(old.actual));

// ---------- the plan's target editor ----------
await page.click('.tabbar button[data-tab="plans"]');
await page.waitForSelector('.plan-head');
await page.click('[data-action="edit-plan"]');
await page.click('.card .row-main.tappable');
await page.waitForSelector('.modal');
await page.click('.modal .list-row:has-text("Hamstring Stretch") [aria-label="Edit target"]');
await page.waitForSelector('.modal label:has-text("Reps per set")');
const tf = page.locator('.modal [data-name="time"]').last();
step('target editor: sets, reps per set, time per rep', (await page.inputValue('.modal [data-name="reps"] >> nth=-1')) === '3' && (await tf.inputValue()) === '0:30');
await tf.fill('');
await tf.pressSequentially('45');
await page.locator('.modal-actions button:has-text("Save")').last().click();
await page.locator('.modal-actions button:has-text("Save")').last().click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem('ft.data.data/plans.json'))[0].weeks[0].sessions[0].blocks[0].items[1].target.durationSec === 45);
const target = await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/plans.json'))[0].weeks[0].sessions[0].blocks[0].items[1].target);
step('…saved as sets 2, reps 3, 45 s per rep', target.kind === 'duration' && target.sets === 2 && target.reps === 3 && target.durationSec === 45, JSON.stringify(target));

step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
