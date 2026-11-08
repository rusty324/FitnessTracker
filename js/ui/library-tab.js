// Fitness Library tab: the exercise library (with full v2 detail — cues,
// safety notes, variants — and per-set RWI history), training Goals
// (bodyweight, run times, exercise targets), and Gear (js/ui/gear-view.js).
//
// RWI (Relative Work Index) normalizes bodyweight work against your goal
// weight: RWI = (reps, or duration in seconds) × (goal weight / body weight
// at the time of the set). As you approach your goal weight the ratio → 1.

import * as store from '../storage/store.js';
import { makeGoal, exerciseUsage, remapExercise } from '../models.js';
import { RUN_GOAL_PRESETS, MUSCLE_GROUPS, WEIGHT_TYPES, POSITIONS } from '../config.js';
import {
  matchesFilters, muscleGroupsOf, weightTypesOf, positionsOf, isFiltering, NOT_SET,
} from '../exercise-filters.js';
import { todayStr, formatDate, formatDuration } from '../dates.js';
import {
  formatWeight, formatDistance, formatPace, weightUnit, weightToInput, weightFromInput,
  distanceToInput, distanceFromInput, distanceUnit,
} from '../units.js';
import { el, openModal, confirmDialog, toast, emptyState, downloadJson, filePicker } from './components.js';
import { loadManifest, loadPreset } from '../presets.js';
import { editExercise, pickExercise, targetSummary, libraryUpserter, exerciseDef, slug } from './plans-tab.js';
import { renderGear } from './gear-view.js';

let root = null;
let unsub = null;
// {name:'exercises'} | {name:'exercise', id, linked} | {name:'goals'} | {name:'gear'}
// `linked`: opened from a link elsewhere in the app, so "Back" returns there.
let view = { name: 'exercises' };

export function mount(elRoot) {
  root = elRoot;
  unsub = store.onChange((e) => {
    if (e.type === 'changed') render();
  });
  render();
}

// #/library/exercise/<id> opens that exercise (see tabbar.js). The bare
// #/library keeps whatever was open, as the tab always has.
export function route(path, { navigated = false } = {}) {
  const m = /^exercise\/(.+)$/.exec(path);
  if (m) {
    view = { name: 'exercise', id: decodeURIComponent(m[1]), linked: navigated };
    // Mounting rendered the previous view first, which clears a sub-path
    // from the hash; put it back (same history entry, so Back still works).
    history.replaceState(null, '', `#/library/exercise/${m[1]}`);
    render();
  } else if (view.linked) {
    view = { ...view, linked: false };
    render();
  }
}

// In-tab navigation keeps the hash in step without adding history entries,
// so a reload lands in the same place and Back skips the in-tab steps.
function showExercise(id) {
  view = { name: 'exercise', id };
  history.replaceState(null, '', `#/library/exercise/${encodeURIComponent(id)}`);
  render();
}
function showList() {
  view = { name: 'exercises' };
  render();
}

export function unmount() {
  unsub?.();
  root = null;
}

function render() {
  if (!root) return;
  root.innerHTML = '';
  // Anything but an exercise page drops a leftover #/library/exercise/<id>,
  // so a reload doesn't reopen an exercise you've navigated away from.
  if (view.name !== 'exercise' && /^#\/library\/./.test(location.hash)) history.replaceState(null, '', '#/library');
  root.appendChild(el('div', { class: 'segmented' },
    el('button', {
      class: view.name === 'exercises' || view.name === 'exercise' ? 'active' : '',
      onclick: () => { view = { name: 'exercises' }; render(); },
    }, 'Exercises'),
    el('button', {
      class: view.name === 'goals' ? 'active' : '',
      onclick: () => { view = { name: 'goals' }; render(); },
    }, 'Goals'),
    el('button', {
      class: view.name === 'gear' ? 'active' : '',
      onclick: () => { view = { name: 'gear' }; render(); },
    }, 'Gear'),
  ));
  if (view.name === 'goals') renderGoals();
  else if (view.name === 'gear') renderGear(root);
  else if (view.name === 'exercise') renderExerciseDetail(view.id);
  else renderExerciseList();
}

// ---------- Exercise list ----------

// Search + filters survive re-renders and opening an exercise, so "Back"
// returns to the same filtered list.
let filters = { query: '', muscle: '', weight: '', position: '' };

const labelOf = (list, id, short = false) => {
  const item = list.find((x) => x.id === id);
  return (short ? item?.short : null) ?? item?.label ?? id;
};

// "Strength · Chest, Arms · Barbell · Lying" — what the filters see.
function describeExercise(ex) {
  const groups = muscleGroupsOf(ex).map((id) => labelOf(MUSCLE_GROUPS, id)).join(', ');
  const weights = weightTypesOf(ex).map((id) => labelOf(WEIGHT_TYPES, id, true)).join(' / ');
  const positions = positionsOf(ex).map((id) => labelOf(POSITIONS, id, true)).join(' / ');
  const category = ex.category ? ex.category[0].toUpperCase() + ex.category.slice(1) : '';
  return [category, groups, weights, positions].filter(Boolean).join(' · ');
}

function renderExerciseList() {
  const lib = store.get('exercises');
  root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'Exercise library'),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => importExercisesModal() }, 'Import'),
      el('button', { class: 'btn small secondary', onclick: () => exportLibrary() }, 'Export'),
      el('button', { class: 'btn small', onclick: () => editExercise(null, () => render()) }, '+ New'),
    ),
  ));
  if (!lib.length) {
    root.appendChild(emptyState('No exercises yet. They’re also created automatically when importing plans.'));
    return;
  }
  fillMissingFromPresets();

  const byName = (a, b) => a.name.localeCompare(b.name);
  const active = lib.filter((e) => !e.archived).sort(byName);
  const archived = lib.filter((e) => e.archived).sort(byName);

  // A filter menu: "All muscles", then each option with how many
  // (non-archived) exercises it matches, then "Not set" for gaps to fill in.
  const menu = (key, label, anyLabel, options, valuesOf) => {
    const count = (id) => active.filter((ex) => (id === NOT_SET ? valuesOf(ex).length === 0 : valuesOf(ex).includes(id))).length;
    const opt = (value, text, n) => el('option', {
      value, selected: filters[key] === value, disabled: n === 0 && filters[key] !== value,
    }, `${text} (${n})`);
    return el('select', {
      'aria-label': label,
      dataset: { filter: key },
      onchange: (e) => { filters[key] = e.target.value; update(); },
    },
      el('option', { value: '', selected: !filters[key] }, anyLabel),
      options.map((o) => opt(o.id, o.label, count(o.id))),
      opt(NOT_SET, 'Not set', count(NOT_SET)),
    );
  };
  const search = el('input', {
    type: 'search', value: filters.query, placeholder: 'Search name, muscle, equipment…',
    'aria-label': 'Search exercises', dataset: { filter: 'query' },
  });
  search.addEventListener('input', () => { filters.query = search.value; update(); });
  const selects = [
    menu('muscle', 'Muscle group', 'All muscles', MUSCLE_GROUPS, muscleGroupsOf),
    menu('weight', 'Weights', 'All weights', WEIGHT_TYPES, weightTypesOf),
    menu('position', 'Position', 'All positions', POSITIONS, positionsOf),
  ];
  // Only weights can't be "not set": an exercise needing none is bodyweight.
  selects[1].querySelector(`option[value="${NOT_SET}"]`).remove();

  const summary = el('div', { class: 'filter-summary' });
  const listEl = el('div', {});
  root.append(el('div', { class: 'filter-bar' }, search, el('div', { class: 'filter-row' }, selects)), summary, listEl);

  const row = (ex) => el('div', { class: 'list-row tappable', onclick: () => showExercise(ex.id) },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, ex.name),
      el('div', { class: 'row-sub' }, describeExercise(ex) || `${ex.category} · ${ex.modality}`),
    ),
    el('span', { class: 'pill' }, String(logCountFor(ex.id)) + ' logs'),
  );

  // Only the list redraws as you type, so the search box keeps focus.
  function update() {
    const shown = active.filter((ex) => matchesFilters(ex, filters));
    const shownArchived = archived.filter((ex) => matchesFilters(ex, filters));
    listEl.innerHTML = '';
    summary.innerHTML = '';
    if (isFiltering(filters)) {
      summary.append(
        el('span', { class: 'muted' }, `${shown.length} of ${active.length} exercises`),
        el('button', {
          class: 'btn small secondary',
          onclick: () => { filters = { query: '', muscle: '', weight: '', position: '' }; render(); },
        }, 'Clear filters'),
      );
    }
    if (shown.length) listEl.appendChild(el('div', { class: 'card' }, shown.map(row)));
    else if (!active.length) listEl.appendChild(el('p', { class: 'muted' }, 'All exercises are archived.'));
    else listEl.appendChild(emptyState('No exercises match these filters.'));
    if (shownArchived.length) {
      listEl.appendChild(el('h3', { class: 'muted' }, 'Archived'));
      listEl.appendChild(el('div', { class: 'card' }, shownArchived.map(row)));
    }
  }
  update();
}

// Libraries imported before positions existed have none. Once per page load,
// fill empty fields of exercises that match a bundled pack or plan by name —
// the same enrichment an import does, but never adding exercises, never
// un-archiving, and never overwriting anything you've filled in.
let presetsFilled = false;
async function fillMissingFromPresets() {
  if (presetsFilled) return;
  presetsFilled = true;
  if (!store.get('exercises').some((ex) => !ex.positions?.length)) return;
  try {
    const manifest = await loadManifest();
    const up = libraryUpserter({ create: false });
    for (const file of [...(manifest.exercisePacks ?? []), ...(manifest.plans ?? [])].map((x) => x.file)) {
      const data = await loadPreset(file);
      for (const def of Object.values(data.exerciseLibrary ?? {})) if (def?.name) up.resolve(def);
    }
    up.commit();
    if (up.stats.enriched) {
      toast(`Filled in muscles, equipment and positions for ${up.stats.enriched} exercise${up.stats.enriched === 1 ? '' : 's'} from the starter packs`);
    }
  } catch {
    // Offline, or the presets moved: the filters work with what's there.
  }
}

function logCountFor(exerciseId) {
  return store.get('logs').filter((l) => l.exerciseId === exerciseId).length;
}

// ---------- Library import / export ----------

// Whole library as a schema-shaped exerciseLibrary map — definitions only,
// no log history. Round-trips through the Import button below.
function exportLibrary() {
  const lib = store.get('exercises');
  if (!lib.length) { toast('Library is empty — nothing to export', 'error'); return; }
  const exerciseLibrary = {};
  for (const ex of [...lib].sort((a, b) => a.name.localeCompare(b.name))) {
    let key = slug(ex.name);
    while (exerciseLibrary[key]) key += '_2';
    exerciseLibrary[key] = exerciseDef(ex);
  }
  downloadJson('exercise-library.json', {
    format: 'fitness-tracker-exercise-library',
    formatVersion: 2,
    exerciseLibrary,
  });
  toast(`Exported ${lib.length} exercise${lib.length === 1 ? '' : 's'}`);
}

// Accepts: a full v2 plan file (uses its exerciseLibrary), a bare
// exerciseLibrary map, an array of definitions, or a single definition.
function extractExerciseDefs(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (data.exerciseLibrary && typeof data.exerciseLibrary === 'object') {
      return Object.values(data.exerciseLibrary);
    }
    if (typeof data.name === 'string') return [data];
    const vals = Object.values(data);
    if (vals.length && vals.every((v) => v && typeof v === 'object' && typeof v.name === 'string')) {
      return vals;
    }
  }
  throw new Error('Expected an exerciseLibrary map, an exercise object, or an array of them');
}

function importExercisesModal() {
  const textarea = el('textarea', {
    placeholder: 'Paste exercise JSON here, or pick a file below…',
    style: 'min-height:140px;font-family:monospace;font-size:0.8rem',
  });
  const fileInput = filePicker({
    onchange: () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      f.text().then((t) => { textarea.value = t; }).catch(() => toast('Could not read file', 'error'));
    },
  });
  // Starter packs bundled with the site; tapping one imports it directly.
  const packList = el('div', {}, el('p', { class: 'muted' }, 'Loading starter packs…'));
  let modal;
  loadManifest().then((manifest) => {
    packList.innerHTML = '';
    for (const pack of manifest.exercisePacks ?? []) {
      packList.appendChild(el('div', { class: 'list-row tappable', onclick: async () => {
        try {
          const data = await loadPreset(pack.file);
          applyImport(data);
          modal.close();
        } catch (e) {
          toast(e.message, 'error');
        }
      } },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, pack.name),
          pack.description && el('div', { class: 'row-sub' }, pack.description),
        ),
        el('span', { class: 'pill' }, `${pack.count}`),
      ));
    }
    if (!manifest.exercisePacks?.length) packList.appendChild(el('p', { class: 'muted' }, 'No starter packs available.'));
  }).catch(() => {
    packList.innerHTML = '';
    packList.appendChild(el('p', { class: 'muted' }, 'Starter packs unavailable offline.'));
  });

  // Shared by the preset rows and the paste/file route.
  function applyImport(data) {
    const defs = extractExerciseDefs(data);
    const lib = libraryUpserter();
    for (const def of defs) lib.resolve(def);
    lib.commit();
    const { created, enriched } = lib.stats;
    if (!created && !enriched) toast('Nothing new — all exercises already in the library');
    else toast(`Imported: ${created} new${enriched ? `, ${enriched} updated` : ''}`);
    render();
  }

  modal = openModal('Import exercises', el('div', {},
    el('h3', {}, 'Starter packs'),
    packList,
    el('h3', {}, 'Or paste your own'),
    el('div', { class: 'field' }, textarea),
    el('div', { class: 'field' }, el('label', {}, 'Or choose a file'), fileInput),
    el('p', { class: 'muted' },
      'Accepts an exerciseLibrary map (as in plan files), a whole plan file, a single exercise, ',
      'or an array of exercises. Matched by name; existing entries gain any missing detail fields, ',
      'and your own edits are never overwritten.'),
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Import',
      class: 'btn',
      onClick: () => {
        let data;
        try {
          data = JSON.parse(textarea.value);
        } catch {
          toast('That isn’t valid JSON', 'error');
          return false;
        }
        try {
          applyImport(data);
        } catch (e) {
          toast(e.message, 'error');
          return false;
        }
      },
    },
  ]);
}

// ---------- Exercise detail ----------

function renderExerciseDetail(id) {
  const ex = store.get('exercises').find((e) => e.id === id);
  if (!ex) { showList(); return; }

  root.appendChild(el('div', { class: 'list-row' },
    el('div', { class: 'row-main' },
      // Reached from a link (e.g. a planned exercise on the Logs page):
      // go back there. Otherwise, or after a reload, back to the list.
      view.linked
        ? el('button', { class: 'btn small secondary', onclick: () => history.back() }, '‹ Back')
        : el('button', { class: 'btn small secondary', onclick: () => showList() }, '‹ Library'),
    ),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => editExercise(ex, () => render()) }, 'Edit'),
      ex.archived
        ? el('button', {
            class: 'btn small secondary',
            onclick: () => {
              store.upsert('exercises', { ...ex, archived: false });
              toast('Restored to the library');
              render();
            },
          }, 'Unarchive')
        : el('button', { class: 'btn small danger', onclick: () => deleteExerciseFlow(ex) }, 'Delete'),
    ),
  ));

  root.appendChild(el('h2', {}, ex.name));
  root.appendChild(el('div', { style: 'margin-bottom:10px' },
    el('span', { class: 'pill accent' }, ex.category), ' ',
    el('span', { class: 'pill' }, ex.modality), ' ',
    el('span', { class: 'pill' }, ex.measurementType),
    ex.perSide ? [' ', el('span', { class: 'pill warn' }, 'per side')] : '',
    ex.archived ? [' ', el('span', { class: 'pill warn' }, 'archived')] : '',
  ));

  if (ex.description) root.appendChild(el('p', {}, ex.description));
  if (ex.whyItsHere) root.appendChild(el('p', { class: 'muted' }, `Why it’s here: ${ex.whyItsHere}`));
  if (ex.equipment?.length) root.appendChild(el('p', { class: 'muted' }, `Equipment: ${ex.equipment.join(', ')}`));
  if (ex.primaryTargets?.length) root.appendChild(el('p', { class: 'muted' }, `Targets: ${ex.primaryTargets.join(', ')}`));
  if (positionsOf(ex).length) {
    root.appendChild(el('p', { class: 'muted' }, `Position: ${positionsOf(ex).map((id) => labelOf(POSITIONS, id)).join(', ')}`));
  }

  if (ex.cues?.length) {
    root.appendChild(el('div', { class: 'card' },
      el('h3', {}, 'Cues'),
      el('ul', { style: 'margin:0;padding-left:18px' }, ex.cues.map((c) => el('li', {}, c))),
    ));
  }
  if (ex.safetyNotes?.length) {
    root.appendChild(el('div', { class: 'card', style: 'border-color:var(--danger)' },
      el('h3', {}, '⚠ Safety'),
      el('ul', { style: 'margin:0;padding-left:18px' }, ex.safetyNotes.map((c) => el('li', {}, c))),
    ));
  }
  if (ex.variants?.length) {
    const card = el('div', { class: 'card' }, el('h3', {}, 'Progression variants'));
    for (const v of [...ex.variants].sort((a, b) => a.level - b.level)) {
      card.appendChild(el('div', { class: 'list-row' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, `L${v.level} · ${v.name}`),
          v.description && el('div', { class: 'row-sub' }, v.description),
        ),
      ));
    }
    root.appendChild(card);
  }
  if (ex.progressionRule) root.appendChild(el('p', { class: 'muted' }, `Progression: ${ex.progressionRule}`));

  root.appendChild(rwiSection(ex));
}

// ---------- Deletion ----------

// Deleting an exercise that plans, logs, or goals still reference would
// leave dangling ids behind, so an in-use exercise offers safer routes
// first: repoint everything at a replacement, or archive it instead.
function deleteExerciseFlow(ex) {
  const usage = exerciseUsage(ex.id, store.get('plans'), store.get('logs'), store.get('goals'));

  if (!usage.any) {
    confirmDialog(`Delete “${ex.name}” from the library?`).then((ok) => {
      if (!ok) return;
      store.remove('exercises', ex.id);
      view = { name: 'exercises' };
      render();
    });
    return;
  }

  const parts = [];
  if (usage.planItems) {
    parts.push(`${usage.planItems} planned exercise${usage.planItems === 1 ? '' : 's'} in `
      + `${usage.planNames.length} plan${usage.planNames.length === 1 ? '' : 's'} (${usage.planNames.join(', ')})`);
  }
  if (usage.logs) parts.push(`${usage.logs} log entr${usage.logs === 1 ? 'y' : 'ies'}`);
  if (usage.goals) parts.push(`${usage.goals} goal${usage.goals === 1 ? '' : 's'}`);

  const option = (label, cls, description, onclick) => el('div', { style: 'margin-bottom:14px' },
    el('button', { class: `btn ${cls}`, style: 'width:100%', onclick }, label),
    el('p', { class: 'muted', style: 'margin:6px 0 0' }, description),
  );

  let modal;
  modal = openModal(`Delete “${ex.name}”?`, el('div', {},
    el('p', {}, 'Still used by ', el('b', {}, parts.join(', ')), '.'),
    option('Replace with another exercise…', '',
      'Pick a replacement — every plan, log, and goal switches over to it, then this one is deleted. Nothing is orphaned.',
      () => {
        modal.close();
        pickExercise((replacement) => {
          const next = remapExercise(ex.id, replacement.id, {
            plans: store.get('plans'),
            logs: store.get('logs'),
            goals: store.get('goals'),
          });
          store.save('plans', next.plans);
          store.save('logs', next.logs);
          store.save('goals', next.goals);
          store.remove('exercises', ex.id);
          toast(`Replaced with “${replacement.name}”`);
          view = { name: 'exercises' };
          render();
        }, {}, { excludeId: ex.id });
      }),
    option('Archive instead', 'secondary',
      'Hides it from exercise pickers but keeps every existing reference working. You can unarchive it later.',
      () => {
        modal.close();
        store.upsert('exercises', { ...ex, archived: true });
        toast(`“${ex.name}” archived`);
        view = { name: 'exercises' };
        render();
      }),
    option('Delete anyway', 'danger',
      'Plans and history keep the reference but show “Unknown exercise”, running charts drop those logs, '
      + 'and activity auto-matching stops suggesting it.',
      async () => {
        modal.close();
        if (!(await confirmDialog(`Permanently delete “${ex.name}” and leave ${parts.join(', ')} orphaned?`))) return;
        store.remove('exercises', ex.id);
        view = { name: 'exercises' };
        render();
      }),
  ), [{ label: 'Cancel', class: 'btn secondary', onClick: () => {} }]);
}

// ---------- RWI ----------

// Body weight in effect on a given date: the most recent weigh-in on or
// before it, else the earliest one after.
function weightOn(date, metrics) {
  const weighed = metrics.filter((m) => m.weight != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!weighed.length) return null;
  let candidate = null;
  for (const m of weighed) {
    if (m.date <= date) candidate = m;
    else break;
  }
  return (candidate ?? weighed[0]).weight;
}

function rwiSection(ex) {
  const wrap = el('div', {});
  wrap.appendChild(el('h3', {}, 'Relative Work Index'));

  const goal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
  const logs = store.get('logs')
    .filter((l) => l.exerciseId === ex.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 15);

  if (!goal) {
    wrap.appendChild(el('p', { class: 'muted' },
      'RWI needs a bodyweight goal: RWI = (reps or seconds per set) × (goal weight ÷ your weight at the time). ',
      'Add one under Goals.'));
    wrap.appendChild(el('button', { class: 'btn secondary small', onclick: () => { view = { name: 'goals' }; render(); } }, 'Go to Goals'));
    return wrap;
  }
  const metrics = store.get('metrics');
  const currentW = weightOn(todayStr(), metrics);
  if (currentW == null) {
    wrap.appendChild(el('p', { class: 'muted' }, 'RWI needs at least one logged body weight (Logs → Metrics).'));
    return wrap;
  }
  wrap.appendChild(el('p', { class: 'muted' },
    `Goal weight ${formatWeight(goal.targetWeight)} · current ${formatWeight(currentW)} · `,
    `ratio ${(goal.targetWeight / currentW).toFixed(3)}. `,
    'RWI = set reps (or seconds) × goal ÷ bodyweight on the day.'));

  if (!logs.length) {
    wrap.appendChild(el('p', { class: 'muted' }, 'No logged sets for this exercise yet.'));
    return wrap;
  }
  const card = el('div', { class: 'card' });
  for (const log of logs) {
    const w = weightOn(log.date, metrics);
    const perSet = log.actual?.reps ?? log.actual?.durationSec ?? log.actual?.movingSec ?? null;
    const sets = log.actual?.sets ?? 1;
    let rwiText = '—';
    if (perSet != null && w != null) {
      const rwi = perSet * (goal.targetWeight / w);
      rwiText = `RWI ${rwi.toFixed(1)}/set${sets > 1 ? ` · total ${(rwi * sets).toFixed(1)}` : ''}`;
    }
    card.appendChild(el('div', { class: 'list-row' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, rwiText),
        el('div', { class: 'row-sub' },
          `${formatDate(log.date, { month: 'short', day: 'numeric', year: 'numeric' })} · `
          + summarizeActual(log.actual)
          + (w != null ? ` · @ ${formatWeight(w)}` : '')),
      ),
    ));
  }
  wrap.appendChild(card);
  return wrap;
}

function summarizeActual(actual = {}) {
  const parts = [];
  if (actual.sets != null && actual.reps != null) parts.push(`${actual.sets} × ${actual.reps}`);
  if (actual.durationSec) parts.push(formatDuration(actual.durationSec));
  if (actual.distanceM) parts.push(formatDistance(actual.distanceM));
  if (actual.movingSec && !actual.durationSec) parts.push(formatDuration(actual.movingSec));
  return parts.join(' · ') || 'no data';
}

// ---------- Goals ----------

const fmtTime = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

function renderGoals() {
  const goals = store.get('goals');
  root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'Goals'),
    el('button', { class: 'btn small', onclick: () => editGoal(null) }, '+ New goal'),
  ));
  if (!goals.length) {
    root.appendChild(emptyState('No goals yet. Add a bodyweight target, a run time, or an exercise goal.'));
    return;
  }
  const exById = new Map(store.get('exercises').map((e) => [e.id, e]));
  for (const g of goals) root.appendChild(goalCard(g, exById));
}

function goalCard(goal, exById) {
  let title = '';
  let progress = '';
  if (goal.type === 'bodyweight') {
    title = `Bodyweight: ${formatWeight(goal.targetWeight)}`;
    const current = weightOn(todayStr(), store.get('metrics'));
    if (current != null) {
      const diff = current - goal.targetWeight;
      progress = `current ${formatWeight(current)} · ${diff > 0 ? formatWeight(Math.abs(diff)) + ' to lose' : diff < 0 ? formatWeight(Math.abs(diff)) + ' to gain' : 'at goal 🎉'}`;
    } else {
      progress = 'no body weight logged yet';
    }
  } else if (goal.type === 'runTime') {
    const preset = RUN_GOAL_PRESETS.find((p) => p.distanceM === goal.distanceM);
    title = `${preset?.label ?? formatDistance(goal.distanceM)} in ${fmtTime(goal.targetSec)}`;
    const best = bestRunEffort(goal.distanceM);
    progress = best
      ? `best so far ${fmtTime(best.sec)} (${formatDate(best.date)})${best.sec <= goal.targetSec ? ' — goal met 🎉' : ` · ${fmtTime(best.sec - goal.targetSec)} to go`}`
      : 'no matching runs logged yet';
  } else {
    const ex = exById.get(goal.exerciseId);
    title = `${ex?.name ?? 'Exercise'}: ${targetSummary(goal.target)}`;
    const last = store.get('logs').filter((l) => l.exerciseId === goal.exerciseId).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    progress = last ? `last: ${summarizeActual(last.actual)} (${formatDate(last.date)})` : 'not logged yet';
  }
  return el('div', { class: 'card tappable', onclick: () => editGoal(goal) },
    el('div', { class: 'list-row', style: 'border:none;padding:0' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, title),
        el('div', { class: 'row-sub' }, progress),
        goal.targetDate && el('div', { class: 'row-sub' }, `by ${formatDate(goal.targetDate, { month: 'short', day: 'numeric', year: 'numeric' })}`),
        goal.notes && el('div', { class: 'row-sub' }, goal.notes),
      ),
      el('span', { class: 'pill accent' }, goal.type === 'runTime' ? 'run time' : goal.type),
    ),
  );
}

// Fastest logged effort whose distance is within ±2.5% of the goal distance,
// across synced activities and manual distance logs.
function bestRunEffort(distanceM) {
  const tol = distanceM * 0.025;
  let best = null;
  const consider = (d, sec, date) => {
    if (d == null || sec == null) return;
    if (Math.abs(d - distanceM) > tol) return;
    // Normalize to exact goal distance by pace so 5.05 km counts fairly.
    const normalized = sec * (distanceM / d);
    if (!best || normalized < best.sec) best = { sec: Math.round(normalized), date };
  };
  for (const e of store.getActivityEntries()) consider(e.distanceM, e.movingSec, e.date);
  for (const l of store.get('logs')) consider(l.actual?.distanceM, l.actual?.movingSec, l.date);
  return best;
}

function editGoal(goal) {
  const isNew = !goal;
  const draft = goal ? { ...goal } : makeGoal();
  let pickedExercise = draft.exerciseId ? store.get('exercises').find((e) => e.id === draft.exerciseId) : null;

  const typeSel = el('select', {},
    el('option', { value: 'bodyweight', selected: draft.type === 'bodyweight' }, 'Bodyweight'),
    el('option', { value: 'runTime', selected: draft.type === 'runTime' }, 'Run time'),
    el('option', { value: 'exercise', selected: draft.type === 'exercise' }, 'Exercise'),
  );
  const dateInput = el('input', { type: 'date', value: draft.targetDate ?? '' });
  const notesInput = el('input', { value: draft.notes ?? '', placeholder: 'optional' });
  const fields = el('div', {});
  const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
  const num = (name, value, step = 1) =>
    el('input', { type: 'number', inputmode: 'decimal', step, value: value ?? '', dataset: { name } });

  function renderFields() {
    const type = typeSel.value;
    fields.innerHTML = '';
    if (type === 'bodyweight') {
      fields.append(field(`Target weight (${weightUnit()})`, num('weight', weightToInput(draft.targetWeight) ?? '', 0.5)));
    } else if (type === 'runTime') {
      const presetSel = el('select', { dataset: { name: 'preset' } },
        RUN_GOAL_PRESETS.map((p) => el('option', { value: p.distanceM, selected: draft.distanceM === p.distanceM }, p.label)),
        el('option', { value: 'custom', selected: draft.distanceM != null && !RUN_GOAL_PRESETS.some((p) => p.distanceM === draft.distanceM) }, 'Custom…'),
      );
      const customWrap = el('div', { class: 'field', hidden: presetSel.value !== 'custom' },
        el('label', {}, `Distance (${distanceUnit()})`),
        num('customDist', draft.distanceM ? distanceToInput(draft.distanceM) : '', 0.1));
      presetSel.addEventListener('change', () => { customWrap.hidden = presetSel.value !== 'custom'; });
      const totalSec = draft.targetSec ?? 0;
      fields.append(
        field('Distance', presetSel),
        customWrap,
        el('div', { class: 'field-row' },
          field('Target minutes', num('goalMin', totalSec ? Math.floor(totalSec / 60) : '')),
          field('Seconds', num('goalSec', totalSec ? Math.round(totalSec % 60) : '')),
        ),
      );
    } else {
      const pickBtn = el('button', {
        class: 'btn secondary small',
        onclick: () => pickExercise((ex) => {
          pickedExercise = ex;
          pickBtn.textContent = ex.name;
        }),
      }, pickedExercise?.name ?? 'Pick exercise…');
      fields.append(
        el('div', { class: 'field' }, el('label', {}, 'Exercise'), pickBtn),
        el('div', { class: 'field-row' },
          field('Sets', num('sets', draft.target?.sets ?? '')),
          field('Reps', num('reps', draft.target?.reps ?? '')),
          field(`Weight (${weightUnit()})`, num('exWeight', weightToInput(draft.target?.weight) ?? '', 0.5)),
        ),
        el('div', { class: 'field-row' },
          field('Duration (min)', num('durMin', draft.target?.durationSec ? draft.target.durationSec / 60 : '')),
          field(`Distance (${distanceUnit()})`, num('dist', draft.target?.distanceM ? distanceToInput(draft.target.distanceM) : '', 0.1)),
        ),
      );
    }
  }
  typeSel.addEventListener('change', renderFields);
  renderFields();

  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        const val = (n) => {
          const v = parseFloat(fields.querySelector(`[data-name="${n}"]`)?.value);
          return isNaN(v) ? null : v;
        };
        const type = typeSel.value;
        draft.type = type;
        draft.targetDate = dateInput.value || null;
        draft.notes = notesInput.value.trim();
        if (type === 'bodyweight') {
          const w = val('weight');
          if (w == null) { toast('Enter a target weight', 'error'); return false; }
          draft.targetWeight = weightFromInput(w);
        } else if (type === 'runTime') {
          const presetSel = fields.querySelector('[data-name="preset"]');
          draft.distanceM = presetSel.value === 'custom'
            ? (val('customDist') != null ? distanceFromInput(val('customDist')) : null)
            : Number(presetSel.value);
          const sec = (val('goalMin') ?? 0) * 60 + (val('goalSec') ?? 0);
          if (!draft.distanceM || !sec) { toast('Enter a distance and target time', 'error'); return false; }
          draft.targetSec = Math.round(sec);
        } else {
          if (!pickedExercise) { toast('Pick an exercise', 'error'); return false; }
          draft.exerciseId = pickedExercise.id;
          const target = {};
          if (val('reps') != null) { target.kind = 'reps'; target.reps = val('reps'); if (val('sets') != null) target.sets = val('sets'); if (val('exWeight') != null) target.weight = weightFromInput(val('exWeight')); }
          else if (val('durMin') != null) { target.kind = 'duration'; target.durationSec = Math.round(val('durMin') * 60); }
          else if (val('dist') != null) { target.kind = 'distance'; target.distanceM = distanceFromInput(val('dist')); }
          if (!target.kind) { toast('Enter a target (reps, duration, or distance)', 'error'); return false; }
          draft.target = target;
        }
        store.upsert('goals', draft);
        render();
      },
    },
  ];
  if (!isNew) {
    actions.unshift({
      label: 'Delete',
      class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog('Delete this goal?'))) return false;
        store.remove('goals', draft.id);
        render();
      },
    });
  }
  openModal(isNew ? 'New goal' : 'Edit goal', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Goal type'), typeSel),
    fields,
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Target date (optional)'), dateInput),
      el('div', { class: 'field' }, el('label', {}, 'Notes'), notesInput),
    ),
  ), actions);
}
