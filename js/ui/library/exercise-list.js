// Library → the exercise list (search and filters), and library import /
// export.
import * as store from '../../storage/store.js';
import { downloadJson, el, emptyState, filePicker, openModal, toast } from '../components.js';
import { editExercise, exerciseDef, libraryUpserter, slug } from '../plans-tab.js';
import { render, showExercise } from '../library-tab.js';
import { syncFromPresets } from '../../preset-sync.js';
import { describeExercise, emptyFilters, filterBar } from '../exercise-filter-bar.js';
import { isFiltering, matchesFilters } from '../../exercise-filters.js';
import { applyExerciseImport, exerciseTemplate, extractExerciseDefs, planExerciseImport } from '../../exercise-io.js';
import { makeExercise } from '../../models.js';
import { loadManifest, loadPreset } from '../../presets.js';
import { S } from './state.js';

export function renderExerciseList() {
  const lib = store.get('exercises');
  S.root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'Exercise library'),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => importExercisesModal() }, 'Import'),
      el('button', { class: 'btn small secondary', onclick: () => exportLibrary() }, 'Export'),
      el('button', { class: 'btn small', onclick: () => editExercise(null, () => render()) }, '+ New'),
    ),
  ));
  if (!lib.length) {
    S.root.appendChild(emptyState('No exercises yet. They’re also created automatically when importing plans.'));
    return;
  }
  // Fill empty fields (and migrate the Push-Up ladder) from the packs.
  syncFromPresets();

  const byName = (a, b) => a.name.localeCompare(b.name);
  const active = lib.filter((e) => !e.archived).sort(byName);
  const archived = lib.filter((e) => e.archived).sort(byName);

  const bar = filterBar({ exercises: active, filters: S.filters, onChange: () => update() });
  const summary = el('div', { class: 'filter-summary' });
  const listEl = el('div', {});
  S.root.append(bar.el, summary, listEl);

  const row = (ex) => el('div', { class: 'list-row tappable', onclick: () => showExercise(ex.id) },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, ex.name),
      el('div', { class: 'row-sub' }, describeExercise(ex) || `${ex.category} · ${ex.modality}`),
    ),
    el('span', { class: 'pill' }, String(logCountFor(ex.id)) + ' logs'),
  );

  // Only the list redraws as you type, so the search box keeps focus.
  function update() {
    const shown = active.filter((ex) => matchesFilters(ex, S.filters));
    const shownArchived = archived.filter((ex) => matchesFilters(ex, S.filters));
    listEl.innerHTML = '';
    summary.innerHTML = '';
    if (isFiltering(S.filters)) {
      summary.append(
        el('span', { class: 'muted' }, `${shown.length} of ${active.length} exercises`),
        el('button', {
          class: 'btn small secondary',
          onclick: () => { S.filters = emptyFilters(); render(); },
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

export function logCountFor(exerciseId) {
  return store.get('logs').filter((l) => l.exerciseId === exerciseId).length;
}

// ---------- Library import / export ----------

// Whole library as a schema-shaped exerciseLibrary map — definitions only,
// no log history. Round-trips through the Import button below.
export function exportLibrary() {
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
export function importExercisesModal() {
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
