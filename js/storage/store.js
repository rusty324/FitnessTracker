// The only data API the UI touches. Everything generic — cache-first reads,
// sha-checked PUTs, the offline queue, conflict merging, encryption — lives in
// the reusable ghsync package (../../ghsync/README.md). This file is the
// fitness-tracker-specific layer on top: which collections exist, and the
// activity shards + correction overlay that don't fit the collection model.
//
// Write ownership (the reason browser/Actions conflicts can't happen):
//   - browser owns everything in DATA_FILES (incl. matches.json, activity-edits.json)
//   - the Polar sync workflow owns data/activities/** — read-only here
//   - the browser owns data/imported/** (file imports)

import { createStore } from '../../ghsync/store.js';
import { createBlobStore } from '../../ghsync/blobs.js';
import { migratePlan, migrateExercise } from '../models.js';
import {
  DATA_FILES, ACTIVITY_DIR, IMPORT_DIR, LEGACY_STRAVA_DIR, DATA_REPO_DEFAULT,
} from '../config.js';

// Cached list of every activity shard path we know about, across all dirs.
const ACTIVITY_INDEX = 'ft.activity.index';

const gh = createStore({
  appId: 'ft',
  files: DATA_FILES,
  // Personal data is encrypted when a password is set; plans, the exercise
  // library, and match links stay plaintext so they remain diffable.
  encrypted: ['logs', 'metrics', 'goals', 'activityEdits', 'gear', 'sessions', 'schedule'],
  encryptPath: (path) =>
    path.startsWith(`${ACTIVITY_DIR}/activities-`)
    || path.startsWith(`${IMPORT_DIR}/imported-`)
    || path.startsWith(`${LEGACY_STRAVA_DIR}/activities-`),
  // Records written by the app's first version are upgraded transparently;
  // the migrated shape is persisted whenever the user next saves.
  migrate: { plans: migratePlan, exercises: migrateExercise },
  defaultRepo: DATA_REPO_DEFAULT,
  // Activity shards are app-owned paths outside DATA_FILES, so ghsync needs
  // to be told about them when re-encrypting or seeding a repo.
  extraPaths: () => gh.readFile(ACTIVITY_INDEX) ?? [],
  onRefresh: async () => {
    await refreshActivities();
    // Uploaded exercise GIFs added on another device.
    await media.mirror().catch(() => {});
  },
});

// Exercise GIFs uploaded from a device: one repo file per GIF under
// data/media/ (bytes kept as-is so they stay animated), mirrored to
// IndexedDB so they show offline. Exercises hold "media:<id>" in their `gif`
// field. Not personal, so not encrypted.
export const media = createBlobStore(gh, { dbName: 'ft.media', dir: 'data/media', kind: 'media' });

export const {
  getDataRepo, setDataRepo, hasDataRepo,
  getToken, setToken, hasToken,
  setPassword, encryption,
  save, upsert, remove,
  onChange, syncStatus, refreshStatus,
  refresh, flushQueue, rewriteEncryptedFiles, init,
  client,
} = gh;

// Seeding a newly connected repo also uploads the GIFs this device holds.
export async function pushAllData(...args) {
  const r = await gh.pushAllData(...args);
  await media.pushAll(true);
  return r;
}

// ---------- removals that can be undone ----------
// Deleting a log (or other record) is held pending for a few seconds so it
// can be undone (js/ui/components.js undoToast). While pending, get() hides
// it everywhere; the real remove happens only on commit — on expiry, or at
// pagehide. A crash before then leaves the record in place: the safe failure.
const hidden = new Map(); // collection -> Set of ids

export function get(collection) {
  const rows = gh.get(collection);
  const h = hidden.get(collection);
  return h?.size ? rows.filter((r) => !h.has(r.id)) : rows;
}

// -> { commit(), undo() }; each runs once.
export function removeLater(collection, id) {
  const original = gh.get(collection).find((r) => r.id === id);
  if (!hidden.has(collection)) hidden.set(collection, new Set());
  hidden.get(collection).add(id);
  gh.emit({ type: 'changed', collection });
  let settled = false;
  const unhide = () => hidden.get(collection)?.delete(id);
  return {
    commit() {
      if (settled) return;
      settled = true;
      unhide();
      gh.remove(collection, id);
    },
    undo() {
      if (settled) return;
      settled = true;
      unhide();
      // Something may have saved the collection (without the hidden record)
      // in the meantime; put it back if so.
      if (original && !gh.get(collection).some((r) => r.id === id)) gh.upsert(collection, original);
      else gh.emit({ type: 'changed', collection });
    },
  };
}

// ---------- activities ----------

// Every activity across cached month shards, newest first. Merges the
// Actions-written directory, browser-written imports, and legacy Strava
// shards. Deduped by id in case the same activity arrived twice (e.g. synced
// and then also imported from a file).
export function getActivityEntries() {
  const byId = new Map();
  for (const p of gh.readFile(ACTIVITY_INDEX) ?? []) {
    const shard = gh.readFile(p);
    if (Array.isArray(shard)) for (const e of shard) byId.set(e.id, e);
  }
  // Apply the user's corrections. They live in a browser-owned overlay file
  // rather than in the shards, because data/activities/** belongs to the sync
  // workflow — same reasoning as matches.json. Re-syncing an activity
  // therefore never undoes an edit.
  for (const edit of get('activityEdits')) {
    if (!byId.has(edit.id)) continue;
    if (edit.hidden) { byId.delete(edit.id); continue; }
    const { id, updatedAt, hidden, ...fields } = edit;
    byId.set(id, { ...byId.get(id), ...fields, edited: true });
  }
  return [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

// The one unedited copy of an activity, for "reset to original".
export function getActivityOriginal(id) {
  for (const p of gh.readFile(ACTIVITY_INDEX) ?? []) {
    const found = (gh.readFile(p) ?? []).find((e) => e.id === id);
    if (found) return found;
  }
  return null;
}

// Pull month shards from all three activity directories. Locally-dirty
// imports are skipped so an unpushed import isn't clobbered by the remote.
export async function refreshActivities() {
  const dirs = [
    { dir: ACTIVITY_DIR, prefix: 'activities-' },
    { dir: IMPORT_DIR, prefix: 'imported-' },
    { dir: LEGACY_STRAVA_DIR, prefix: 'activities-' },
  ];
  const index = [];
  let changed = false;
  for (const { dir, prefix } of dirs) {
    const re = new RegExp(`^${prefix}\\d{4}-\\d{2}\\.json$`);
    const res = await gh.refreshDir(dir, (name) => re.test(name));
    index.push(...res.paths);
    changed = changed || res.changed;
  }
  // Keep any locally-created import shards that aren't on the remote yet.
  for (const p of gh.readFile(ACTIVITY_INDEX) ?? []) {
    if (!index.includes(p) && gh.cache.isDirty(p)) index.push(p);
  }
  gh.cache.setData(ACTIVITY_INDEX, index);
  if (changed) gh.emit({ type: 'changed', collection: 'activities' });
  return changed;
}

// Add imported activities to the browser-owned import shards, keyed by local
// month and deduped by id. Returns how many were new.
export async function addImportedActivities(entries) {
  const byMonth = new Map();
  for (const e of entries) {
    const path = `${IMPORT_DIR}/imported-${e.date.slice(0, 7)}.json`;
    if (!byMonth.has(path)) byMonth.set(path, []);
    byMonth.get(path).push(e);
  }
  let added = 0;
  const index = (gh.readFile(ACTIVITY_INDEX) ?? []).slice();
  for (const [path, incoming] of byMonth) {
    const existing = gh.readFile(path) ?? [];
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const e of incoming) {
      if (!byId.has(e.id)) added++;
      byId.set(e.id, e);
    }
    await gh.writeFile(path, [...byId.values()].sort((a, b) => (a.date < b.date ? -1 : 1)));
    if (!index.includes(path)) index.push(path);
  }
  gh.cache.setData(ACTIVITY_INDEX, index);
  gh.emit({ type: 'changed', collection: 'activities' });
  return added;
}

// ---------- activity corrections ----------

// Store only the fields that actually differ from the synced/imported record,
// so a field the user didn't touch still tracks its source.
export async function editActivity(id, fields) {
  const original = getActivityOriginal(id);
  const changed = {};
  for (const [k, v] of Object.entries(fields)) {
    if (original && (original[k] ?? null) === (v ?? null)) continue;
    changed[k] = v ?? null;
  }
  const existing = get('activityEdits').find((e) => e.id === id);
  if (!Object.keys(changed).length && !existing) return;
  if (!Object.keys(changed).length) return resetActivity(id);
  await upsert('activityEdits', { id, ...changed, updatedAt: new Date().toISOString() });
}

export async function resetActivity(id) {
  await remove('activityEdits', id);
}

export function activityEdit(id) {
  return get('activityEdits').find((e) => e.id === id) ?? null;
}

// Imports are browser-owned, so they really are deleted. Anything from the
// sync workflow lives in a file this app must not write, so it is hidden
// through the overlay instead — and stays hidden if it syncs again.
export async function removeActivity(id) {
  let deleted = false;
  for (const path of gh.readFile(ACTIVITY_INDEX) ?? []) {
    if (!path.startsWith(`${IMPORT_DIR}/`)) continue;
    const shard = gh.readFile(path) ?? [];
    if (!shard.some((e) => e.id === id)) continue;
    await gh.writeFile(path, shard.filter((e) => e.id !== id));
    deleted = true;
  }
  if (deleted) await resetActivity(id);
  else await upsert('activityEdits', { id, hidden: true, updatedAt: new Date().toISOString() });
  gh.emit({ type: 'changed', collection: 'activities' });
  return deleted ? 'deleted' : 'hidden';
}
