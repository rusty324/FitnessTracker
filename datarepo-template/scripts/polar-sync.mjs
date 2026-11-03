#!/usr/bin/env node
// Polar AccessLink → repo sync. Run by .github/workflows/polar-sync.yml on a
// schedule (and via workflow_dispatch). Zero npm dependencies — Node 18+
// global fetch. Replaces the old Strava sync, which stopped being viable when
// Strava paywalled its API in June 2026.
//
// Secrets:   POLAR_ACCESS_TOKEN, POLAR_USER_ID
//            ENCRYPTION_PASSWORD (only if the app's encryption is on)
// Variables (optional — see README):
//   SYNC_TYPES           Comma-separated sport allowlist, e.g. "RUNNING,CYCLING".
//                        Unset keeps every type.
//   SYNC_MAX_ACTIVITIES  Safety cap per run (default 200). Warned about if hit.
//
// Writes: data/activities/activities-YYYY-MM.json (one shard per month, keyed
//         by the activity's LOCAL date) and data/activities/sync-state.json.
//         `data` is the DATA_DIR repo variable when one is set.
// The browser never writes these files, so there is exactly one writer.
// (File imports from the app go to data/imported/ instead.)
//
// Two Polar constraints shape this script:
//   1. Only exercises uploaded to Flow in the last ~30 days are available,
//      and only ones uploaded after this client was registered. There is no
//      historical backfill, which is why there's no date-floor variable.
//   2. Transactional endpoints DISCARD data once committed. So the
//      non-transactional list is used where possible, and any transaction is
//      committed only AFTER the shards are written — see syncOnce() below.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptJson, decryptJson, isEnvelope, DecryptError } from './crypto.js';

const API = 'https://www.polaraccesslink.com';
// Must match "Folder in the repo" in the app's Settings, set here as the repo
// variable DATA_DIR: unset means `data`, `/` means the repo root.
const DATA_DIR = String(process.env.DATA_DIR || 'data').trim().replace(/^\/+|\/+$/g, '');
if (DATA_DIR.split('/').some((s) => s === '..' || s === '.')) {
  console.error(`Invalid DATA_DIR: ${process.env.DATA_DIR}`);
  process.exit(1);
}
const ACTIVITY_DIR = join(process.cwd(), DATA_DIR, 'activities');
const STATE_PATH = join(ACTIVITY_DIR, 'sync-state.json');

const {
  POLAR_ACCESS_TOKEN, POLAR_USER_ID, ENCRYPTION_PASSWORD,
  SYNC_TYPES, SYNC_MAX_ACTIVITIES,
} = process.env;

if (!POLAR_ACCESS_TOKEN || !POLAR_USER_ID) {
  console.error('Missing POLAR_ACCESS_TOKEN / POLAR_USER_ID.');
  console.error('Run the one-time OAuth bootstrap in datarepo-template/README.md, then set both as repo secrets.');
  process.exit(1);
}

const maxActivities = Math.max(1, parseInt(SYNC_MAX_ACTIVITIES ?? '200', 10) || 200);
const typeFilter = (SYNC_TYPES ?? '')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

// ---------- HTTP ----------

async function polar(path, { method = 'GET', accept = 'application/json' } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${POLAR_ACCESS_TOKEN}`, Accept: accept },
  });
  if (res.status === 401 || res.status === 403) {
    console.error(`Polar rejected the access token (${res.status}).`);
    console.error('Tokens are revoked if you remove the app in Polar Flow. Re-run the OAuth bootstrap in');
    console.error('datarepo-template/README.md and update the POLAR_ACCESS_TOKEN secret.');
    process.exit(1);
  }
  if (res.status === 429) {
    // Dynamic rate limits; the schedule will pick it up next run.
    console.warn('Rate limited by Polar (429). Skipping this run.');
    process.exit(0);
  }
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Polar ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return accept === 'application/json' ? res.json() : res.text();
}

// ---------- helpers ----------

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// Shards may be encrypted (the app's optional password). Never write a
// plaintext shard next to encrypted ones — fail loudly instead.
async function readShard(path) {
  const parsed = await readJson(path, []);
  if (!isEnvelope(parsed)) return parsed;
  if (!ENCRYPTION_PASSWORD) {
    console.error(`${path} is encrypted but the ENCRYPTION_PASSWORD secret is not set.`);
    console.error('Add the same password used in the app as a repo secret named ENCRYPTION_PASSWORD.');
    process.exit(1);
  }
  try {
    return await decryptJson(parsed, ENCRYPTION_PASSWORD);
  } catch (e) {
    if (e instanceof DecryptError) {
      console.error(`${path}: ENCRYPTION_PASSWORD does not match the password the file was encrypted with.`);
      process.exit(1);
    }
    throw e;
  }
}

async function writeShard(path, entries) {
  const body = ENCRYPTION_PASSWORD ? await encryptJson(entries, ENCRYPTION_PASSWORD) : entries;
  await writeFile(path, JSON.stringify(body, null, 2) + '\n');
}

// Polar reports durations as ISO-8601, e.g. "PT1H2M3.5S".
export function parseIsoDuration(s) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const [, d, h, min, sec] = m;
  const total = (+(d ?? 0)) * 86400 + (+(h ?? 0)) * 3600 + (+(min ?? 0)) * 60 + Math.round(+(sec ?? 0));
  return total > 0 ? total : null;
}

// GPX trackpoints -> [[lat, lng], ...]. Regex rather than an XML parser keeps
// this dependency-free; GPX attribute order is fixed enough in practice, and
// a miss just means the activity has no route rather than a crash.
function gpxToPoints(gpx) {
  const points = [];
  const re = /<trkpt[^>]*\blat="([-\d.]+)"[^>]*\blon="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(gpx))) points.push([parseFloat(m[1]), parseFloat(m[2])]);
  return points;
}

function py2Round(v) {
  return Math.floor(Math.abs(v) + 0.5) * (v >= 0 ? 1 : -1);
}
function encodeDelta(current, previous, factor) {
  let c = (py2Round(current * factor) - py2Round(previous * factor)) * 2;
  if (c < 0) c = -c - 1;
  let out = '';
  while (c >= 0x20) {
    out += String.fromCharCode((0x20 | (c & 0x1f)) + 63);
    c = Math.floor(c / 32);
  }
  return out + String.fromCharCode(c + 63);
}
// Same format the browser's heatmap decoder expects (precision 5).
function encodePolyline(points) {
  let out = '';
  let lat = 0;
  let lng = 0;
  for (const [la, ln] of points) {
    out += encodeDelta(la, lat, 1e5);
    out += encodeDelta(ln, lng, 1e5);
    lat = la;
    lng = ln;
  }
  return out;
}
function downsample(points, max = 500) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// Map a Polar exercise summary to the app's activity record shape. `start-time`
// is already local, matching how shards are keyed by local month.
export function mapExercise(ex) {
  const distance = Number(ex.distance);
  return {
    id: `polar-${ex.id}`,
    sourceId: String(ex.id),
    date: String(ex['start-time']).slice(0, 10),
    name: ex['detailed-sport-info'] || ex.sport || 'Training session',
    type: ex.sport || 'OTHER',
    distanceM: Number.isFinite(distance) && distance > 0 ? Math.round(distance) : null,
    movingSec: parseIsoDuration(ex.duration),
    elapsedSec: parseIsoDuration(ex.duration),
    avgHr: ex['heart-rate']?.average ?? null,
    elevationM: Number.isFinite(Number(ex['ascent'])) ? Math.round(Number(ex.ascent)) : null,
    source: 'polar',
  };
}

// ---------- route fetching ----------
// Prefer the non-transactional GPX path. If this Polar account only serves
// routes inside a transaction, fall back to one and return its id so the
// caller can commit it *after* the shards are safely on disk.
async function fetchRoute(exerciseId) {
  try {
    const gpx = await polar(`/v3/exercises/${exerciseId}/gpx`, { accept: 'application/gpx+xml' });
    if (gpx) return { gpx, transactionId: null };
  } catch {
    // fall through to the transactional route
  }
  try {
    const tx = await polar(`/v3/users/${POLAR_USER_ID}/exercise-transactions`, { method: 'POST' });
    const transactionId = tx?.['transaction-id'];
    if (!transactionId) return { gpx: null, transactionId: null };
    const gpx = await polar(
      `/v3/users/${POLAR_USER_ID}/exercise-transactions/${transactionId}/exercises/${exerciseId}/gpx`,
      { accept: 'application/gpx+xml' },
    );
    return { gpx, transactionId };
  } catch {
    return { gpx: null, transactionId: null };
  }
}

// ---------- main ----------

const state = await readJson(STATE_PATH, { seenIds: [], lastRunISO: null });
const seen = new Set(state.seenIds ?? []);

// Non-transactional list: safe to call repeatedly, nothing is discarded.
const listed = (await polar('/v3/exercises')) ?? [];
console.log(`Polar returned ${listed.length} available exercise${listed.length === 1 ? '' : 's'}`);

const filtered = typeFilter.length
  ? listed.filter((ex) => typeFilter.includes(String(ex.sport ?? '').toLowerCase()))
  : listed;
if (typeFilter.length) {
  console.log(`Kept ${filtered.length} matching ${typeFilter.join(', ')}`);
}

const fresh = filtered.filter((ex) => !seen.has(String(ex.id)));
if (fresh.length > maxActivities) {
  console.warn(`WARNING: ${fresh.length} new activities exceeds the ${maxActivities} cap. `
    + 'Taking the newest; re-run to continue, or raise SYNC_MAX_ACTIVITIES.');
}
const batch = fresh
  .sort((a, b) => String(a['start-time']).localeCompare(String(b['start-time'])))
  .slice(-maxActivities);

if (!batch.length) {
  console.log('No new activities.');
  await mkdir(ACTIVITY_DIR, { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify({
    seenIds: [...seen], lastRunISO: new Date().toISOString(),
  }, null, 2) + '\n');
  process.exit(0);
}

await mkdir(ACTIVITY_DIR, { recursive: true });

// Attach routes before writing. Transactions are collected, not committed.
const pendingTransactions = new Set();
const entries = [];
for (const ex of batch) {
  const entry = mapExercise(ex);
  if (ex['has-route']) {
    const { gpx, transactionId } = await fetchRoute(ex.id);
    if (transactionId) pendingTransactions.add(transactionId);
    if (gpx) {
      const points = gpxToPoints(gpx);
      if (points.length > 1) entry.gpsPolyline = encodePolyline(downsample(points));
    }
  }
  entries.push(entry);
}

// Group by local month and merge into existing shards, deduping by id.
const byMonth = new Map();
for (const entry of entries) {
  const month = entry.date.slice(0, 7);
  if (!byMonth.has(month)) byMonth.set(month, []);
  byMonth.get(month).push(entry);
}

let added = 0;
for (const [month, monthEntries] of byMonth) {
  const shardPath = join(ACTIVITY_DIR, `activities-${month}.json`);
  const existing = await readShard(shardPath);
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of monthEntries) {
    if (!byId.has(e.id)) added++;
    byId.set(e.id, e); // refresh existing too (renames, late HR data)
  }
  const merged = [...byId.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  await writeShard(shardPath, merged);
  console.log(`Wrote ${shardPath} (${merged.length} entries)`);
}

for (const e of entries) seen.add(e.sourceId);
await writeFile(STATE_PATH, JSON.stringify({
  seenIds: [...seen],
  lastRunISO: new Date().toISOString(),
}, null, 2) + '\n');

// ONLY NOW commit any transaction. Polar discards transactional data on
// commit, so committing earlier would lose activities if a write failed.
for (const transactionId of pendingTransactions) {
  try {
    await polar(`/v3/users/${POLAR_USER_ID}/exercise-transactions/${transactionId}`, { method: 'PUT' });
  } catch (e) {
    console.warn(`Could not commit transaction ${transactionId}: ${e.message}`);
  }
}

console.log(`Done: ${added} new activities; ${seen.size} known`);
