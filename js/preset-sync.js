// Once per page load: bring the user's exercise library up to date with the
// bundled starter packs and plans (presets/), without ever adding exercises,
// un-archiving, or overwriting anything the user filled in.
//
//   1. The Push-Up ladder migration. The packs used to ship Push-Up as
//      Knee → … → One-Arm, but the 26-week plan's variantLevels were written
//      for a ladder starting at Wall push-ups, and import matches exercises
//      by name, so level 3 in the plan meant Diamond. The packs now ship the
//      full Wall → One-Arm ladder. A library still holding exactly the old
//      ladder gets the new one; an edited ladder is left alone (with a
//      one-time note), because merging by level would mislabel the user's.
//   2. Empty fields filled from the packs (libraryUpserter({create:false})):
//      muscles, equipment, positions, and the load-metric fields
//      (loadModel, referenceReps, bodyweightFraction — js/load.js).

import * as store from './storage/store.js';
import { loadManifest, loadPreset } from './presets.js';
import { libraryUpserter } from './ui/plans-tab.js';
import { toast } from './ui/components.js';

// The ladder the packs shipped before the fix, levels 1..7.
export const OLD_PUSH_UP_LADDER = [
  'Knee Push-Up', 'Standard Push-Up', 'Diamond (Triceps) Push-Up', 'Archer Push-Up',
  'Typewriter Push-Up', 'One-Arm Push-Up (Assisted)', 'One-Arm Push-Up (Full)',
];
const NOTICE_KEY = 'ft.pushUpLadderNotice';

const ladderOf = (variants) => [...(variants ?? [])].sort((a, b) => a.level - b.level);
const sameLadder = (variants, names) => {
  const v = ladderOf(variants);
  return v.length === names.length
    && v.every((x, i) => x.level === i + 1 && (x.name ?? '').toLowerCase() === names[i].toLowerCase());
};

// Pure: the migrated library, and whether an edited ladder was left alone.
export function migratePushUpLadder(library, newPushUp) {
  const i = library.findIndex((e) => (e.name ?? '').toLowerCase() === 'push-up');
  const rec = library[i];
  if (!rec?.variants?.length || !newPushUp?.variants?.length) return { library, changed: false, edited: false };
  if (sameLadder(rec.variants, OLD_PUSH_UP_LADDER)) {
    const next = library.slice();
    next[i] = { ...rec, variants: JSON.parse(JSON.stringify(newPushUp.variants)) };
    return { library: next, changed: true, edited: false };
  }
  const isNew = sameLadder(rec.variants, ladderOf(newPushUp.variants).map((v) => v.name));
  return { library, changed: false, edited: !isNew };
}

let started = null;
export function syncFromPresets() {
  if (!started) started = run().catch(() => {
    // Offline, or the presets moved: everything works with what's there.
  });
  return started;
}

async function run() {
  if (!store.get('exercises').length) return;
  const manifest = await loadManifest();
  const defs = [];
  for (const file of [...(manifest.exercisePacks ?? []), ...(manifest.plans ?? [])].map((x) => x.file)) {
    const data = await loadPreset(file);
    for (const def of Object.values(data.exerciseLibrary ?? {})) if (def?.name) defs.push(def);
  }

  const newPushUp = defs.find((d) => d.name.toLowerCase() === 'push-up' && d.variants?.length);
  const m = migratePushUpLadder(store.get('exercises'), newPushUp);
  if (m.changed) {
    store.save('exercises', m.library);
    toast('Updated the Push-Up ladder to start at wall push-ups, so plan variant levels match (level 3 is now Low Incline, not Diamond)');
  } else if (m.edited && !localStorage.getItem(NOTICE_KEY)) {
    try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* private mode */ }
    toast('Your Push-Up ladder has been edited, so it was left as is. The starter plan’s push-up levels assume the Wall → One-Arm ladder in the Running & Calisthenics pack.');
  }

  const up = libraryUpserter({ create: false });
  for (const def of defs) up.resolve(def);
  up.commit();
  if (up.stats.enriched) {
    toast(`Filled in muscles, equipment, positions and load settings for ${up.stats.enriched} exercise${up.stats.enriched === 1 ? '' : 's'} from the starter packs`);
  }
}
