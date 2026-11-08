// Runs every suite against a throwaway static server. `node tests/run.mjs`
// from the repo root; pass suite names to run a subset.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = process.env.TEST_PORT ?? '8613';

const server = spawn('python3', ['-m', 'http.server', PORT], { cwd: root, stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

// Wait for the server rather than sleeping a guessed amount.
for (let i = 0; i < 50; i++) {
  try {
    const res = await fetch(`http://localhost:${PORT}/index.html`);
    if (res.ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 100));
  }
}

// This repo's suites, plus ghsync's own (they ship inside the package and
// start their own servers; they need a `playwright` they can import — see
// README → Tests).
const wanted = process.argv.slice(2);
const ghsyncTests = join(root, 'ghsync', 'tests');
const suites = [
  ...(await readdir(here))
    .filter((f) => f.endsWith('.mjs') && !['run.mjs', 'lib.mjs'].includes(f))
    .map((f) => join(here, f)),
  ...(await readdir(ghsyncTests).catch(() => []))
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => join(ghsyncTests, f)),
]
  .filter((f) => !wanted.length || wanted.some((w) => f.includes(w)))
  .sort();

let failures = 0;
let total = 0;
for (const suite of suites) {
  const name = suite.slice(root.length + 1);
  const out = await new Promise((resolve) => {
    const p = spawn(process.execPath, [suite], { cwd: root, env: { ...process.env, TEST_PORT: PORT } });
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; });
    p.stderr.on('data', (d) => { buf += d; });
    p.on('close', (code) => resolve({ code, buf }));
  });
  // Ours print PASS/FAIL lines; ghsync's print ✓/✗, or SKIP when the
  // environment can't run them.
  const pass = (out.buf.match(/^(PASS|\s*✓)/gm) ?? []).length;
  const fail = (out.buf.match(/^(FAIL|\s*✗)/gm) ?? []).length;
  const skipped = /^SKIP/m.test(out.buf);
  total += pass + fail;
  failures += fail || (out.code ? 1 : 0);
  const mark = fail || out.code ? '✗' : skipped ? '–' : '✓';
  console.log(`${mark} ${name}: ${skipped ? 'skipped' : `${pass} passed`}${fail ? `, ${fail} FAILED` : ''}`);
  if (skipped) console.log(`  ${out.buf.match(/^SKIP.*$/m)[0]}`);
  if (fail || out.code) console.log(out.buf.split('\n').filter((l) => /^FAIL|^\s*✗|Error|error:/.test(l)).join('\n') || out.buf.slice(-1500));
}
stop();
console.log(`\n${total} checks, ${failures ? `${failures} failing` : 'all green'}`);
process.exit(failures ? 1 : 0);
