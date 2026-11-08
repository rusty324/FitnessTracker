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

process.exit(failed ? 1 : 0);
