// Sets × reps entry with a box per set, so a set that came up short can say
// so: 5 sets planned at 20 can be logged as 20, 20, 20, 15, 12.
//
// "Reps (every set)" fills every box; Sets adds or removes boxes; editing a
// box records just that set. A blank box is a set that wasn't done.

import { repsPerSet, setFields } from '../sets.js';
import { el } from './components.js';

const MAX_SETS = 30;

export function setsForm(actual = {}, target = {}) {
  const logged = repsPerSet(actual);
  const range = target.repsMin != null && target.repsMax != null ? `${target.repsMin}–${target.repsMax}` : '';
  // An existing entry starts from what it holds (including sets logged with
  // no reps); a new one from the plan target, if any.
  const isNew = !Object.keys(actual).length;
  const start = logged.length ? logged
    : Array(Math.min(MAX_SETS, actual.sets ?? (isNew ? target.sets ?? (target.reps != null ? 1 : 0) : 0)))
      .fill(isNew ? target.reps ?? null : null);

  const numInput = (attrs) => el('input', { type: 'number', inputmode: 'numeric', step: 1, min: 0, ...attrs });
  const setsInput = numInput({ value: start.length || '', max: MAX_SETS, dataset: { name: 'sets' } });
  const repsAll = numInput({ dataset: { name: 'reps' } });
  const grid = el('div', { class: 'set-grid' });
  const boxes = [];
  const removed = []; // values of boxes removed by lowering Sets, restored if it goes back up

  const values = () => boxes.map((b) => b.value);
  // "Reps (every set)" shows the shared value, or says they vary.
  const syncAll = () => {
    const v = values();
    const same = v.length && v.every((x) => x !== '' && x === v[0]);
    repsAll.value = same ? v[0] : '';
    repsAll.placeholder = same || v.every((x) => x === '') ? range : 'varies';
  };
  const addBox = (value) => {
    const n = boxes.length + 1;
    const input = numInput({ value: value ?? '', placeholder: range, 'aria-label': `Set ${n} reps`, dataset: { set: n } });
    input.addEventListener('input', syncAll);
    boxes.push(input);
    grid.append(el('label', { class: 'set-box' }, el('span', {}, `Set ${n}`), input));
  };
  const resize = (n) => {
    while (boxes.length > n) {
      removed.push(boxes.pop().value);
      grid.lastElementChild.remove();
    }
    while (boxes.length < n) addBox(removed.length ? removed.pop() : repsAll.value || boxes.at(-1)?.value || '');
    syncAll();
  };

  for (const r of start) addBox(r);
  syncAll();

  repsAll.addEventListener('input', () => {
    for (const b of boxes) b.value = repsAll.value;
    repsAll.placeholder = range;
  });
  // A half-typed Sets value (cleared to retype) doesn't remove anything.
  setsInput.addEventListener('input', () => {
    const n = parseInt(setsInput.value, 10);
    if (Number.isFinite(n) && n >= 0) resize(Math.min(MAX_SETS, n));
  });

  const read = () => {
    const filled = values().filter((v) => v !== '').map(Number);
    if (filled.some((r) => !Number.isInteger(r) || r < 0)) return { error: 'Reps should be whole numbers' };
    if (filled.length) return { values: setFields(filled) };
    // Sets with no reps recorded, as the form always allowed.
    const n = parseInt(setsInput.value, 10);
    return { values: Number.isFinite(n) ? { sets: n } : {} };
  };

  return { sets: setsInput, reps: repsAll, grid, read };
}
