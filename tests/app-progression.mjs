// Phase B — progression suggestions. The spec's golden values against the
// pure js/progression.js, then how they show: the chip on Today, suggested
// ghosts (✓ logs the suggestion; ✕ goes back to last time), an advance that
// logs at the next level, and the exercise page's "Next time" card.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

const g = await page.evaluate(async () => {
  const P = await import('/js/progression.js');
  const bar = { name: 'Bench', modality: 'barbell', measurementType: 'reps' };
  const range = { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12 };
  const S = (date, reps, kg, extra = {}) => ({ date, variantLevel: null, mode: 'full', ...extra,
    sets: reps.map((r, i) => ({ reps: r, weightKg: Array.isArray(kg) ? kg[i] : kg })) });
  const today = '2026-11-10';
  const s = (history, o = {}) => P.suggestNext({ exercise: bar, plannedTarget: range, history, today, units: 'metric', ...o });
  const ladder = { name: 'Push-Up', modality: 'bodyweight', measurementType: 'reps',
    variants: [{ level: 1, name: 'Wall' }, { level: 2, name: 'Incline' }, { level: 3, name: 'Floor' }] };
  const fixed = { kind: 'reps', sets: 3, reps: 10, variantLevel: 2 };
  const V = (date, lvl, reps, mode = 'full') => ({ date, variantLevel: lvl, mode, sets: reps.map((r) => ({ reps: r, weightKg: 0 })) });
  const v = (history, target = fixed, ex = ladder, o = {}) => P.suggestNext({ exercise: ex, plannedTarget: target, history, today, ...o });
  const six = { ...ladder, variants: [1, 2, 3, 4, 5, 6].map((level) => ({ level, name: `L${level}` })) };
  return {
    add: s([S('2026-11-04', [12, 12, 12], 60)]),
    hold1: s([S('2026-11-04', [12, 12, 11], 60)]).kind,
    hold2: s([S('2026-11-04', [12, 12], 60)]).kind,
    backoff: s([S('2026-11-04', [12, 12, 12], [60, 60, 50])]).kind,
    drop: s([S('2026-11-08', [6, 8, 8], 60), S('2026-11-04', [6, 9, 8], 60)]),
    dropOne: s([S('2026-11-08', [6, 8, 8], 60)]).kind,
    deload: s([S('2026-11-04', [12, 12, 12], 60)], { weekIsDeload: true }),
    ret: s([S('2026-10-11', [10, 10, 10], 60)]),
    imperial: P.suggestNext({ exercise: bar, plannedTarget: range, history: [S('2026-11-04', [12, 12, 12], 61.235)], today, units: 'imperial' }),
    adv: v([V('2026-11-08', 2, [10, 10, 10]), V('2026-11-05', 2, [10, 11, 10])]),
    advOne: v([V('2026-11-08', 2, [10, 10, 10]), V('2026-11-05', 1, [10, 10, 10])]).kind,
    top: v([V('2026-11-08', 3, [10, 10, 10]), V('2026-11-05', 3, [10, 10, 10])], { ...fixed, variantLevel: 3 }),
    regress: v([V('2026-11-08', 2, [7, 8, 8]), V('2026-11-05', 2, [6, 8, 8])]),
    gap: v([V('2026-11-08', 4, [14, 12, 11])], { kind: 'reps', sets: 3, reps: 15, variantLevel: 6 }, six),
    pain: s([S('2026-11-04', [12, 12, 12], 60)], { painHold: true }),
    minimumIgnored: s([S('2026-11-08', [12, 12, 12], 60, { mode: 'minimum' }), S('2026-11-04', [10, 10, 10], 60)]).kind,
    minimumAdvance: v([V('2026-11-08', 2, [10, 10], 'minimum'), V('2026-11-05', 2, [10, 10, 10])]).kind,
    noWeights: s([S('2026-11-04', [12, 12, 12], null)]),
    modes: [
      P.progressionModeOf(bar, range), P.progressionModeOf(ladder, fixed),
      P.progressionModeOf({ modality: 'run', measurementType: 'duration' }, { kind: 'duration' }),
      P.progressionModeOf({ modality: 'band', measurementType: 'reps' }, { kind: 'reps', reps: 10 }),
    ].join(),
    rangeFixed: P.rangeOf({ reps: 10 }).join(), rangeNone: P.rangeOf({ kind: 'reps' }),
  };
});
const near = (a, b) => Math.abs(a - b) < 0.01;
step('add: 12/12/12 at 60 kg, range 8–12 → 62.5 kg, reps reset to 8', g.add.kind === 'add' && g.add.weightKg === 62.5 && g.add.repsMin === 8);
step('…with the evidence in the reason', /12\/12\/12 at 60 kg on Nov 4/.test(g.add.reason) && g.add.basis.date === '2026-11-04', g.add.reason);
step('hold: 12/12/11', g.hold1 === 'hold');
step('hold: 12/12 with 3 planned', g.hold2 === 'hold');
step('hold: back-off set at 50 leaves only 2 working sets', g.backoff === 'hold');
step('drop: two sessions at 60 with a first set of 6 → 57.5', g.drop.kind === 'drop' && g.drop.weightKg === 57.5);
step('one such session is a hold', g.dropOne === 'hold');
step('deload week at the top of the range: no change', g.deload.kind === 'deload' && g.deload.weightKg === 60 && /Deload week/.test(g.deload.reason));
step('return: 30 days off, 60 × 0.9 = 54 → 55', g.ret.kind === 'return' && g.ret.weightKg === 55);
step('imperial: 135 lb (61.235 kg) → add shows 140 lb', g.imperial.kind === 'add' && near(g.imperial.weightKg * 2.20462262, 140), g.imperial.weightKg);
step('variant: two sessions at the top of level 2 → advance to 3, reps reset', g.adv.kind === 'advance' && g.adv.variantLevel === 3 && g.adv.repsMin === 10);
step('variant: one session at the top → hold', g.advOne === 'hold');
step('variant: top of the ladder → hold', g.top.kind === 'hold' && /Top of the ladder/.test(g.top.reason));
step('variant: two first sets under the range → regress', g.regress.kind === 'regress' && g.regress.variantLevel === 1);
step('variant_gap: plan level 6, last logged 4', g.gap.kind === 'variant_gap' && /Plan asks for level 6; you last did level 4 \(best 14 reps\)/.test(g.gap.reason), g.gap.reason);
step('pain on the last session: hold, never add', g.pain.kind === 'hold' && /Pain/.test(g.pain.reason));
step('minimum sessions don’t count toward add…', g.minimumIgnored === 'hold');
step('…or advance', g.minimumAdvance === 'hold');
step('a weighted exercise with no weights logged: no suggestion', g.noWeights === null);
step('modes: double, variant, none for cardio and unweighted bands', g.modes === 'double,variant,,', g.modes);
step('rangeOf: fixed reps is [reps, reps]; none is null', g.rangeFixed === '10,10' && g.rangeNone === null);

// ---------- Today ----------
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const p = (n) => String(n).padStart(2, '0');
  const d = (back) => { const x = new Date(); x.setDate(x.getDate() - back); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  const bench = { ...m.makeExercise({ name: 'Dumbbell Bench Press', modality: 'dumbbell' }), id: 'ex-bench' };
  const push = { ...m.makeExercise({ name: 'Push-Up', modality: 'bodyweight' }), id: 'ex-push',
    variants: [{ level: 1, name: 'Wall Push-Up' }, { level: 2, name: 'High Incline Push-Up' }, { level: 3, name: 'Low Incline Push-Up' }] };
  const plan = m.makePlan({ name: 'Gym', startDate: d(0) });
  const week = m.makeWeek(1);
  const session = { ...m.makeSession({ label: 'Upper', dayOffset: 0 }), id: 's1' };
  const block = m.makeBlock({ type: 'strength' });
  block.items.push({ ...m.makeBlockItem({ exerciseId: bench.id, target: { kind: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 90 } }), id: 'pi-bench' });
  block.items.push({ ...m.makeBlockItem({ exerciseId: push.id, target: { kind: 'reps', sets: 2, reps: 10, variantLevel: 2 } }), id: 'pi-push' });
  session.blocks.push(block);
  week.sessions.push(session);
  plan.weeks.push(week);
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.units', JSON.stringify({ weight: 'lb', distance: 'mi', length: 'in' }));
  localStorage.setItem('ft.data.data/exercises.json', JSON.stringify([bench, push]));
  localStorage.setItem('ft.data.data/plans.json', JSON.stringify([plan]));
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([
    // 12/12/12 at 40 lb → try 45 lb
    { ...m.makeLogEntry({ date: d(6), exerciseId: bench.id, actual: { sets: 3, reps: 12, weight: 18.144 } }), id: 'b' },
    // two sessions at the top of level 2 → move up to level 3
    { ...m.makeLogEntry({ date: d(5), exerciseId: push.id, actual: { sets: 2, reps: 10, weight: 0, variantLevel: 2 } }), id: 'p1' },
    { ...m.makeLogEntry({ date: d(3), exerciseId: push.id, actual: { sets: 2, setReps: [11, 10], weight: 0, variantLevel: 2 } }), id: 'p2' },
  ]));
});
await page.reload();
await page.waitForSelector('.ex-card.is-open .sug-chip');
const open = page.locator('.ex-card.is-open');
step('Today: a chip under the exercise — ↑ Try 45 lb', /Try 45 lb/.test(await open.locator('.sug-title').textContent())
  && (await open.locator('.sug-arrow').textContent()) === '↑');
step('…citing the evidence', /12\/12\/12 at 40 lb on/.test(await open.locator('.sug-reason').textContent()));
const ph = (n, name) => open.locator(`.set-row[data-set="${n}"] [data-name="${name}"]`);
step('the ghosts become the suggestion, with an arrow and accent',
  (await ph(1, 'weight').getAttribute('placeholder')) === '45' && (await ph(1, 'reps').getAttribute('placeholder')) === '8'
  && (await ph(1, 'weight').getAttribute('class')).includes('ghost-suggested')
  && (await open.locator('.set-row[data-set="1"] .stepper').first().getAttribute('data-arrow')) === '↑'
  && (await open.locator('.set-row[data-set="1"] .stepper').first().evaluate((n) => getComputedStyle(n, '::after').content)) === '"↑"');
step('the collapsed push-up card previews its suggestion', /↑ Move up: Low Incline Push-Up/.test(await page.textContent('.ex-card[data-item="pi-push"]')));

await open.locator('.set-row[data-set="1"] .set-check').click();
let draft = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('ft.draft.')))));
step('✓ on the suggested ghosts logs the suggestion (45 lb × 8)',
  draft.items['pi-bench'].rows[0].reps === 8 && Math.abs(draft.items['pi-bench'].rows[0].kg * 2.20462262 - 45) < 0.01);
await open.locator('.set-row[data-set="1"] .set-check').click(); // untick
await open.locator('.sug-x').click();
step('✕ hides the chip…', !(await page.isVisible('.ex-card.is-open .sug-chip')));
step('…and the ghosts go back to last time', (await ph(2, 'weight').getAttribute('placeholder')) === '40' && (await ph(2, 'reps').getAttribute('placeholder')) === '12');
const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /sug|suggest/i.test(k)));
step('the rejection is not stored', stored.length === 0, stored.join());

// The push-up: advance → logs at level 3.
await page.click('.ex-card[data-item="pi-push"]');
await page.waitForSelector('.ex-card.is-open[data-item="pi-push"] .sug-chip');
const pushCard = page.locator('.ex-card.is-open[data-item="pi-push"]');
step('advance: the card shows the suggested variant', /Low Incline Push-Up/.test(await pushCard.locator('.ex-title').textContent()));
step('…and the plan beside it', /Plan: 2 × 10 · L2 · Suggested: level 3 \(Low Incline Push-Up\), 2 × 10/.test(await pushCard.locator('.sug-plan').textContent()),
  await pushCard.locator('.sug-plan').textContent());
for (const n of [1, 2]) await pushCard.locator(`.set-row[data-set="${n}"] .set-check`).click();
await page.waitForFunction(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json')).some((l) => l.plannedExerciseId === 'pi-push'));
const pushLog = await page.evaluate(() => JSON.parse(localStorage.getItem('ft.data.data/logs.json')).find((l) => l.plannedExerciseId === 'pi-push'));
step('ticking it logs at level 3', pushLog.actual.variantLevel === 3 && pushLog.actual.reps === 10, JSON.stringify(pushLog.actual));

// ---------- exercise page: Next time ----------
await page.goto(`${BASE}/#/library/exercise/ex-bench`);
await page.reload();
await page.waitForSelector('.next-time');
const order = await page.evaluate(() => {
  const n = document.querySelector('.next-time');
  const l = document.querySelector('.load-section');
  return !l || (n.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
});
step('exercise page: a Next time card above the Load index', order && /Try 45 lb/.test(await page.textContent('.next-time')));

// ---------- variant_gap on the exercise page ----------
await page.evaluate(() => {
  const k = 'ft.data.data/plans.json';
  const plans = JSON.parse(localStorage.getItem(k));
  plans[0].weeks[0].sessions[0].blocks[0].items[1].target.variantLevel = 5;
  localStorage.setItem(k, JSON.stringify(plans));
  const ek = 'ft.data.data/exercises.json';
  const ex = JSON.parse(localStorage.getItem(ek));
  ex[1].variants.push({ level: 4, name: 'Knee Push-Up' }, { level: 5, name: 'Standard Push-Up' });
  localStorage.setItem(ek, JSON.stringify(ex));
  // Drop today's log (and its draft, or the next load writes it back) so the
  // last one is level 2.
  for (const k of Object.keys(localStorage)) if (k.startsWith('ft.draft.')) localStorage.removeItem(k);
  const lk = 'ft.data.data/logs.json';
  localStorage.setItem(lk, JSON.stringify(JSON.parse(localStorage.getItem(lk)).filter((l) => l.plannedExerciseId !== 'pi-push' && l.id !== 'p2')));
});
await page.goto(`${BASE}/#/library/exercise/ex-push`);
await page.reload();
await page.waitForSelector('.next-time');
step('a plan two+ levels ahead gets a soft “stay” note', /Plan asks for level 5; you last did level 2/.test(await page.textContent('.next-time')),
  await page.textContent('.next-time'));

const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
step('390px: no horizontal overflow', ov <= 0);
step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
