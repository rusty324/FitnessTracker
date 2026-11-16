// Library → an exercise's page, and deleting an exercise (replace or
// archive where it is used).
import * as store from '../../storage/store.js';
import { render, showExercise, showList } from '../library-tab.js';
import { isDesktop } from '../layout.js';
import { confirmDialog, el, openModal, toast } from '../components.js';
import { librarySidebar, nextTimeCard, progressSection } from '../exercise-desktop.js';
import { editExercise, pickExercise } from '../plans-tab.js';
import { describeExercise, labelOf } from '../exercise-filter-bar.js';
import { gifImage, hasGif } from '../media.js';
import { positionsOf } from '../../exercise-filters.js';
import { POSITIONS } from '../../config.js';
import { loadSection, nextTimeSection, rwiSection } from './exercise-progress.js';
import { exerciseUsage, remapExercise } from '../../models.js';
import { S } from './state.js';

// ---------- Exercise detail ----------

export function renderExerciseDetail(id) {
  const ex = store.get('exercises').find((e) => e.id === id);
  if (!ex) { showList(); return; }
  if (!isDesktop()) { renderExerciseBody(ex, false); return; }
  // Desktop: the library as a sidebar, the exercise beside it (1200px).
  const page = S.root;
  page.classList.add('wide');
  const main = el('div', { class: 'col-main' });
  page.appendChild(el('div', { class: 'two-col' },
    el('aside', { class: 'col-lib', 'aria-label': 'Exercises' }, librarySidebar(ex, (exId) => showExercise(exId))),
    main));
  S.root = main;
  try {
    renderExerciseBody(ex, true);
  } finally {
    S.root = page;
  }
}

export function renderExerciseBody(ex, desktop) {
  S.root.appendChild(el('div', { class: 'list-row' },
    el('div', { class: 'row-main' },
      // Reached from a link (e.g. a planned exercise on the Logs page):
      // go back there. Otherwise, or after a reload, back to the list.
      S.view.linked
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

  S.root.appendChild(el('h2', { class: desktop ? 'page-h1' : '' }, ex.name));
  if (desktop && describeExercise(ex)) S.root.appendChild(el('div', { class: 'row-sub', style: 'margin:-6px 0 10px;font-size:0.95rem' }, describeExercise(ex)));
  // Desktop: Next time (with the rule), the top set by session, and what
  // the rule said after each recent session — right under the heading.
  if (desktop) {
    const card = nextTimeCard(ex);
    if (card) S.root.appendChild(card);
    for (const part of progressSection(ex) ?? []) S.root.appendChild(part);
  }
  S.root.appendChild(el('div', { style: 'margin-bottom:10px' },
    el('span', { class: 'pill accent' }, ex.category), ' ',
    el('span', { class: 'pill' }, ex.modality), ' ',
    el('span', { class: 'pill' }, ex.measurementType),
    ex.perSide ? [' ', el('span', { class: 'pill warn' }, 'per side')] : '',
    ex.archived ? [' ', el('span', { class: 'pill warn' }, 'archived')] : '',
  ));

  // The exercise's animation, beside what it is; tap for full size.
  if (hasGif(ex.gif)) S.root.appendChild(el('div', { class: 'gif-figure' }, gifImage(ex.gif, { alt: ex.name })));
  if (ex.description) S.root.appendChild(el('p', {}, ex.description));
  if (ex.whyItsHere) S.root.appendChild(el('p', { class: 'muted' }, `Why it’s here: ${ex.whyItsHere}`));
  if (ex.equipment?.length) S.root.appendChild(el('p', { class: 'muted' }, `Equipment: ${ex.equipment.join(', ')}`));
  if (ex.primaryTargets?.length) S.root.appendChild(el('p', { class: 'muted' }, `Targets: ${ex.primaryTargets.join(', ')}`));
  if (positionsOf(ex).length) {
    S.root.appendChild(el('p', { class: 'muted' }, `Position: ${positionsOf(ex).map((id) => labelOf(POSITIONS, id)).join(', ')}`));
  }

  if (ex.cues?.length) {
    S.root.appendChild(el('div', { class: 'card' },
      el('h3', {}, 'Cues'),
      el('ul', { style: 'margin:0;padding-left:18px' }, ex.cues.map((c) => el('li', {}, c))),
    ));
  }
  if (ex.safetyNotes?.length) {
    S.root.appendChild(el('div', { class: 'card', style: 'border-color:var(--danger)' },
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
    S.root.appendChild(card);
  }
  if (ex.progressionRule) S.root.appendChild(el('p', { class: 'muted' }, `Progression: ${ex.progressionRule}`));

  const next = desktop ? null : nextTimeSection(ex);
  if (next) S.root.appendChild(next);
  const load = loadSection(ex);
  if (load) S.root.appendChild(load);
  S.root.appendChild(rwiSection(ex));
}

// ---------- Deletion ----------

// Deleting an exercise that plans, logs, or goals still reference would
// leave dangling ids behind, so an in-use exercise offers safer routes
// first: repoint everything at a replacement, or archive it instead.
export function deleteExerciseFlow(ex) {
  const usage = exerciseUsage(ex.id, store.get('plans'), store.get('logs'), store.get('goals'));

  if (!usage.any) {
    confirmDialog(`Delete “${ex.name}” from the library?`).then((ok) => {
      if (!ok) return;
      store.remove('exercises', ex.id);
      S.view = { name: 'exercises' };
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
          S.view = { name: 'exercises' };
          render();
        }, {}, { excludeId: ex.id });
      }),
    option('Archive instead', 'secondary',
      'Hides it from exercise pickers but keeps every existing reference working. You can unarchive it later.',
      () => {
        modal.close();
        store.upsert('exercises', { ...ex, archived: true });
        toast(`“${ex.name}” archived`);
        S.view = { name: 'exercises' };
        render();
      }),
    option('Delete anyway', 'danger',
      'Plans and history keep the reference but show “Unknown exercise”, running charts drop those logs, '
      + 'and activity auto-matching stops suggesting it.',
      async () => {
        modal.close();
        if (!(await confirmDialog(`Permanently delete “${ex.name}” and leave ${parts.join(', ')} orphaned?`))) return;
        store.remove('exercises', ex.id);
        S.view = { name: 'exercises' };
        render();
      }),
  ), [{ label: 'Cancel', class: 'btn secondary', onClick: () => {} }]);
}
