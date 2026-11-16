// The data repo template ships Node scripts the app never loads. Nothing here
// can call Polar, but a syntax error or a broken import would only surface in
// a scheduled workflow run — check what can be checked cheaply.
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

let failed = false;
const step = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed = true;
};

for (const f of (await readdir('datarepo-template/scripts')).filter((n) => /\.m?js$/.test(n))) {
  const path = `datarepo-template/scripts/${f}`;
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
    step(`${f} parses`, true);
  } catch (e) {
    step(`${f} parses`, false, String(e.stderr ?? e).split('\n')[0]);
  }
}

const sync = await readFile('datarepo-template/scripts/polar-sync.mjs', 'utf8');
step('the sync script commits transactions only after writing',
  sync.indexOf('writeShards') < sync.indexOf('exercise-transactions/')
  || /after the shards|after .* written/i.test(sync));
step('workflow references the script it ships',
  (await readFile('datarepo-template/.github/workflows/polar-sync.yml', 'utf8')).includes('polar-sync.mjs'));

// ---------- run the sync against a fake Polar ----------
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

let listed = [];
const polar = http.createServer((req, res) => {
  if (req.url === '/v3/exercises') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(listed));
  } else res.writeHead(404).end();
});
await new Promise((r) => polar.listen(0, '127.0.0.1', r));
const script = resolve('datarepo-template/scripts/polar-sync.mjs');
const run = (cwd, env = {}) => new Promise((done) => {
  const child = spawn(process.execPath, [script], {
    cwd,
    env: { PATH: process.env.PATH, POLAR_ACCESS_TOKEN: 't', POLAR_USER_ID: '1', POLAR_API_BASE: `http://127.0.0.1:${polar.address().port}`, ...env },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => done({ code, out }));
});
const exists = (p) => stat(p).then(() => true, () => false);
const exercise = (id, start) => ({ id, 'start-time': start, sport: 'RUNNING', duration: 'PT30M', distance: 5000 });
const { encryptJson } = await import(resolve('datarepo-template/scripts/crypto.js'));

{
  const dir = await mkdtemp(join(tmpdir(), 'polar-'));
  listed = [exercise('a1', '2026-10-30T07:00:00')];
  const first = await run(dir);
  const state = join(dir, 'data/activities/sync-state.json');
  const shard = join(dir, 'data/activities/activities-2026-10.json');
  step('a new activity is written to its month', first.code === 0 && await exists(shard), first.out.trim().split('\n').pop());
  const before = await readFile(state, 'utf8');
  await new Promise((r) => setTimeout(r, 20));
  const again = await run(dir);
  step('a run with nothing new writes nothing (no empty commit every 4 hours)',
    again.code === 0 && (await readFile(state, 'utf8')) === before, again.out.trim());
}
{
  // October is encrypted; November has no file yet and the secret is missing.
  const dir = await mkdtemp(join(tmpdir(), 'polar-'));
  await mkdir(join(dir, 'data/activities'), { recursive: true });
  await writeFile(join(dir, 'data/activities/activities-2026-10.json'), JSON.stringify(await encryptJson([], 'pw')));
  listed = [exercise('b1', '2026-11-02T07:00:00')];
  const r = await run(dir);
  step('a new month is not written unencrypted beside encrypted ones',
    r.code === 1 && !(await exists(join(dir, 'data/activities/activities-2026-11.json'))), r.out.trim().split('\n')[0]);
  const ok = await run(dir, { ENCRYPTION_PASSWORD: 'pw' });
  const written = JSON.parse(await readFile(join(dir, 'data/activities/activities-2026-11.json'), 'utf8'));
  step('with the password set the new month is encrypted', ok.code === 0 && !Array.isArray(written) && !JSON.stringify(written).includes('polar-b1'));
}
{
  const dir = await mkdtemp(join(tmpdir(), 'polar-'));
  await mkdir(join(dir, 'data/activities'), { recursive: true });
  const shard = join(dir, 'data/activities/activities-2026-11.json');
  await writeFile(shard, '[{"id":"polar-old"}, oops');
  listed = [exercise('c1', '2026-11-03T07:00:00')];
  const r = await run(dir);
  step('an unreadable shard is refused, not replaced', r.code === 1 && (await readFile(shard, 'utf8')).includes('polar-old'), r.out.trim().split('\n')[0]);
}
{
  // The state keeps ids by date and drops the ones too old to come back.
  const dir = await mkdtemp(join(tmpdir(), 'polar-'));
  await mkdir(join(dir, 'data/activities'), { recursive: true });
  const state = join(dir, 'data/activities/sync-state.json');
  const old = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
  await writeFile(state, JSON.stringify({ seen: { ancient: old }, lastRunISO: null }));
  listed = [exercise('d1', '2026-11-10T07:00:00')];
  const r = await run(dir);
  const s = JSON.parse(await readFile(state, 'utf8'));
  step('ids are kept with their date, and old ones are dropped',
    r.code === 0 && s.seen.d1 === '2026-11-10' && !('ancient' in s.seen) && !('seenIds' in s), JSON.stringify(s));
  // An old-format file converts, keeping its ids.
  await writeFile(state, JSON.stringify({ seenIds: ['d1', 'x9'], lastRunISO: null }));
  const r2 = await run(dir);
  const s2 = JSON.parse(await readFile(state, 'utf8'));
  step('an old seenIds file converts and keeps its ids', r2.code === 0 && 'x9' in s2.seen && 'd1' in s2.seen && !('seenIds' in s2), JSON.stringify(s2));
  const before = await readFile(state, 'utf8');
  await run(dir);
  step('and is then left alone when nothing is new', (await readFile(state, 'utf8')) === before);
}
polar.close();

process.exit(failed ? 1 : 0);
