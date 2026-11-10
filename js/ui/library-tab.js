// Fitness Library tab: the exercise library (with full v2 detail — cues,
// safety notes, variants — and per-set RWI history), training Goals
// (bodyweight, run times, exercise targets), and Gear (js/ui/gear-view.js).
//
// RWI (Relative Work Index) normalizes work against your goal weight:
// RWI = work × (goal weight / body weight at the time). Work is reps, or
// km × km/h for distance, or seconds for a hold — see js/rwi.js.

import * as store from '../storage/store.js';
import { makeGoal, makeExercise, exerciseUsage, remapExercise, allSessions, sessionItems } from '../models.js';
import { RUN_GOAL_PRESETS, MUSCLE_GROUPS, WEIGHT_TYPES, POSITIONS } from '../config.js';
import {
  matchesFilters, muscleGroupsOf, weightTypesOf, positionsOf, isFiltering, NOT_SET,
} from '../exercise-filters.js';
import { todayStr, formatDate, formatDuration, parseDateStr, addDays } from '../dates.js';
import {
  formatWeight, formatDistance, formatPace, weightUnit, weightToInput, weightFromInput,
  distanceToInput, distanceFromInput, distanceUnit,
} from '../units.js';
import { el, openModal, confirmDialog, toast, emptyState, downloadJson, filePicker } from './components.js';
import { loadManifest, loadPreset } from '../presets.js';
import { syncFromPresets } from '../preset-sync.js';
import { filterBar, emptyFilters, describeExercise, labelOf } from './exercise-filter-bar.js';
import { extractExerciseDefs, planExerciseImport, applyExerciseImport, exerciseTemplate } from '../exercise-io.js';
import { gifImage, hasGif } from './media.js';
import { editExercise, pickExercise, targetSummary, libraryUpserter, exerciseDef, slug } from './plans-tab.js';
import { renderGear } from './gear-view.js';
import { formatSets } from '../sets.js';
import { rwiWork, weightOn, RWI_BASIS_LABEL } from '../rwi.js';
import {
  loadModelOf, modelParams, modelLabel, isLoadModel, sessionLoadValue, setValues,
  fractionFor, variantLevelFor, plannedTargetOf, bestReps, longestHold,
} from '../load.js';
import { lineChart, datePoints } from '../charts.js';
import { suggestionFor, suggestionChip } from './suggestion.js';
import { nextPlannedFor } from '../schedule.js';

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
    scrollTo(0, 0);
  } else if (view.linked) {
    view = { ...view, linked: false };
    render();
  }
}

// In-tab navigation keeps the hash in step without adding history entries,
// so a reload lands in the same place and Back skips the in-tab steps.
// The page keeps its scroll position across a re-render, so an exercise
// opened from far down the list would open scrolled to its bottom. Open it at
// the top, and bring the list back to where you were.
let listScrollY = 0;
function showExercise(id) {
  if (view.name === 'exercises') listScrollY = scrollY;
  view = { name: 'exercise', id };
  history.replaceState(null, '', `#/library/exercise/${encodeURIComponent(id)}`);
  render();
  scrollTo(0, 0);
}
function showList() {
  view = { name: 'exercises' };
  render();
  scrollTo(0, listScrollY);
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
let filters = emptyFilters();

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
  // Fill empty fields (and migrate the Push-Up ladder) from the packs.
  syncFromPresets();

  const byName = (a, b) => a.name.localeCompare(b.name);
  const active = lib.filter((e) => !e.archived).sort(byName);
  const archived = lib.filter((e) => e.archived).sort(byName);

  const bar = filterBar({ exercises: active, filters, onChange: () => update() });
  const summary = el('div', { class: 'filter-summary' });
  const listEl = el('div', {});
  root.append(bar.el, summary, listEl);

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
          onclick: () => { filters = emptyFilters(); render(); },
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
    // The id lets a re-import update this exercise even if you rename it.
    exerciseLibrary[key] = {
      id: ex.id,
      ...exerciseDef(ex),
      ...(ex.gif ? { gif: ex.gif } : {}),
      ...(ex.weightStepKg ? { weightStepKg: ex.weightStepKg } : {}),
      ...(ex.archived ? { archived: true } : {}),
    };
  }
  downloadJson('exercise-library.json', {
    format: 'fitness-tracker-exercise-library',
    formatVersion: 2,
    exerciseLibrary,
  });
  toast(`Exported ${lib.length} exercise${lib.length === 1 ? '' : 's'}`);
}

// Import: starter packs (they only fill blanks, never overwrite your edits),
// or your own file — which updates the exercises it matches and adds the
// rest, after a preview (js/exercise-io.js).
function importExercisesModal() {
  const textarea = el('textarea', {
    placeholder: 'Paste exercise JSON here, or pick a file above…',
    style: 'min-height:120px;font-family:monospace;font-size:0.8rem',
    dataset: { name: 'import-json' },
  });
  const preview = el('div', { class: 'import-preview', dataset: { name: 'import-preview' } });
  let plan = null;
  const fileInput = filePicker({
    onchange: () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      f.text().then((t) => { textarea.value = t; check(); }).catch(() => toast('Could not read file', 'error'));
    },
  });
  textarea.addEventListener('input', () => { clearTimeout(textarea._t); textarea._t = setTimeout(check, 300); });

  // Parse and show what would happen; nothing changes until Import.
  function check() {
    plan = null;
    preview.innerHTML = '';
    if (!textarea.value.trim()) return;
    let defs;
    try {
      defs = extractExerciseDefs(JSON.parse(textarea.value));
    } catch (e) {
      preview.appendChild(el('p', { class: 'import-error' }, e instanceof SyntaxError ? `That isn’t valid JSON: ${e.message}` : e.message));
      return;
    }
    plan = planExerciseImport(defs, store.get('exercises'), { makeExercise: (name) => makeExercise({ name }) });
    const names = (list) => list.map((x) => x.name).join(', ');
    preview.append(
      el('div', { class: 'import-counts' },
        `${plan.creates.length} new · ${plan.updates.length} updated · ${plan.unchanged.length} unchanged`
        + (plan.skipped.length ? ` · ${plan.skipped.length} skipped` : '')),
      plan.creates.length ? el('div', { class: 'row-sub' }, el('strong', {}, 'New: '), names(plan.creates)) : null,
      plan.updates.length ? el('div', { class: 'row-sub' }, el('strong', {}, 'Updated: '),
        plan.updates.map((u) => `${u.after.name} (${u.fields.join(', ')})`).join('; ')) : null,
      plan.skipped.length ? el('div', { class: 'row-sub import-error' }, el('strong', {}, 'Skipped: '),
        plan.skipped.map((x) => `${x.name} — ${x.reason}`).join('; ')) : null,
    );
  }

  const packList = el('div', {}, el('p', { class: 'muted' }, 'Loading starter packs…'));
  let modal;
  loadManifest().then((manifest) => {
    packList.innerHTML = '';
    for (const pack of manifest.exercisePacks ?? []) {
      packList.appendChild(el('div', { class: 'list-row tappable', onclick: async () => {
        try {
          const lib = libraryUpserter();
          for (const def of extractExerciseDefs(await loadPreset(pack.file))) lib.resolve(def);
          lib.commit();
          const { created, enriched } = lib.stats;
          toast(!created && !enriched ? 'Nothing new — all exercises already in the library'
            : `Imported: ${created} new${enriched ? `, ${enriched} filled in` : ''}`);
          modal.close();
          render();
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

  modal = openModal('Import exercises', el('div', {},
    el('h3', {}, 'Your file'),
    el('p', { class: 'muted' },
      'Add or edit many exercises at once: Export, edit the file, import it here. Exercises you already have ',
      '(matched by id, else by name) are updated with the file’s fields; the rest are added.'),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, fileInput),
      el('div', { class: 'field', style: 'flex:0 0 auto' },
        el('button', { class: 'btn small secondary', type: 'button', dataset: { action: 'template' },
          onclick: () => downloadJson('exercise-template.json', exerciseTemplate()) }, 'Download template'))),
    el('div', { class: 'field' }, textarea),
    preview,
    el('h3', {}, 'Starter packs'),
    el('p', { class: 'muted' }, 'Adds the pack’s exercises; ones you already have only gain blank fields — your edits are kept.'),
    packList,
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: 'Import',
      class: 'btn',
      onClick: () => {
        check();
        if (!plan) { toast(textarea.value.trim() ? 'Fix the file first' : 'Pick or paste a file first', 'error'); return false; }
        if (!plan.creates.length && !plan.updates.length) { toast('Nothing to change'); return; }
        store.save('exercises', applyExerciseImport(store.get('exercises'), plan));
        toast(`Imported: ${plan.creates.length} new, ${plan.updates.length} updated`);
        render();
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

  // The exercise's animation, beside what it is; tap for full size.
  if (hasGif(ex.gif)) root.appendChild(el('div', { class: 'gif-figure' }, gifImage(ex.gif, { alt: ex.name })));
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
      card.appendChild(el('div', { class: 'list-row variant-row' },
        hasGif(v.gif) && gifImage(v.gif, { cls: 'gif-thumb', alt: `${ex.name}: ${v.name}` }),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, `L${v.level} · ${v.name}`),
          v.description && el('div', { class: 'row-sub' }, v.description),
        ),
      ));
    }
    root.appendChild(card);
  }
  if (ex.progressionRule) root.appendChild(el('p', { class: 'muted' }, `Progression: ${ex.progressionRule}`));

  const next = nextTimeSection(ex);
  if (next) root.appendChild(next);
  const load = loadSection(ex);
  if (load) root.appendChild(load);
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

// ---------- Next time (js/progression.js) ----------

function nextTimeSection(ex) {
  const today = todayStr();
  const planned = nextPlannedFor(ex.id, store.get('plans'), today, store.get('schedule'));
  const sug = suggestionFor({
    exercise: ex,
    target: planned?.item.target ?? null,
    weekIsDeload: !!planned?.week?.isDeload,
    logs: store.get('logs'),
    plans: store.get('plans'),
    today,
    records: store.get('sessions'),
  });
  if (!sug) return null;
  return el('div', { class: 'card next-time' },
    el('h3', { style: 'margin-top:0' }, 'Next time',
      planned && planned.date >= today
        ? el('span', { class: 'muted', style: 'font-weight:400' }, ` · ${formatDate(planned.date, { weekday: 'short', month: 'short', day: 'numeric' })}`)
        : null),
    suggestionChip(sug, ex, { target: planned?.item.target ?? null }),
  );
}

// ---------- Load index (js/load.js) ----------

// "Scale to goal weight" is a per-browser display choice, like units: the
// stored logs never hold a scaled number.
const LOAD_SCALE_KEY = 'ft.loadScale';
function loadScaleOn() {
  try { return localStorage.getItem(LOAD_SCALE_KEY) === '1'; } catch { return false; }
}
function setLoadScale(on) {
  try {
    if (on) localStorage.setItem(LOAD_SCALE_KEY, '1');
    else localStorage.removeItem(LOAD_SCALE_KEY);
  } catch { /* storage blocked: the toggle just won't stick */ }
}
const fmtKg = (kg) => formatWeight(Math.round(kg * 10) / 10);
const DAY_MS = 86400000;

function loadSection(ex) {
  const model = loadModelOf(ex);
  if (model === 'cardio') return null; // RWI below is the main view for cardio
  const plans = store.get('plans');
  const metrics = store.get('metrics');
  const goal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
  const scale = loadScaleOn();
  const loadBased = isLoadModel(model);
  const timed = model === 'duration';
  const params = modelParams(ex);

  const wrap = el('div', { class: 'load-section' },
    el('h3', {}, loadBased ? 'Load index' : timed ? 'Hold time' : 'Reps'));
  if (loadBased) wrap.appendChild(el('p', { class: 'muted load-model' }, `${modelLabel(ex)} — the best set of each session.`));
  const logs = store.get('logs')
    .filter((l) => l.exerciseId === ex.id)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!logs.length) {
    wrap.appendChild(el('p', { class: 'muted' }, 'No logged sessions yet.'));
    return wrap;
  }

  const rows = logs.map((log) => {
    const level = variantLevelFor(log, plans);
    const variant = level != null ? (ex.variants ?? []).find((v) => v.level === level) ?? null : null;
    const bodyKg = weightOn(log.date, metrics);
    const variantFraction = fractionFor(ex, log, plans);
    const args = { exercise: ex, log, bodyKgOnDay: bodyKg, variantFraction };
    const res = loadBased ? sessionLoadValue({ ...args, goalKg: goal?.targetWeight ?? null, scale }) : null;
    const why = loadBased && !res ? setValues(args).reason : null;
    return { log, level, variant, res, why, fallback: timed ? longestHold(log) : bestReps(log) };
  });
  // Rolling 4-week best, as a second reading in the list.
  for (const r of rows) {
    if (!r.res) continue;
    const t = parseDateStr(r.log.date).getTime();
    r.best4w = Math.max(...rows
      .filter((o) => o.res && t - parseDateStr(o.log.date).getTime() < 28 * DAY_MS && o.log.date <= r.log.date)
      .map((o) => o.res.value));
  }

  if (loadBased) {
    const box = el('input', { type: 'checkbox', checked: scale, dataset: { name: 'loadScale' } });
    box.addEventListener('change', () => { setLoadScale(box.checked); render(); });
    wrap.appendChild(el('label', { class: 'check-inline', style: 'margin-bottom:8px' }, box, ' Scale to goal weight'));
    if (scale && rows.some((r) => r.res?.detail.scaleUnavailable)) {
      wrap.appendChild(el('p', { class: 'muted' }, goal
        ? 'Some sessions have no weigh-in to scale from, so they show unscaled values.'
        : 'No bodyweight goal set (Goals), so values are unscaled.'));
    } else if (scale) {
      wrap.appendChild(el('p', { class: 'muted' },
        `Scaled to your goal weight of ${formatWeight(goal.targetWeight)}: this capacity at goal weight, assuming strength-to-weight stays the same.`));
    }
  }

  // Chart: the load series when there is one; otherwise the reps/hold trend
  // at the most recent variant (a different rung isn't the same movement).
  const withLoad = rows.filter((r) => r.res);
  let chart;
  if (withLoad.length) {
    chart = lineChart({
      points: datePoints(withLoad.map((r) => ({ date: r.log.date, y: r.res.value })),
        (p) => weightToInput(Math.round(p.y * 10) / 10)),
      yLabel: weightUnit(),
      yFormat: (v) => String(Math.round(v * 10) / 10),
    });
  } else {
    const latest = [...rows].reverse().find((r) => r.fallback != null);
    const same = rows.filter((r) => r.fallback != null && r.level === latest?.level);
    chart = lineChart({
      points: datePoints(same.map((r) => ({ date: r.log.date, y: r.fallback })), (p) => p.y),
      yLabel: `${timed ? 'Longest hold (s)' : 'Best set (reps)'}${latest?.variant ? ` · ${latest.variant.name}` : ''}`,
      yFormat: (v) => String(Math.round(v)),
    });
  }
  wrap.appendChild(chart);

  const reasonText = (r) => {
    const what = timed ? 'hold time' : 'reps';
    if (r.why === 'overCap') return `Over the ${params.maxReps}-rep cap, so showing ${what}.`;
    if (r.why === 'noWeight') return `No weight recorded, so showing ${what}.`;
    if (r.why === 'noBodyweight') return `No weigh-in on or before this date, so showing ${what}.`;
    if (r.why === 'noFraction') {
      return r.variant
        ? `${r.variant.name} isn’t comparable by load, so showing ${what}.`
        : `No variant recorded (or no bodyweight fraction), so showing ${what}.`;
    }
    return null;
  };

  const card = el('div', { class: 'card' });
  for (const r of [...rows].reverse().slice(0, 15)) {
    const date = formatDate(r.log.date, { month: 'short', day: 'numeric', year: 'numeric' });
    const variantName = r.variant ? ` · ${r.variant.name}` : '';
    let title;
    let sub;
    if (r.res) {
      const d = r.res.detail;
      title = `${fmtKg(r.res.value)} · 4-wk best ${fmtKg(r.best4w)}`;
      const setText = model === 'bw_e1rm'
        ? `${d.reps} reps at ${fmtKg(d.loadKg)} effective${d.addedKg > 0 ? ` (+${fmtKg(d.addedKg)})` : ''}`
        : `${d.reps} × ${fmtKg(d.loadKg)}`;
      sub = `${date} · best set ${setText}${variantName}${d.scaled ? ' · scaled to goal' : ''}`;
    } else {
      title = r.fallback == null ? '—'
        : timed ? `Longest hold: ${formatDuration(r.fallback)}${variantName}`
          : `Best set: ${r.fallback} reps${variantName}`;
      sub = date;
    }
    const why = reasonText(r);
    card.appendChild(el('div', { class: 'list-row' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, title),
        el('div', { class: 'row-sub' }, sub),
        why && el('div', { class: 'row-sub' }, why),
      ),
    ));
  }
  wrap.appendChild(card);
  return wrap;
}

function rwiSection(ex) {
  const wrap = el('div', {});
  wrap.appendChild(el('h3', {}, isLoadModel(loadModelOf(ex)) ? 'Relative Work Index (work)' : 'Relative Work Index'));
  const plans = store.get('plans');

  const goal = store.get('goals').find((g) => g.type === 'bodyweight' && g.targetWeight != null);
  const logs = store.get('logs')
    .filter((l) => l.exerciseId === ex.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 15);

  if (!goal) {
    wrap.appendChild(el('p', { class: 'muted' },
      'RWI needs a bodyweight goal: RWI = work × (goal weight ÷ your weight at the time), where work is reps per set, ',
      'km × km/h for distance, running seconds for run/walk intervals, or seconds for a hold. ',
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
    'RWI = work × goal ÷ bodyweight on the day. Work is reps per set; for distance, km × km/h ',
    '(so going further or faster both count); for run/walk intervals, the running seconds; for a hold, seconds.'));

  if (!logs.length) {
    wrap.appendChild(el('p', { class: 'muted' }, 'No logged sets for this exercise yet.'));
    return wrap;
  }
  const card = el('div', { class: 'card' });
  for (const log of logs) {
    const w = weightOn(log.date, metrics);
    const { basis, perSet } = rwiWork(log.actual, plannedTargetOf(log, plans));
    let rwiText = '—';
    if (perSet.length && w != null) {
      const ratio = goal.targetWeight / w;
      const each = perSet.map((x) => x * ratio);
      const total = each.reduce((a, b) => a + b, 0);
      const uniform = each.every((x) => x === each[0]);
      // "/set" only means something for reps; a run is one effort.
      const per = basis === 'reps' ? '/set' : '';
      rwiText = uniform
        ? `RWI ${each[0].toFixed(1)}${per}${each.length > 1 ? ` · total ${total.toFixed(1)}` : ''}`
        : `RWI ${each.map((x) => x.toFixed(1)).join(' / ')} · total ${total.toFixed(1)}`;
      if (basis !== 'reps') rwiText += ` (${RWI_BASIS_LABEL[basis]})`;
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
  if (formatSets(actual)) parts.push(formatSets(actual));
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
