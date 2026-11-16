// Training Plans tab: v2 plan structure (weeks -> sessions -> blocks ->
// items), calendar view, and import/export in the fitness-tracker-plan v2
// schema.
//
// This file is the tab itself: mount and the view switch. The views and
// editors live in js/ui/plans/; the tab's mutable state is one object, S,
// in js/ui/plans/state.js. The exercise picker/editor and plan import/export
// are shared with the Logs and Library tabs and are re-exported from here.

import * as store from '../storage/store.js';
import { el } from './components.js';
import { currentPlan, renderOverview } from './plans/overview.js';
import { isDesktop } from './layout.js';
import { renderPlanDetail, renderPlanList } from './plans/list.js';
import { renderCalendar } from './plans/calendar.js';
import { S } from './plans/state.js';
export { targetSummary } from './plans/session-editor.js';
export { pickExercise, editExercise } from './plans/exercise-editor.js';
export { exerciseDef, serializePlan, importPlan, libraryUpserter } from './plans/plan-io.js';

export function mount(elRoot) {
  S.root = elRoot;
  S.unsub = store.onChange((e) => {
    if (e.type === 'changed') render();
  });
  render();
}

export function unmount() {
  S.unsub?.();
  S.root = null;
}

export function render() {
  if (!S.root) return;
  S.root.innerHTML = '';
  S.root.appendChild(el('div', { class: 'segmented' },
    segBtn('Plans', S.view.name !== 'calendar', () => { S.view = { name: 'overview' }; render(); }),
    segBtn('Calendar', S.view.name === 'calendar', () => { S.view = { name: 'calendar' }; render(); }),
  ));
  const current = S.view.name === 'overview' ? currentPlan() : null;
  S.root.classList.toggle('wide', isDesktop() && !!current);
  if (S.view.name === 'plan') renderPlanDetail(S.view.planId);
  else if (S.view.name === 'calendar') renderCalendar();
  else if (current) renderOverview(current);
  else renderPlanList();
}

function segBtn(label, active, onclick) {
  return el('button', { class: active ? 'active' : '', onclick }, label);
}

// ---------- Import / export (fitness-tracker-plan v2 schema) ----------

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'exercise';
