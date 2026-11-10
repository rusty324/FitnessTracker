// The CI workflow: runs this suite runner on pushes to main, with the
// Playwright the tests are written against. Guards against the workflow
// being dropped or pointed at something else by a later edit.
import { readFile } from 'node:fs/promises';
import { reporter } from './lib.mjs';

const { step, done } = reporter();
const yml = await readFile(new URL('../.github/workflows/tests.yml', import.meta.url), 'utf8').catch(() => '');
step('the workflow exists', yml.length > 0);
step('…runs on pushes to main', /on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/.test(yml));
step('…runs the whole suite', /run:\s*node tests\/run\.mjs\s*$/m.test(yml));
step('…installs a pinned Playwright and its Chromium', /playwright@\d+\.\d+\.\d+/.test(yml) && /playwright install --with-deps chromium/.test(yml));
step('…read-only token', /permissions:\s*\n\s*contents:\s*read/.test(yml));
await done();
