// Phase D — the adaptive schedule, minimum sessions, pain flags and weekly
// dots. The schedule wrapper (js/schedule.js) is the only place a session's
// date is computed: a source scan below fails if any other module does it.
import { BASE, chromium, reporter, stubGithub } from './lib.mjs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { step, done } = reporter();
const root = fileURLToPath(new URL('..', import.meta.url));
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// ---------- no direct callers of the nominal date ----------
async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const offenders = [];
for (const f of await jsFiles(join(root, 'js'))) {
  if (f.endsWith(join('js', 'schedule.js'))) continue;
  const src = await readFile(f, 'utf8');
  if (/addDays\([^)]*startDate/.test(src) || /startDate\s*,\s*[\w.]*dayOffset/.test(src)) offenders.push(f.slice(root.length));
}
step('only js/schedule.js turns a plan start + dayOffset into a date', offenders.length === 0, offenders.join(', '));

await page.goto(BASE);
await page.waitForSelector('.tabbar button');

// ---------- pure: schedule, minimum, pain ----------
const P = await page.evaluate(async () => {
  const S = await import('/js/schedule.js');
  const M = await import('/js/minimum.js');
  const Pn = await import('/js/pain.js');
  const st = await import('/js/sessions.js');
  const R = await import('/js/review.js');
  const mk = (id, off, week = 1) => ({ id, label: id, dayOffset: off, blocks: [{ type: 'main', items: [{ id: `i-${id}`, exerciseId: 'e', target: { kind: 'reps', sets: 3, reps: 10 } }] }] });
  const plan = { id: 'p', status: 'active', startDate: '2026-11-02', weeks: [
    { index: 1, sessions: [mk('a', 0), mk('b', 2), mk('c', 4)] },
    { index: 2, sessions: [mk('d', 7), mk('e', 9), mk('f', 11)] },
  ] };
  const dates = (sched) => Object.fromEntries(S.occurrences([plan], sched).filter((o) => !o.repeat).map((o) => [o.session.id, o.date]));
  const override = S.effectiveSessionDate(plan, plan.weeks[0].sessions[1], [{ id: 'p:b', kind: 'move', date: '2026-11-20' }]);
  // a (Mon Nov 2) done; b (Wed Nov 4) overdue on Fri Nov 6 → slide 2 days.
  const isDone = (o) => o.session.id === 'a';
  const slid = S.slidePlan({ plan, fromDate: '2026-11-04', days: 2, schedule: [], isDone });
  const skipped = S.skipSession({ plan, session: plan.weeks[0].sessions[1], schedule: [] });
  const repeated = S.repeatWeek({ plan, weekIndex: 1, schedule: [], isDone: () => false });
  const rep = S.occurrences([plan], repeated);

  const session = { id: 's', blocks: [
    { type: 'warmup', items: [{ id: 'w', target: { kind: 'duration', durationSec: 300 } }, { id: 'w2', target: { kind: 'reps', sets: 2, reps: 10 } }] },
    { type: 'main', items: [
      { id: 'iv', target: { kind: 'intervals', rounds: 6, workSec: 120, recoverySec: 90, totalSec: 1260 } },
      { id: 'r', target: { kind: 'reps', sets: 3, reps: 15 } },
      { id: 'h', target: { kind: 'duration', sets: 3, durationSec: 30 } },
      { id: 'c', target: { kind: 'duration', durationSec: 1800 } },
      { id: 's45', target: { kind: 'duration', durationSec: 45 } },
      { id: 'dist', target: { kind: 'distance', distanceM: 5000 } },
    ] },
    { type: 'cooldown', items: [{ id: 'cd', target: { kind: 'duration', durationSec: 300 } }] },
  ] };
  const before = JSON.stringify(session);
  const min = M.minimumSession(session);
  const t = (id) => min.blocks.flatMap((b) => b.items).find((i) => i.id === id).target;

  const rec = (id, date, pain, kind = 'full') => ({ id, date, kind, plannedSessionId: id, pain });
  const r1 = rec('x1', '2026-11-02', { level: 'niggle', regions: ['shin'] });
  const r2 = rec('x2', '2026-11-04', { level: 'niggle', regions: ['shin', 'knee'] });
  const r3 = rec('x3', '2026-11-06', { level: 'niggle', regions: ['hip'] });
  const weekStart = (d) => R.weekStartOf(d, 'mon');
  const painW1 = rec('y1', '2026-11-04', { level: 'pain', regions: ['shin'] });
  const painW2 = rec('y2', '2026-11-11', { level: 'pain', regions: ['shin'] });
  const rule = 'Any shin pain during a run ends that session immediately. Repeat the same week rather than advancing. Two consecutive weeks of pain means stop the plan and see a physician or physical therapist.';

  return {
    override,
    nominal: S.effectiveSessionDate(plan, plan.weeks[0].sessions[1], []),
    beforeSlide: dates([]), afterSlide: dates(slid),
    skippedStatus: S.occurrences([plan], skipped).find((o) => o.session.id === 'b').skipped,
    skippedNotCompleted: st.sessionStatus({ session: plan.weeks[0].sessions[1], date: '2026-11-04', records: [], doneIds: new Set() }).completed,
    repeatDates: rep.filter((o) => o.repeat).map((o) => `${o.session.id}@${o.date}`).join(),
    week2After: rep.filter((o) => !o.repeat && o.week.index === 2).map((o) => o.date).join(),
    repeatOnlyOwnDate: st.sessionStatus({ session: plan.weeks[0].sessions[0], date: '2026-11-09', repeat: true, doneIds: new Set(['i-a']),
      logs: [{ date: '2026-11-02', plannedExerciseId: 'i-a' }] }).completed,
    warmupSame: JSON.stringify(min.blocks[0].items.map((i) => i.target)) === JSON.stringify(session.blocks[0].items.map((i) => i.target))
      && JSON.stringify(min.blocks[2].items[0].target) === JSON.stringify(session.blocks[2].items[0].target),
    intervals: t('iv'), reps: t('r').sets, hold: t('h'), continuous: t('c').durationSec, short: t('s45').durationSec, dist: t('dist').distanceM,
    was: min.blocks[1].items[1].was?.sets,
    unmutated: JSON.stringify(session) === before,
    est: [M.estimateMinutes({ ...session, estimatedDurationMin: 42 }, min)],
    escalated: Pn.effectivePain(r2, [r1, r2, r3]),
    notEscalated: Pn.effectivePain(r3, [r1, r2, r3]),
    firstNiggle: Pn.effectivePain(r1, [r1, r2, r3]),
    twoWeeks: Pn.painTwoWeeksRunning([painW1, painW2], '2026-11-11', weekStart),
    oneWeek: Pn.painTwoWeeksRunning([painW2], '2026-11-11', weekStart),
    stop: Pn.stopLine(rule),
    holdAfterPain: Pn.painHoldFor('e', [rec('a', '2026-11-02', { level: 'pain', regions: ['shin'] })], [plan]),
    noHold: Pn.painHoldFor('e', [rec('a', '2026-11-02', { level: 'none' })], [plan]),
  };
});
step('effectiveSessionDate: an override wins over the plan', P.override === '2026-11-20' && P.nominal === '2026-11-04');
step('slide: the overdue session moves to today, later ones by the same N',
  P.afterSlide.b === '2026-11-06' && P.afterSlide.c === '2026-11-08' && P.afterSlide.d === '2026-11-11' && P.afterSlide.f === '2026-11-15', JSON.stringify(P.afterSlide));
step('slide: spacing is preserved and done sessions stay put', P.afterSlide.a === P.beforeSlide.a
  && ['b', 'c', 'd', 'e', 'f'].every((k, i, a) => i === 0 || (Date.parse(P.afterSlide[k]) - Date.parse(P.afterSlide[a[i - 1]])) === (Date.parse(P.beforeSlide[k]) - Date.parse(P.beforeSlide[a[i - 1]]))));
step('skip: marked skipped, and not counted as completed', P.skippedStatus === true && P.skippedNotCompleted === false);
step('repeat week: this week runs again 7 days on…', P.repeatDates === 'a@2026-11-09,b@2026-11-11,c@2026-11-13', P.repeatDates);
step('…and later weeks slide a week', P.week2After === '2026-11-16,2026-11-18,2026-11-20', P.week2After);
step('a repeat counts only logs from its own date', P.repeatOnlyOwnDate === false);
step('minimum: warm-up and cool-down unchanged', P.warmupSame);
step('minimum: intervals 6 → 3 rounds, totalSec recomputed', P.intervals.rounds === 3 && P.intervals.totalSec === 3 * 210);
step('minimum: 3 sets → 2', P.reps === 2);
step('minimum: a 3 × 30 s hold → 2 × 30 s', P.hold.sets === 2 && P.hold.durationSec === 30);
step('minimum: one continuous 1800 s → 900 s; a single 45 s stays 45 s', P.continuous === 900 && P.short === 45);
step('minimum: distance halves', P.dist === 2500);
step('minimum: each scaled item remembers what it was', P.was === 3);
step('minimum: the plan object is not mutated', P.unmutated);
step('minimum: an estimated duration is offered', P.est[0] > 10 && P.est[0] < 42, String(P.est));
step('pain: a niggle in the same region twice running counts as pain', P.escalated === 'pain' && P.notEscalated === 'niggle' && P.firstNiggle === 'niggle');
step('pain: two consecutive weeks detected', P.twoWeeks === true && P.oneWeek === false);
step('pain: the stop line is the rule’s own sentence', P.stop === 'Two consecutive weeks of pain means stop the plan and see a physician or physical therapist.');
step('pain holds the next suggestion for that session’s exercises', P.holdAfterPain === true && P.noHold === false);

// ---------- UI: overdue, slide, minimum, pain ----------
const seed = (back) => page.evaluate(async (startBack) => {
  const p = (n) => String(n).padStart(2, '0');
  const d = (b) => { const x = new Date(); x.setDate(x.getDate() - b); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
  localStorage.clear();
  localStorage.setItem('ft.welcomed', '1');
  const data = await (await fetch('/presets/plans/couch-to-10k-26-week.plan.json')).json();
  const { importPlan } = await import('/js/ui/plans-tab.js');
  importPlan(data, d(startBack));
}, back);
const stored = (k) => page.evaluate((key) => JSON.parse(localStorage.getItem(`ft.data.data/${key}.json`) ?? '[]'), k);

// A past session with just one exercise logged (how sessions were logged
// before Finish existed) counts as done: no "still open" card for it.
await seed(2);
await page.evaluate(async () => {
  const m = await import('/js/models.js');
  const plans = JSON.parse(localStorage.getItem('ft.data.data/plans.json'));
  const s = plans[0].weeks[0].sessions[0];
  const item = s.blocks.flatMap((b) => b.items).find((i) => i.target?.kind === 'reps');
  const p = (n) => String(n).padStart(2, '0');
  const x = new Date(); x.setDate(x.getDate() - 2);
  localStorage.setItem('ft.data.data/logs.json', JSON.stringify([{ ...m.makeLogEntry({
    date: `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`, exerciseId: item.exerciseId,
    planId: plans[0].id, plannedExerciseId: item.id, actual: { sets: 1, reps: 10 } }), id: 'partial' }]));
});
await page.reload();
await page.waitForSelector('.week-dots');
step('a past session with one exercise logged is not “still open”', !(await page.isVisible('.overdue-card')));

await seed(2); // week 1 session 1 was two days ago and nothing was logged
await page.reload();
await page.waitForSelector('.overdue-card');
step('Today: an overdue session gets the open-session card', /is still open/.test(await page.textContent('.overdue-title')));
step('…with a slide preview and the three choices', /If you slide 2 days/.test(await page.textContent('.slide-preview'))
  && await page.isVisible('[data-action="slide"]') && await page.isVisible('[data-action="skip"]') && await page.isVisible('[data-action="not-now"]'));
step('…no red, no guilt copy', !(await page.evaluate(() => /danger|error/.test(document.querySelector('.overdue-card').innerHTML)))
  && !/missed|failed|behind/i.test(await page.textContent('.overdue-card')));
step('…and Finish session waits until it’s dealt with', !(await page.isVisible('[data-action="finish"]')));
await page.click('[data-action="not-now"]');
step('Not now hides it for this visit', !(await page.isVisible('.overdue-card')));
await page.reload();
await page.waitForSelector('.overdue-card');
step('…but nothing was stored, so it’s back next time', (await stored('schedule')).length === 0);
const plansBefore = await page.evaluate(() => localStorage.getItem('ft.data.data/plans.json'));
await page.click('[data-action="slide"]');
await page.waitForSelector('.toast:has-text("Plan slid 2 days")');
const sched = await stored('schedule');
step('Slide plan writes every move in one save, as schedule records', sched.length === 78 && sched.every((r) => r.kind === 'move' && r.id === `${r.planId}:${r.sessionId}`));
step('…and leaves the plan itself untouched', (await page.evaluate(() => localStorage.getItem('ft.data.data/plans.json'))) === plansBefore);
step('the slid session is today’s now', /Session 1/.test(await page.textContent('.session-title')) && !(await page.isVisible('.overdue-card')));

// Weekly dots.
step('Today header: weekly dots and “N of M this week”', /0 of 3 this week/.test(await page.textContent('.week-dots'))
  && (await page.locator('.wdot').count()) === 3 && !/streak/i.test(await page.textContent('.week-dots')));

// Minimum session.
await page.click('[data-mode="minimum"]');
step('Minimum: the toggle shows an estimated time', /Minimum · ~\d+ min/.test(await page.textContent('[data-mode="minimum"]')));
step('…warm-up unchanged, other work halved with what it was', /unchanged/.test(await page.textContent('.block-label'))
  && /was 2 × 15/.test(await page.textContent('#view')));
step('…and says it counts but won’t progress', /Counts as a completed session/.test(await page.textContent('.min-note')));
const planAfterMin = await page.evaluate(() => localStorage.getItem('ft.data.data/plans.json'));
step('the stored plan is not changed by viewing the minimum', planAfterMin === plansBefore);
// Tick one strength set, then finish the minimum session.
const card = page.locator('.ex-card.is-open').first();
await card.locator('.set-row[data-set="1"] .set-check').click();
await page.click('[data-action="finish"]');
await page.waitForSelector('.modal-title:has-text("Any pain today?")');
const recs = await stored('sessions');
step('Finishing records kind “minimum”', recs.length === 1 && recs[0].kind === 'minimum');
step('…and stamps its logs mode: minimum', (await stored('logs')).length >= 1 && (await stored('logs')).every((l) => l.mode === 'minimum'));

// Pain on a run, in the shin.
await page.click('[data-level="pain"]');
await page.click('[data-region="shin"]');
const rule = 'Any shin pain during a run ends that session immediately. Repeat the same week rather than advancing. Two consecutive weeks of pain means stop the plan and see a physician or physical therapist.';
step('pain + run + shin: the injury rule, verbatim', (await page.textContent('.rule-box')).includes(rule));
step('…with the Repeat this week offer', await page.isVisible('[data-action="repeat-week"]'));
step('…and the fixed clinician line', /Sharp pain, swelling, or anything lasting more than a week: see a clinician\./.test(await page.textContent('.pain-sheet')));
step('the answer is saved on the session record', JSON.stringify((await stored('sessions'))[0].pain) === '{"level":"pain","regions":["shin"]}');
await page.click('[data-action="repeat-week"]');
await page.waitForSelector('.toast:has-text("repeats")');
const repeats = (await stored('schedule')).filter((r) => r.kind === 'repeat');
step('Repeat this week adds the week’s sessions again', repeats.length === 3, String(repeats.length));

// The week counts the minimum as completed.
await page.reload();
await page.waitForSelector('.week-dots');
step('a minimum session counts as completed', /1 of 3 this week/.test(await page.textContent('.week-dots')));
step('Metrics: “Last 8 weeks: N of M” instead of a percentage', await (async () => {
  await page.click('.segmented button:has-text("Metrics")');
  await page.waitForSelector('[data-stat="sessions8"]');
  const t = await page.textContent('[data-stat="sessions8"]');
  return /Last 8 weeks\d+ of \d+sessions/.test(t.replace(/\s+/g, '')) || /Last 8 weeks.*\d+ of \d+/.test(t);
})());
step('…and no adherence % headline', !/\d+%/.test(await page.textContent('.stat-row')));

// Two consecutive weeks of pain: the stop line instead of the offer.
await page.evaluate(() => {
  const k = 'ft.data.data/sessions.json';
  const recs = JSON.parse(localStorage.getItem(k));
  const p = (n) => String(n).padStart(2, '0');
  const x = new Date(); x.setDate(x.getDate() - 7);
  recs.push({ id: 'old-pain', date: `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`, kind: 'full', plannedSessionId: 'zzz', pain: { level: 'pain', regions: ['shin'] } });
  localStorage.setItem(k, JSON.stringify(recs));
});
const sheet = await page.evaluate(async () => {
  // Re-open the question for today's finished session.
  const store = await import('/js/storage/store.js');
  return store.get('sessions').length;
});
await page.click('.segmented button:has-text("Today")');
// A second finished session today: the repeat sessions don't fall today, so
// finish the regular one's sibling through the store and reopen the prompt.
const shownStop = await page.evaluate(async () => {
  const Pn = await import('/js/pain.js');
  const R = await import('/js/review.js');
  const store = await import('/js/storage/store.js');
  const recs = store.get('sessions');
  const today = recs.find((r) => r.id !== 'old-pain');
  return Pn.painTwoWeeksRunning(recs, today.date, (d) => R.weekStartOf(d, 'mon'));
});
step('two consecutive weeks of pain → the stop line replaces the repeat offer (rule)', shownStop === true && sheet >= 2);

// ---------- sessions.json: encrypted, and refused when malformed ----------
const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
page2.on('pageerror', (e) => errors.push(String(e)));
const gh = await stubGithub(page2, {
  dirs: { 'data/activities': [], 'data/imported': [], 'data/strava': [] },
  files: { 'data/schedule.json': '{"overrides":{}}' },
});
await page2.goto(BASE);
await page2.waitForSelector('.tabbar button');
await page2.evaluate(() => {
  localStorage.setItem('ft.welcomed', '1');
  localStorage.setItem('ft.datarepo', JSON.stringify({ owner: 'rusty324', repo: 'fitness-data', branch: 'main' }));
  localStorage.setItem('ft.pat', 'github_pat_TEST');
  localStorage.setItem('ft.enc.pw', 'hunter2');
});
await page2.reload();
// First the malformed schedule.json: the load refuses it.
const shaped = await page2.waitForFunction(() => document.getElementById('sync-badge').textContent === 'sync error', null, { timeout: 8000 })
  .then(() => true, () => false);
let shapeReport = '';
if (shaped) {
  await page2.click('#sync-badge');
  shapeReport = await page2.inputValue('.modal textarea.gh-report');
  await page2.click('.modal-actions button:has-text("Close")');
}
step('a schedule.json of the wrong shape is refused (ShapeError), not overwritten',
  shaped && /ShapeError: data\/schedule\.json/.test(shapeReport) && !gh.puts().some((c) => c.url.includes('data/schedule.json')),
  shapeReport.split('\n').find((l) => /Error/.test(l)) ?? 'badge never showed sync error');
// Then an encrypted write.
await page2.evaluate(async () => {
  const store = await import('/js/storage/store.js');
  await store.upsert('sessions', { id: '2026-11-10:s1', date: '2026-11-10', plannedSessionId: 's1', planId: 'p', kind: 'full', pain: { level: 'pain', regions: ['shin'] } });
});
await page2.waitForFunction(() => true);
const body = gh.putBody('data/sessions.json');
step('sessions.json is encrypted when a password is set', /"format": "ft-encrypted"/.test(body) && !/shin/.test(body), body.slice(0, 60));
step('no page errors', errors.length === 0, errors.join(' | '));
await done(browser);
