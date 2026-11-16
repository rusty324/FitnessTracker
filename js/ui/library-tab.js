// Fitness Library tab: the exercise library (with full v2 detail — cues,
// safety notes, variants — and per-set RWI history), training Goals
// (bodyweight, run times, exercise targets), and Gear (js/ui/gear-view.js).
//
// RWI (Relative Work Index) normalizes work against your goal weight:
// RWI = work × (goal weight / body weight at the time). Work is reps, or
// km × km/h for distance, or seconds for a hold — see js/rwi.js.
//
// This file is the tab itself: mount, routing and the view switch. The
// views live in js/ui/library/; the tab's mutable state is one object, S,
// in js/ui/library/state.js.

import * as store from '../storage/store.js';
import { el } from './components.js';
import { renderGoals } from './library/goals.js';
import { renderGear } from './gear-view.js';
import { renderExerciseDetail } from './library/exercise-detail.js';
import { renderExerciseList } from './library/exercise-list.js';
import { S } from './library/state.js';

export function mount(elRoot, ctx, path = '') {
  S.root = elRoot;
  // Opened on #/library/exercise/<id>: start there. Rendering the list first
  // rewrote the hash to #/library until route() put it back, and a reload in
  // that moment landed on the list.
  const m = /^exercise\/(.+)$/.exec(path);
  if (m) S.view = { name: 'exercise', id: decodeURIComponent(m[1]) };
  S.unsub = store.onChange((e) => {
    if (e.type === 'changed') render();
  });
  render();
}

// #/library/exercise/<id> opens that exercise (see tabbar.js). The bare
// #/library keeps whatever was open, as the tab always has.
export function route(path, { navigated = false } = {}) {
  const m = /^exercise\/(.+)$/.exec(path);
  if (m) {
    S.view = { name: 'exercise', id: decodeURIComponent(m[1]), linked: navigated };
    // Mounting rendered the previous view first, which clears a sub-path
    // from the hash; put it back (same history entry, so Back still works).
    history.replaceState(null, '', `#/library/exercise/${m[1]}`);
    render();
    scrollTo(0, 0);
  } else if (S.view.linked) {
    S.view = { ...S.view, linked: false };
    render();
  }
}
export function showExercise(id) {
  if (S.view.name === 'exercises') S.listScrollY = scrollY;
  S.view = { name: 'exercise', id };
  history.replaceState(null, '', `#/library/exercise/${encodeURIComponent(id)}`);
  render();
  scrollTo(0, 0);
}
export function showList() {
  S.view = { name: 'exercises' };
  render();
  scrollTo(0, S.listScrollY);
}

export function unmount() {
  S.unsub?.();
  S.root = null;
}

export function render() {
  if (!S.root) return;
  S.root.innerHTML = '';
  // Anything but an exercise page drops a leftover #/library/exercise/<id>,
  // so a reload doesn't reopen an exercise you've navigated away from.
  if (S.view.name !== 'exercise' && /^#\/library\/./.test(location.hash)) history.replaceState(null, '', '#/library');
  S.root.appendChild(el('div', { class: 'segmented' },
    el('button', {
      class: S.view.name === 'exercises' || S.view.name === 'exercise' ? 'active' : '',
      onclick: () => { S.view = { name: 'exercises' }; render(); },
    }, 'Exercises'),
    el('button', {
      class: S.view.name === 'goals' ? 'active' : '',
      onclick: () => { S.view = { name: 'goals' }; render(); },
    }, 'Goals'),
    el('button', {
      class: S.view.name === 'gear' ? 'active' : '',
      onclick: () => { S.view = { name: 'gear' }; render(); },
    }, 'Gear'),
  ));
  if (S.view.name === 'goals') renderGoals();
  else if (S.view.name === 'gear') renderGear(S.root);
  else if (S.view.name === 'exercise') renderExerciseDetail(S.view.id);
  else renderExerciseList();
}
