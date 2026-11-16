// Plan import / export in the fitness-tracker-plan v2 schema (v1 still
// imports), and libraryUpserter for exercises that arrive with a plan.
import { makeBlock, makeBlockItem, makeExercise, makePlan, makeSession, sanitizeCategory, sanitizeMeasurement, sanitizeModality } from '../../models.js';
import * as store from '../../storage/store.js';
import { render, slug } from '../plans-tab.js';
import { downloadJson, el, filePicker, openModal, toast } from '../components.js';
import { placeSession } from './session-editor.js';
import { todayStr } from '../../dates.js';
import { loadManifest, loadPreset } from '../../presets.js';
import { S } from './state.js';

// Drop empty optional fields so exported files stay tidy.
export function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

// Serialize one library record as a v2-schema exercise definition.
export function exerciseDef(ex) {
  const def = prune({
    name: ex?.name ?? 'Unknown exercise',
    shortName: ex?.shortName,
    category: sanitizeCategory(ex?.category),
    modality: ex?.modality,
    measurementType: sanitizeMeasurement(ex?.measurementType),
    perSide: ex?.perSide || undefined,
    equipment: ex?.equipment,
    primaryTargets: ex?.primaryTargets,
    positions: ex?.positions,
    cues: ex?.cues,
    whyItsHere: ex?.whyItsHere,
    safetyNotes: ex?.safetyNotes,
    variants: ex?.variants, // per-variant bodyweightFraction included
    progressionRule: ex?.progressionRule,
    videoSearchTerm: ex?.videoSearchTerm,
    loadModel: ex?.loadModel,
    referenceReps: ex?.referenceReps,
    bodyweightFraction: ex?.bodyweightFraction,
  });
  def.description = ex?.description ?? ''; // required by schema
  return def;
}

export function serializePlan(plan) {
  const lib = new Map(store.get('exercises').map((e) => [e.id, e]));
  const idToKey = new Map();
  const exerciseLibrary = {};
  const keyFor = (exerciseId) => {
    if (idToKey.has(exerciseId)) return idToKey.get(exerciseId);
    const ex = lib.get(exerciseId);
    let key = slug(ex?.name ?? 'exercise');
    while (exerciseLibrary[key]) key += '_2';
    exerciseLibrary[key] = exerciseDef(ex);
    idToKey.set(exerciseId, key);
    return key;
  };

  const weeks = (plan.weeks ?? []).map((w) => prune({
    index: w.index,
    phaseId: w.phaseId,
    focus: w.focus,
    isDeload: w.isDeload || undefined,
    note: w.note,
    sessions: w.sessions.map((s) => prune({
      id: s.id,
      label: s.label || 'Session',
      dayOffset: s.dayOffset ?? (w.index - 1) * 7,
      sessionType: s.sessionType,
      estimatedDurationMin: s.estimatedDurationMin,
      note: s.note,
      blocks: (s.blocks ?? []).map((b) => prune({
        type: b.type,
        name: b.name,
        note: b.note,
        rounds: b.rounds,
        items: (b.items ?? []).map((item) => prune({
          exerciseId: keyFor(item.exerciseId),
          target: item.target ?? { kind: 'reps', reps: 1 },
          note: item.note,
          optional: item.optional || undefined,
        })),
      })),
    })),
  }));

  return {
    format: 'fitness-tracker-plan',
    formatVersion: 2,
    plan: prune({
      id: slug(plan.name),
      name: plan.name,
      description: plan.description,
      goal: plan.goal,
      level: plan.level,
      durationWeeks: Math.max(1, ...(plan.weeks ?? []).map((w) => w.index)),
      tags: plan.type && plan.type !== 'custom' ? [plan.type] : undefined,
      assumptions: plan.assumptions,
    }),
    ...(plan.settings ? { settings: plan.settings } : {}),
    ...(plan.progressionPolicy ? { progressionPolicy: plan.progressionPolicy } : {}),
    ...(plan.formCues ? { formCues: plan.formCues } : {}),
    ...(plan.phases?.length ? { phases: plan.phases } : {}),
    exerciseLibrary,
    weeks,
  };
}

export function exportPlan(plan) {
  const fileSlug = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan';
  downloadJson(`${fileSlug}.plan.json`, serializePlan(plan));
  toast('Exported — edit the file as a template and re-import it anytime');
}

// Accepts v2 schema files (weeks/exerciseLibrary) and legacy v1 templates
// (flat sessions with inline exercises). Exercises are matched to the
// library by name (case-insensitive); missing ones are created.
export function importPlan(data, startDate) {
  if (!data || typeof data !== 'object') throw new Error('Not a plan file');
  if (data.formatVersion === 2 || data.weeks) return importPlanV2(data, startDate);
  if (typeof data.name === 'string' && Array.isArray(data.sessions)) return importPlanV1(data, startDate);
  throw new Error('Unrecognized plan format — expected fitness-tracker-plan v1 or v2');
}

// opts.create: add exercises the library doesn't have (an import). false =
// only fill empty fields on ones it does — how missing positions are filled
// in from the bundled packs without adding anything or un-archiving.
export function libraryUpserter({ create = true } = {}) {
  const library = store.get('exercises').slice();
  const byName = new Map(library.map((e) => [e.name.toLowerCase(), e]));
  let changed = false;
  const stats = { created: 0, enriched: 0 };
  return {
    stats,
    // def: v2 exercise definition (or minimal {name,...}). Returns record id.
    resolve(def) {
      const name = (def.name ?? '').trim() || 'Exercise';
      let rec = byName.get(name.toLowerCase());
      const wasNew = !rec;
      if (!rec && !create) return null;
      if (!rec) {
        rec = {
          ...makeExercise({ name }),
          category: sanitizeCategory(def.category),
          modality: sanitizeModality(def.modality),
          measurementType: sanitizeMeasurement(def.measurementType ?? def.defaultUnit),
        };
        library.push(rec);
        byName.set(name.toLowerCase(), rec);
        changed = true;
        stats.created++;
      }
      // Enrich empty fields from the richer imported definition — user edits win.
      let enriched = false;
      for (const k of ['shortName', 'description', 'whyItsHere', 'progressionRule', 'videoSearchTerm']) {
        if (def[k] && !rec[k]) { rec[k] = def[k]; changed = true; enriched = true; }
      }
      for (const k of ['cues', 'safetyNotes', 'variants', 'equipment', 'primaryTargets', 'positions']) {
        if (def[k]?.length && !rec[k]?.length) { rec[k] = def[k]; changed = true; enriched = true; }
      }
      if (def.perSide && !rec.perSide) { rec.perSide = true; changed = true; enriched = true; }
      // Load-metric settings (js/load.js).
      for (const k of ['loadModel', 'referenceReps', 'bodyweightFraction']) {
        if (def[k] != null && rec[k] == null) { rec[k] = def[k]; changed = true; enriched = true; }
      }
      // Per-variant body-weight fractions, for a ladder the record already
      // has: only where the variant at that level has the same name (a
      // different name means a different movement), and only where the
      // record has no fraction yet — null included, which is a choice.
      if (rec.variants?.length && def.variants?.length) {
        for (const v of rec.variants) {
          if ('bodyweightFraction' in v) continue;
          const d = def.variants.find((x) => x.level === v.level);
          if (d && 'bodyweightFraction' in d && (d.name ?? '').toLowerCase() === (v.name ?? '').toLowerCase()) {
            v.bodyweightFraction = d.bodyweightFraction;
            changed = true;
            enriched = true;
          }
        }
      }
      // Importing a plan that uses an archived exercise puts it back in play.
      if (rec.archived && create) { rec.archived = false; changed = true; enriched = true; }
      if (enriched && !wasNew) stats.enriched++;
      return rec.id;
    },
    commit() {
      if (changed) store.save('exercises', library);
    },
  };
}

export function importPlanV2(data, startDate) {
  if (data.format !== 'fitness-tracker-plan') throw new Error('Not a fitness-tracker-plan file');
  if (!data.plan?.name || !Array.isArray(data.weeks) || !data.exerciseLibrary) {
    throw new Error('Plan file is missing plan/name, exerciseLibrary, or weeks');
  }
  const lib = libraryUpserter();
  const keyToId = new Map();
  for (const [key, def] of Object.entries(data.exerciseLibrary)) {
    keyToId.set(key, lib.resolve(def));
  }
  const resolveExercise = (key) => {
    const id = keyToId.get(key);
    if (!id) throw new Error(`Plan references unknown exercise "${key}"`);
    return id;
  };

  // Materialize block templates at import: a session block with templateId
  // inherits the template's fields, its own fields winning.
  const templates = data.blockTemplates ?? {};
  const materialize = (block) => {
    const base = block.templateId ? templates[block.templateId] ?? {} : {};
    const merged = { ...base, ...prune(block) };
    return {
      ...makeBlock({ type: merged.type ?? 'main', name: merged.name ?? '' }),
      note: merged.note ?? '',
      ...(merged.rounds ? { rounds: merged.rounds } : {}),
      items: (merged.items ?? []).map((item) => ({
        ...makeBlockItem({
          exerciseId: resolveExercise(item.exerciseId),
          target: item.target ?? {},
          note: item.note ?? '',
          optional: !!item.optional,
        }),
      })),
    };
  };

  const plan = {
    ...makePlan({ name: data.plan.name, type: data.plan.tags?.[0] ?? 'custom', startDate }),
    description: data.plan.description ?? '',
    goal: data.plan.goal ?? '',
    level: data.plan.level ?? null,
    assumptions: data.plan.assumptions ?? [],
    settings: data.settings,
    progressionPolicy: data.progressionPolicy,
    formCues: data.formCues,
    phases: data.phases ?? [],
    weeks: data.weeks.map((w) => ({
      index: w.index,
      ...(w.phaseId ? { phaseId: w.phaseId } : {}),
      ...(w.focus ? { focus: w.focus } : {}),
      ...(w.isDeload ? { isDeload: true } : {}),
      ...(w.note ? { note: w.note } : {}),
      sessions: (w.sessions ?? []).map((s, si) => ({
        ...makeSession({
          label: s.label ?? '',
          dayOffset: s.dayOffset ?? (w.index - 1) * 7 + (s.dayInWeek ?? si),
        }),
        ...(s.sessionType ? { sessionType: s.sessionType } : {}),
        ...(s.estimatedDurationMin ? { estimatedDurationMin: s.estimatedDurationMin } : {}),
        note: s.note ?? '',
        blocks: (s.blocks ?? []).map(materialize),
      })),
    })),
  };
  lib.commit();
  store.upsert('plans', plan);
  return plan;
}

// Legacy v1 template: { name, type, sessions: [{label, dayOffset, exercises:[{name,category,defaultUnit,target}]}] }
export function importPlanV1(data, startDate) {
  const lib = libraryUpserter();
  const plan = makePlan({ name: data.name, type: data.type || 'custom', startDate });
  for (const s of data.sessions) {
    const session = makeSession({
      label: typeof s.label === 'string' ? s.label : '',
      dayOffset: Number.isFinite(Number(s.dayOffset)) ? Number(s.dayOffset) : 0,
    });
    const block = makeBlock({ type: 'main' });
    for (const def of s.exercises ?? s.plannedExercises ?? []) {
      block.items.push(makeBlockItem({
        exerciseId: lib.resolve(def),
        target: def.target && typeof def.target === 'object' ? def.target : {},
      }));
    }
    session.blocks.push(block);
    placeSession(plan, session);
  }
  lib.commit();
  store.upsert('plans', plan);
  return plan;
}

export function importPlanModal() {
  const textarea = el('textarea', {
    placeholder: 'Paste a plan JSON here, or pick a file below…',
    style: 'min-height:140px;font-family:monospace;font-size:0.8rem',
  });
  const fileInput = filePicker({
    onchange: () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      f.text().then((t) => { textarea.value = t; }).catch(() => toast('Could not read file', 'error'));
    },
  });
  const dateInput = el('input', { type: 'date', value: todayStr() });

  // Starter plans bundled with the site; tapping one imports it directly
  // using the start date above, without round-tripping through the textarea.
  const presetList = el('div', {}, el('p', { class: 'muted' }, 'Loading starter plans…'));
  let modal;
  loadManifest().then((manifest) => {
    presetList.innerHTML = '';
    for (const p of manifest.plans ?? []) {
      presetList.appendChild(el('div', { class: 'list-row tappable', onclick: async () => {
        try {
          const data = await loadPreset(p.file);
          const plan = importPlan(data, dateInput.value || todayStr());
          modal.close();
          toast(`Imported “${plan.name}”`);
          S.view = { name: 'plan', planId: plan.id };
          render();
        } catch (e) {
          toast(e.message, 'error');
        }
      } },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, p.name),
          el('div', { class: 'row-sub' },
            [p.weeks && `${p.weeks} week${p.weeks === 1 ? '' : 's'}`,
              p.sessions && `${p.sessions} sessions`, p.level].filter(Boolean).join(' · ')),
          p.description && el('div', { class: 'row-sub' }, p.description),
        ),
      ));
    }
    if (!manifest.plans?.length) presetList.appendChild(el('p', { class: 'muted' }, 'No starter plans available.'));
  }).catch(() => {
    presetList.innerHTML = '';
    presetList.appendChild(el('p', { class: 'muted' }, 'Starter plans unavailable offline.'));
  });

  modal = openModal('Import plan', el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Start date (day 0 of the plan)'), dateInput),
    el('h3', {}, 'Starter plans'),
    presetList,
    el('h3', {}, 'Or paste your own'),
    el('div', { class: 'field' }, textarea),
    el('div', { class: 'field' }, el('label', {}, 'Or choose a file'), fileInput),
    el('p', { class: 'muted' },
      'Accepts fitness-tracker-plan v2 files (and older v1 templates). ',
      'Exercises are matched to your library by name; missing ones are created with their full descriptions.'),
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
          const plan = importPlan(data, dateInput.value || todayStr());
          toast(`Imported “${plan.name}”`);
          S.view = { name: 'plan', planId: plan.id };
          render();
        } catch (e) {
          toast(e.message, 'error');
          return false;
        }
      },
    },
  ]);
}
