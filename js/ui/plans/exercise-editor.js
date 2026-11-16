// The exercise picker and editor, shared by the Plans, Logs and Library tabs.
import { describeExercise, emptyFilters, filterBar } from '../exercise-filter-bar.js';
import * as store from '../../storage/store.js';
import { el, openModal, toast } from '../components.js';
import { isFiltering, matchesFilters, muscleGroupsOf } from '../../exercise-filters.js';
import { makeExercise, migrateExercise } from '../../models.js';
import { CATEGORIES, LOAD_MODEL_IDS, MEASUREMENT_TYPES, MODALITIES, MUSCLE_GROUPS, POSITIONS } from '../../config.js';
import { loadModelOf } from '../../load.js';
import { copyLinkedGif, gifImage, hasGif, isUpload, removeUpload, uploadGif } from '../media.js';

// ---------- Exercise picker + editor (shared with Logs and Library tabs) ----------

// onPick(exercise, pickerState) — pickerState captures the search query and
// scroll position so callers can offer a "back" that reopens the picker
// exactly where the user left it (pass it back as `restore`).
// Archived exercises are hidden here but still resolve everywhere else;
// excludeId omits one more (used when picking a replacement for it).
export function pickExercise(onPick, restore = {}, { excludeId = null } = {}) {
  // The library's search and filters (muscle group, weights, position).
  const filters = { ...emptyFilters(), ...(restore.filters ?? {}), query: restore.query ?? restore.filters?.query ?? '' };
  const pool = store.get('exercises')
    .filter((e) => !e.archived && e.id !== excludeId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const bar = filterBar({ exercises: pool, filters, onChange: () => renderList(), placeholder: 'Search exercises…' });
  const search = bar.search;
  const list = el('div', {});
  const summary = el('div', { class: 'filter-summary' });
  let modal;

  const pickerState = () => ({ query: filters.query, filters: { ...filters }, scroll: list.closest('.modal')?.scrollTop ?? 0 });
  const LIMIT = 50;

  function renderList() {
    const lib = pool.filter((e) => matchesFilters(e, filters));
    list.innerHTML = '';
    summary.replaceChildren(...(isFiltering(filters) ? [
      el('span', { class: 'muted' }, `${lib.length} of ${pool.length} exercises`),
      el('button', { class: 'btn small secondary', type: 'button', onclick: () => {
        Object.assign(filters, emptyFilters());
        bar.el.querySelectorAll('select').forEach((s) => { s.value = ''; });
        search.value = '';
        renderList();
      } }, 'Clear filters'),
    ] : []));
    for (const ex of lib.slice(0, LIMIT)) {
      list.appendChild(el('div', { class: 'list-row tappable', onclick: () => {
        const state = pickerState();
        modal.close();
        onPick(ex, state);
      } },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, ex.name),
          el('div', { class: 'row-sub' }, describeExercise(ex) || `${ex.category} · ${ex.modality}`),
        ),
      ));
    }
    if (lib.length > LIMIT) list.appendChild(el('p', { class: 'muted' }, `${lib.length - LIMIT} more — search or filter to narrow it down.`));
    if (!lib.length) {
      list.appendChild(el('p', { class: 'muted' }, !pool.length ? 'Library is empty.'
        : filters.query.trim() && !filters.muscle && !filters.weight && !filters.position
          ? `No match for “${filters.query}”.` : 'No exercises match these filters.'));
    }
  }
  renderList();

  modal = openModal('Pick exercise', el('div', {},
    el('div', { class: 'field' }, bar.el),
    summary,
    list,
    el('button', {
      class: 'btn secondary small',
      onclick: () => {
        const state = pickerState();
        modal.close();
        editExercise(null, (ex) => onPick(ex, state), filters.query.trim());
      },
    }, '+ New exercise'),
  ), [{ label: 'Cancel', class: 'btn secondary', onClick: () => {} }]);
  if (restore.scroll) {
    const modalEl = list.closest('.modal');
    if (modalEl) modalEl.scrollTop = restore.scroll;
  } else {
    setTimeout(() => search.focus(), 50);
  }
}

export function editExercise(ex, onSaved, prefillName = '') {
  const isNew = !ex;
  const draft = ex ? { ...migrateExercise(ex) } : makeExercise({ name: prefillName });
  const nameInput = el('input', { value: draft.name, placeholder: 'e.g. Back squat, Easy run' });
  const catSel = el('select', {}, CATEGORIES.map((c) => el('option', { value: c, selected: draft.category === c }, c)));
  const modSel = el('select', {}, MODALITIES.map((m) => el('option', { value: m, selected: draft.modality === m }, m)));
  const measSel = el('select', {}, MEASUREMENT_TYPES.map((u) => el('option', { value: u, selected: draft.measurementType === u }, u)));
  const descInput = el('textarea', { placeholder: 'How to perform the movement (optional)' }, draft.description ?? '');
  // Muscles and equipment stay free text (the v2 schema's shape); the
  // library's filters map them onto groups, shown live under the field.
  const list = (arr) => (arr ?? []).join(', ');
  const split = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const musclesInput = el('input', { value: list(draft.primaryTargets), placeholder: 'e.g. chest, triceps, front delts', dataset: { name: 'muscles' } });
  const groupsHint = el('div', { class: 'row-sub' });
  const showGroups = () => {
    const ids = muscleGroupsOf({ primaryTargets: split(musclesInput.value) });
    groupsHint.textContent = ids.length
      ? `Filters as: ${ids.map((id) => MUSCLE_GROUPS.find((g) => g.id === id).label).join(', ')}`
      : 'Not matched to a muscle group yet';
  };
  musclesInput.addEventListener('input', showGroups);
  showGroups();
  // One item per line: some items contain commas of their own ("dip bars,
  // parallettes, or rings").
  const equipInput = el('textarea', {
    placeholder: 'One per line, e.g.\ndumbbells\noptional: bench', rows: 3, dataset: { name: 'equipment' },
  }, (draft.equipment ?? []).join('\n'));
  const shown = { muscles: musclesInput.value, equipment: equipInput.value };
  // Load metrics (js/load.js). "Auto" leaves loadModel unset, so it keeps
  // being inferred from the modality.
  const LOAD_MODEL_LABELS = {
    e1rm: 'Est. 1RM (barbell)',
    erm_ref: 'Est. rep max (dumbbell / machine)',
    bw_e1rm: 'Bodyweight-adjusted (bodyweight)',
    reps: 'Reps at a variant',
    duration: 'Hold time',
    cardio: 'Cardio (RWI)',
  };
  const loadSel = el('select', { dataset: { name: 'loadModel' } },
    el('option', { value: '', selected: !draft.loadModel }, `Auto (${LOAD_MODEL_LABELS[loadModelOf({ ...draft, loadModel: undefined })]})`),
    LOAD_MODEL_IDS.map((id) => el('option', { value: id, selected: draft.loadModel === id }, LOAD_MODEL_LABELS[id])));
  const refRepsInput = el('input', {
    type: 'number', inputmode: 'numeric', step: 1, min: 1, max: 15,
    value: draft.referenceReps ?? '', placeholder: 'default 10 (8 for compounds)', dataset: { name: 'referenceReps' },
  });
  const refRepsField = el('div', { class: 'field' }, el('label', {}, 'Reference reps'), refRepsInput);
  const fractionInput = el('input', {
    type: 'number', inputmode: 'decimal', step: 0.01, min: 0, max: 1.2,
    value: draft.bodyweightFraction ?? '', placeholder: 'e.g. 0.64', dataset: { name: 'bodyweightFraction' },
  });
  const shownLoad = { referenceReps: refRepsInput.value, bodyweightFraction: fractionInput.value };
  const showRefReps = () => {
    const model = loadSel.value || loadModelOf({ ...draft, modality: modSel.value, loadModel: undefined });
    refRepsField.hidden = model !== 'erm_ref';
  };
  loadSel.addEventListener('change', showRefReps);
  modSel.addEventListener('change', showRefReps);
  showRefReps();
  // GIFs: the exercise's, and one per variant — a link, or an upload kept
  // in the data repo. Uploads made here but not saved are removed on Cancel.
  const gifs = {
    exercise: draft.gif ?? '',
    variants: (draft.variants ?? []).map((v) => v.gif ?? ''),
  };
  const startGifs = JSON.parse(JSON.stringify(gifs));
  const fresh = new Set(); // uploads made in this editor
  const gifSection = el('div', { class: 'gif-editor' });
  const gifRow = (label, get, set, key) => {
    const value = get();
    const link = el('input', {
      type: 'url', inputmode: 'url', placeholder: 'https://…/exercise.gif',
      value: isUpload(value) ? '' : value, dataset: { gif: key },
      oninput: (e) => { if (isUpload(get())) return; set(e.target.value.trim()); },
    });
    const picker = el('input', { type: 'file', class: 'gif-file', dataset: { gifFile: key } });
    picker.addEventListener('change', async () => {
      const f = picker.files?.[0];
      if (!f) return;
      try {
        const ref = await uploadGif(f);
        fresh.add(ref);
        set(ref);
        drawGifs();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
    return el('div', { class: 'gif-row' },
      el('div', { class: 'gif-row-head' },
        el('span', { class: 'gif-row-label' }, label),
        hasGif(value) && gifImage(value, { cls: 'gif-thumb', alt: label })),
      isUpload(value)
        ? el('div', { class: 'row-sub' }, 'Uploaded GIF')
        : link,
      el('div', { class: 'gif-row-actions' },
        el('label', { class: 'btn small secondary gif-upload' }, isUpload(value) ? 'Replace…' : 'Upload GIF…', picker),
        // A link -> a copy stored with your data (offline, and safe from
        // the link breaking), when the site allows it.
        !isUpload(value) && el('button', {
          class: 'btn small secondary', type: 'button', dataset: { action: 'copy-gif' },
          onclick: async (e) => {
            const btn = e.currentTarget;
            if (!hasGif(get())) { toast('Paste a GIF link first', 'error'); return; }
            btn.disabled = true;
            btn.textContent = 'Saving…';
            try {
              const ref = await copyLinkedGif(get());
              fresh.add(ref);
              set(ref);
              drawGifs();
              toast('Saved a copy — it no longer depends on that link');
            } catch (err) {
              toast(err.message, 'error');
              btn.disabled = false;
              btn.textContent = 'Save a copy';
            }
          },
        }, 'Save a copy'),
        hasGif(value) && el('button', { class: 'btn small secondary', type: 'button', onclick: () => { set(''); drawGifs(); } }, 'Remove')));
  };
  function drawGifs() {
    gifSection.replaceChildren(
      gifRow('Exercise', () => gifs.exercise, (v) => { gifs.exercise = v; }, 'exercise'),
      ...(draft.variants ?? []).map((v, i) =>
        gifRow(`L${v.level} · ${v.name}`, () => gifs.variants[i], (val) => { gifs.variants[i] = val; }, `variant-${v.level}`)),
    );
  }
  drawGifs();

  const positionBoxes = POSITIONS.map((p) => {
    const box = el('input', { type: 'checkbox', value: p.id, checked: (draft.positions ?? []).includes(p.id) });
    return { box, label: el('label', { class: 'check-inline' }, box, ` ${p.label}`) };
  });
  openModal(isNew ? 'New exercise' : 'Edit exercise', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Category'), catSel),
      el('div', { class: 'field' }, el('label', {}, 'Modality'), modSel),
      el('div', { class: 'field' }, el('label', {}, 'Measured by'), measSel),
    ),
    el('div', { class: 'field' }, el('label', {}, 'Muscles worked'), musclesInput, groupsHint),
    el('div', { class: 'field' }, el('label', {}, 'Equipment'), equipInput),
    el('div', { class: 'field' }, el('label', {}, 'Position'), el('div', { class: 'check-group' }, positionBoxes.map((x) => x.label))),
    el('div', { class: 'field' }, el('label', {}, 'Description'), descInput),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Load model'), loadSel),
      refRepsField,
      el('div', { class: 'field' }, el('label', {}, 'Bodyweight fraction'), fractionInput),
    ),
    el('div', { class: 'row-sub' },
      'How strength is tracked on the exercise page. Bodyweight fraction: share of body weight moved, ',
      'for a bodyweight exercise with no variant ladder (a floor push-up is about 0.64).'),
    el('h3', {}, 'Animations (GIF)'),
    el('p', { class: 'muted', style: 'margin-top:0' }, 'A link to a GIF, or upload one (up to 5 MB). Tap a GIF on the exercise page to see it full size.'),
    gifSection,
  ), [
    { label: 'Cancel', class: 'btn secondary', onClick: () => { for (const ref of fresh) removeUpload(ref); } },
    {
      label: 'Save',
      class: 'btn',
      onClick: () => {
        if (!nameInput.value.trim()) { toast('Name required', 'error'); return false; }
        const refReps = refRepsInput.value.trim() === '' ? null : Number(refRepsInput.value);
        if (refReps != null && !(Number.isInteger(refReps) && refReps >= 1 && refReps <= 15)) {
          toast('Reference reps must be a whole number from 1 to 15', 'error');
          return false;
        }
        const fraction = fractionInput.value.trim() === '' ? null : Number(fractionInput.value);
        if (fraction != null && !(fraction >= 0 && fraction <= 1.2)) {
          toast('Bodyweight fraction must be between 0 and 1.2', 'error');
          return false;
        }
        // Optional fields: set when given, removed when cleared, and left
        // exactly as stored when untouched.
        const setOpt = (k, v) => { if (v == null || v === '') delete draft[k]; else draft[k] = v; };
        // GIFs: set or clear; an upload that's been replaced or removed goes.
        setOpt('gif', gifs.exercise);
        if (draft.variants?.length) {
          draft.variants = draft.variants.map((v, i) => {
            const { gif: _old, ...rest } = v;
            return gifs.variants[i] ? { ...rest, gif: gifs.variants[i] } : rest;
          });
        }
        const kept = new Set([gifs.exercise, ...gifs.variants]);
        for (const ref of [startGifs.exercise, ...startGifs.variants, ...fresh]) if (!kept.has(ref)) removeUpload(ref);
        setOpt('loadModel', loadSel.value);
        if (refRepsInput.value !== shownLoad.referenceReps) setOpt('referenceReps', refReps);
        if (fractionInput.value !== shownLoad.bodyweightFraction) setOpt('bodyweightFraction', fraction);
        Object.assign(draft, {
          name: nameInput.value.trim(),
          category: catSel.value,
          modality: modSel.value,
          measurementType: measSel.value,
          // Untouched fields keep their stored lists exactly.
          primaryTargets: musclesInput.value === shown.muscles ? draft.primaryTargets ?? [] : split(musclesInput.value),
          equipment: equipInput.value === shown.equipment ? draft.equipment ?? []
            : equipInput.value.split('\n').map((x) => x.trim()).filter(Boolean),
          positions: positionBoxes.filter((x) => x.box.checked).map((x) => x.box.value),
          description: descInput.value.trim(),
        });
        store.upsert('exercises', draft);
        onSaved?.(draft);
      },
    },
  ]);
}
