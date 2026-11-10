// Gym-floor drafts. Ticking a set writes here (localStorage), not to the data
// repo: a commit per set would be slow and noisy. A draft becomes logs when
// an exercise is completed, on "Finish session", and when the page is hidden
// (pagehide / visibilitychange) — so a reload or an iOS app kill loses
// nothing, and drafts left from an earlier day are written out on the next
// load.
//
// Key: ft.draft.<date>.<plannedSessionId | 'adhoc'>
// Value: { items: { [key]: { exerciseId, planId, plannedExerciseId,
//          variantLevel, rows, showWeight, logId } } }
// ghsync coalesces rapid saves of a file into chained pushes, so a flush that
// upserts several logs costs a few pushes at most.

import * as store from './storage/store.js';
import { makeLogEntry } from './models.js';
import { actualFromRows } from './ui/set-rows.js';

const PREFIX = 'ft.draft.';
export const draftKey = (date, sessionId) => `${PREFIX}${date}.${sessionId ?? 'adhoc'}`;

export function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? { items: {} }; } catch { return { items: {} }; }
}
function writeDraft(key, draft) {
  try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* storage full or blocked */ }
}
export function clearDraft(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export function removeDraftItem(key, itemKey) {
  const draft = readDraft(key);
  delete draft.items[itemKey];
  if (Object.keys(draft.items).length) writeDraft(key, draft);
  else clearDraft(key);
}

export function updateDraftItem(key, itemKey, patch) {
  const draft = readDraft(key);
  draft.items[itemKey] = { ...(draft.items[itemKey] ?? {}), ...patch };
  writeDraft(key, draft);
  return draft.items[itemKey];
}

// Write one draft item as a log (create, or update the one it made before).
// Returns the log id, or null when nothing is ticked yet.
export function flushItem(key, itemKey) {
  const draft = readDraft(key);
  const item = draft.items[itemKey];
  if (!item?.rows?.some((r) => r.done)) return null;
  const date = key.slice(PREFIX.length).split('.')[0];
  const actual = actualFromRows(item.rows, { showWeight: item.showWeight });
  if (item.variantLevel != null) actual.variantLevel = item.variantLevel;
  const existing = item.logId ? store.get('logs').find((l) => l.id === item.logId) : null;
  if (existing && JSON.stringify(existing.actual) === JSON.stringify(actual)) return existing.id;
  const log = existing
    ? { ...existing, actual }
    : {
        ...makeLogEntry({
          date,
          planId: item.planId ?? null,
          plannedExerciseId: item.plannedExerciseId ?? null,
          exerciseId: item.exerciseId,
          actual,
        }),
        // The log form reserves its entry's id up front, so a flush here and
        // its own Save later write the same log, never two.
        ...(item.logId ? { id: item.logId } : {}),
      };
  store.upsert('logs', log);
  if (!item.logId) updateDraftItem(key, itemKey, { logId: log.id });
  return log.id;
}

export function flushDraft(key) {
  for (const itemKey of Object.keys(readDraft(key).items)) flushItem(key, itemKey);
}

export function allDraftKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
  } catch { /* ignore */ }
  return keys;
}

// Every draft written out; drafts from before `today` are then dropped.
export function flushAll(today) {
  for (const key of allDraftKeys()) {
    flushDraft(key);
    const date = key.slice(PREFIX.length).split('.')[0];
    if (today && date < today) clearDraft(key);
  }
}

let installed = false;
export function installDraftFlush(todayFn) {
  if (installed) return;
  installed = true;
  addEventListener('pagehide', () => flushAll());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  flushAll(todayFn());
}
