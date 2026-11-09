// js/load.js and the interval change in js/rwi.js, as pure functions: the
// golden values from the load-metrics spec. Page-level behaviour is in
// app-load-metrics.mjs.
import { BASE, chromium, reporter } from './lib.mjs';

const { step, done } = reporter();
const browser = await (await chromium()).launch();
const page = await browser.newPage();
await page.goto(BASE);
await page.waitForSelector('.tabbar button');

const r = await page.evaluate(async () => {
  const L = await import('/js/load.js');
  const { rwiWork } = await import('/js/rwi.js');
  const bench = { name: 'Bench', modality: 'barbell', loadModel: 'e1rm' };
  const db = { name: 'Curl', modality: 'dumbbell', loadModel: 'erm_ref' };
  const pull = {
    name: 'Pull-Up', modality: 'bodyweight', loadModel: 'bw_e1rm',
    variants: [{ level: 1, name: 'Band', bodyweightFraction: null }, { level: 2, name: 'Full', bodyweightFraction: 1.0 }],
  };
  const push = { name: 'Push-Up', modality: 'bodyweight', loadModel: 'bw_e1rm', bodyweightFraction: 0.64 };
  const log = (actual, extra = {}) => ({ actual, ...extra });
  const sv = (args) => L.sessionLoadValue(args);
  return {
    e1: L.ermRef(100, 5, 1, 10),
    e1identity: [37.5, 100, 212].every((w) => L.ermRef(w, 1, 1, 10) === w),
    ref: L.ermRef(25, 12, 10, 15),
    round: L.ermRef(L.ermRef(100, 8, 1, 10), 1, 8, 15),
    cap11: L.ermRef(100, 11, 1, 10),
    cap16: L.ermRef(100, 16, 10, 15),
    cap13: L.ermRef(100, 13, 5, 12),
    badReps: [0, -1, 2.5, NaN].map((x) => L.ermRef(100, x, 1, 10)),
    noDiv: L.ermRef(100, 37, 1, 40),
    weff: L.effectiveLoadKg({ exercise: pull, variantFraction: 1.0, bodyKg: 80, addedKg: 10 }),
    pull5: sv({ exercise: pull, log: log({ sets: 1, reps: 5, weight: 10 }, { }), bodyKgOnDay: 80, variantFraction: 1.0 }),
    pull4: sv({ exercise: pull, log: log({ sets: 1, reps: 4, weight: 10 }), bodyKgOnDay: 80, variantFraction: 1.0 }),
    pushWeff: L.effectiveLoadKg({ exercise: push, variantFraction: 0.64, bodyKg: 80, addedKg: 0 }),
    push8: sv({ exercise: push, log: log({ sets: 1, reps: 8 }), bodyKgOnDay: 80, variantFraction: 0.64 }),
    push13: sv({ exercise: push, log: log({ sets: 1, reps: 13 }), bodyKgOnDay: 80, variantFraction: 0.64 }),
    push13why: L.setValues({ exercise: push, log: log({ sets: 1, reps: 13 }), bodyKgOnDay: 80, variantFraction: 0.64 }).reason,
    noBw: sv({ exercise: push, log: log({ sets: 1, reps: 8 }), bodyKgOnDay: null, variantFraction: 0.64 }),
    scaled: sv({ exercise: bench, log: log({ sets: 1, reps: 5, weight: 100 }), bodyKgOnDay: 80, goalKg: 75, scale: true }),
    scaleNoGoal: sv({ exercise: bench, log: log({ sets: 1, reps: 5, weight: 100 }), bodyKgOnDay: 80, goalKg: null, scale: true }),
    scaleNoBw: sv({ exercise: bench, log: log({ sets: 1, reps: 5, weight: 100 }), bodyKgOnDay: null, goalKg: 75, scale: true }),
    perSet: sv({ exercise: bench, log: log({ sets: 3, setReps: [5, 5, 8], setWeights: [100, 100, 80] }) }),
    nullSkipped: sv({ exercise: bench, log: log({ sets: 3, setReps: [5, 5, 3], setWeights: [null, 90, null] }) }),
    zeroOnBarbell: sv({ exercise: bench, log: log({ sets: 1, reps: 5, weight: 0 }) }),
    noWeightWhy: L.setValues({ exercise: bench, log: log({ sets: 1, reps: 5 }) }).reason,
    dbRef: sv({ exercise: db, log: log({ sets: 1, reps: 12, weight: 25 }) }),
    // inference for records with no loadModel
    infer: [
      L.loadModelOf({ modality: 'barbell' }),
      L.loadModelOf({ modality: 'dumbbell', name: 'Goblet Squat' }),
      L.loadModelOf({ modality: 'machine', name: 'Leg Extension' }),
      L.loadModelOf({ modality: 'bodyweight', variants: [{ level: 1, bodyweightFraction: 0.5 }] }),
      L.loadModelOf({ modality: 'bodyweight', bodyweightFraction: 0.7 }),
      L.loadModelOf({ modality: 'bodyweight', variants: [{ level: 1 }] }),
      L.loadModelOf({ modality: 'run', category: 'cardio' }),
      L.loadModelOf({ modality: 'other', category: 'strength', measurementType: 'duration' }),
      L.loadModelOf({ modality: 'band', loadModel: 'reps' }),
    ].join(),
    rRefCompound: L.modelParams({ modality: 'dumbbell', name: 'Dumbbell Row' }).rRef,
    rRefIsolation: L.modelParams({ modality: 'dumbbell', name: 'Biceps Curl' }).rRef,
    rRefOwn: L.modelParams({ modality: 'dumbbell', loadModel: 'erm_ref', referenceReps: 6, name: 'Curl' }).rRef,
    // variant resolution
    frac: (() => {
      const plans = [{ weeks: [{ index: 1, sessions: [{ dayOffset: 0, blocks: [{ items: [{ id: 'pi', exerciseId: 'x', target: { kind: 'reps', variantLevel: 2 } }] }] }] }] }];
      return [
        L.fractionFor(pull, { actual: { variantLevel: 1 }, plannedExerciseId: 'pi' }, plans), // own level wins: band → null
        L.fractionFor(pull, { actual: {}, plannedExerciseId: 'pi' }, plans), // from the plan item
        L.fractionFor(push, { actual: {} }, plans), // exercise-level
        L.fractionFor({ variants: [] }, { actual: {} }, plans), // nothing
      ];
    })(),
    // intervals RWI
    intervals: rwiWork({ movingSec: 1680 }, { kind: 'intervals', rounds: 2, workSec: 720 }),
    intervalsWithDistance: rwiWork({ movingSec: 1680, distanceM: 4000 }, { kind: 'intervals', rounds: 2, workSec: 720 }),
    adhocRun: rwiWork({ movingSec: 1680, distanceM: 4000 }),
    adhocTime: rwiWork({ movingSec: 1680 }),
  };
});

const near = (a, b, e = 0.01) => a != null && Math.abs(a - b) < e;
step('ermRef(100, 5, 1, 10) = 112.5', r.e1 === 112.5, r.e1);
step('ermRef(w, 1, 1, 10) = w', r.e1identity);
step('ermRef(25, 12, 10, 15) = 27', near(r.ref, 27), r.ref);
step('projecting to 8RM and back round-trips', near(r.round, 100), r.round);
step('caps: 11 reps on e1rm, 16 on erm_ref, 13 on bw_e1rm → null', r.cap11 === null && r.cap16 === null && r.cap13 === null);
step('non-integer, zero or negative reps → null', r.badReps.every((x) => x === null));
step('never divides by 37 − r ≤ 0', r.noDiv === null);
step('pull-up f=1.0 at 80 kg + 10 kg: w_eff 90', r.weff === 90);
step('… × 5 reps → 90', near(r.pull5?.value, 90), r.pull5?.value);
step('… × 4 reps → 87.27', near(r.pull4?.value, 87.27), r.pull4?.value);
step('floor push-up f=0.64 at 80 kg: w_eff 51.2', near(r.pushWeff, 51.2));
step('… × 8 reps → 56.5', near(r.push8?.value, 56.5, 0.01), r.push8?.value);
step('13 push-ups is over the 12-rep cap → null, reason overCap', r.push13 === null && r.push13why === 'overCap');
step('bodyweight model with no weigh-in → null', r.noBw === null);
step('goal scaling multiplies by 75/80', near(r.scaled.value, 112.5 * 0.9375) && r.scaled.detail.scaled && r.scaled.detail.unscaled === 112.5);
step('no goal or no body weight: unscaled, flagged', r.scaleNoGoal.value === 112.5 && r.scaleNoGoal.detail.scaleUnavailable
  && r.scaleNoBw.value === 112.5 && r.scaleNoBw.detail.scaleUnavailable);
step('per set: the best set wins (5 @ 100)', r.perSet.value === 112.5 && r.perSet.detail.reps === 5 && r.perSet.detail.loadKg === 100);
step('sets with no recorded weight are skipped', near(r.nullSkipped?.value, 90 * 36 / 32) && r.nullSkipped.detail.loadKg === 90);
step('0 kg on a barbell lift is not a set to score', r.zeroOnBarbell === null && r.noWeightWhy === 'noWeight');
step('erm_ref reports at its reference reps', near(r.dbRef.value, 27));
step('inference for old records', r.infer === 'e1rm,erm_ref,erm_ref,bw_e1rm,bw_e1rm,reps,cardio,duration,reps', r.infer);
step('inferred dumbbell compounds report an 8-rep max, isolation 10, own referenceReps wins',
  r.rRefCompound === 8 && r.rRefIsolation === 10 && r.rRefOwn === 6);
step('variant: the log’s level, else the plan item’s, else the exercise’s, else null',
  JSON.stringify(r.frac) === '[null,1,0.64,null]', JSON.stringify(r.frac));
step('intervals: work is running seconds (2 × 720 = 1440)', r.intervals.basis === 'run time' && r.intervals.perSet[0] === 1440);
step('… even when a distance was logged', r.intervalsWithDistance.basis === 'run time');
step('ad-hoc runs keep km × km/h or seconds', r.adhocRun.basis === 'distance' && r.adhocTime.basis === 'time' && r.adhocTime.perSet[0] === 1680);

await done(browser);
