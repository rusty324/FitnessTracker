// Bugs found in the November 2026 review, each pinned here.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage({ viewport: { width: 390, height: 820 } });
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

const r = await page.evaluate(async () => {
  const U = await import('/js/units.js');
  const D = await import('/js/dates.js');
  const St = await import('/js/sets.js');
  const C = await import('/js/cardio.js');
  const S = await import('/js/schedule.js');
  const P = await import('/js/progression.js');
  const Dr = await import('/js/draft.js');

  const mk = (id, off) => ({ id, dayOffset: off, blocks: [] });
  const plan = { id: 'p', status: 'active', startDate: '2026-11-02', weeks: [
    { index: 0, sessions: [mk('a', 0)] }, { index: 1, sessions: [mk('b', 7)] }] };
  const show = (sc) => S.occurrences([plan], sc).map((o) => `${o.session.id}${o.repeat ? 'R' : ''}@${o.date.slice(5)}`).join(' ');
  const once = S.repeatWeek({ plan, weekIndex: 0, schedule: [] });
  const twice = S.repeatWeek({ plan, weekIndex: 0, schedule: once });
  const slid = S.slidePlan({ plan, fromDate: '2026-11-09', days: 3, schedule: once });

  // A run matched to a Polar activity in week 1; the week is repeated and the
  // repeat's run is logged by hand against the same plan item.
  const exercises = [{ id: 'run', name: 'Run', category: 'cardio', modality: 'run' }];
  const activities = [{ id: 'polar-1', date: '2026-11-02', type: 'RUNNING', distanceM: 5000 }];
  const matches = [{ activityId: 'polar-1', plannedExerciseId: 'i1', status: 'confirmed' }];
  const log = (id, date) => ({ id, date, exerciseId: 'run', plannedExerciseId: 'i1', actual: { distanceM: 5000, movingSec: 1800 } });
  const items = C.cardioItems({ logs: [log('same', '2026-11-02'), log('repeat', '2026-11-09')], activities, exercises, matches });

  // A ladder with gaps: levels 1, 3, 6.
  const ex = { id: 'pu', measurementType: 'reps', modality: 'bodyweight', variants: [{ level: 1, name: 'Wall' }, { level: 3, name: 'Knee' }, { level: 6, name: 'Full' }] };
  const sess = (date, reps) => ({ date, variantLevel: 3, mode: 'full', sets: [{ reps, weightKg: null }, { reps, weightKg: null }] });
  const target = { kind: 'reps', sets: 2, repsMin: 8, repsMax: 12, variantLevel: 3 };
  const up = P.suggestNext({ exercise: ex, plannedTarget: target, history: [sess('2026-11-10', 12), sess('2026-11-08', 12), sess('2026-11-06', 12), sess('2026-11-04', 12)], today: '2026-11-12' });
  const down = P.suggestNext({ exercise: ex, plannedTarget: target, history: [sess('2026-11-10', 5), sess('2026-11-08', 5)], today: '2026-11-12' });

  // A draft that already made a log; the log is then deleted.
  const key = Dr.draftKey('2026-11-15', 's1');
  Dr.updateDraftItem(key, 'i1', { exerciseId: 'run', rows: [{ reps: 10, done: true }], logId: 'log-1' });
  Dr.updateDraftItem(key, 'i2', { exerciseId: 'run', rows: [{ reps: 10, done: true }], logId: 'log-2' });
  Dr.forgetLog('log-1');
  const left = Object.keys(Dr.readDraft(key).items);
  Dr.clearDraft(key);

  return {
    pace: U.formatPace(5000, 1798), dur: D.formatDuration(359.6), hold: St.holdText(119.7), hms: C.formatHms(3599.6),
    plain: [U.formatPace(5000, 1500), D.formatDuration(90), St.holdText(20), St.holdText(90), C.formatHms(2730)].join(' '),
    once: show(once), twice: show(twice), slid: show(slid),
    counted: items.map((i) => i.ref.id).sort().join(','),
    up: up && `${up.kind}:${up.variantLevel}`, down: down && `${down.kind}:${down.variantLevel}`,
    left: left.join(','),
  };
});

step('pace never reads :60', r.pace === '6:00/km', r.pace);
step('nor a duration', r.dur === '6m', r.dur);
step('nor a hold', r.hold === '2:00', r.hold);
step('nor h:mm:ss', r.hms === '1:00:00', r.hms);
step('ordinary values are unchanged', r.plain === '5:00/km 1m 30s 20s 1:30 45:30', r.plain);
step('repeating a week adds its sessions a week later', r.once === 'a@11-02 aR@11-09 b@11-16', r.once);
step('repeating it again fills the week that frees up', r.twice === 'a@11-02 aR@11-09 aR@11-16 b@11-23', r.twice);
step('sliding the plan carries repeat sessions along', r.slid === 'a@11-02 aR@11-12 b@11-19', r.slid);
step('a run logged by hand in a repeated week still counts', r.counted === 'polar-1,repeat', r.counted);
step('advancing on a ladder with gaps goes to the next rung that exists', r.up === 'advance:6', r.up);
step('and stepping back goes to the one below', r.down === 'regress:1', r.down);
step('deleting a log drops the draft that would rewrite it', r.left === 'i2', r.left);
await done(browser);
