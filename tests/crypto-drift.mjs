// crypto.js is deliberately duplicated: the browser reads it from ghsync/,
// the data repo's sync workflow reads its own copy. If they ever drift, one
// side silently can't read the other's files — so assert byte-equality, and
// prove the module really is isomorphic by round-tripping it in Node.
import { readFile } from 'node:fs/promises';

let failed = false;
const step = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failed = true;
};

const a = await readFile('ghsync/crypto.js', 'utf8');
const b = await readFile('datarepo-template/scripts/crypto.js', 'utf8');
step('the browser and workflow copies of crypto.js are identical', a === b,
  a === b ? '' : `${a.length} vs ${b.length} bytes`);

const { encryptJson, decryptJson, isEnvelope } = await import('../ghsync/crypto.js');
const data = [{ id: '1', note: 'unicode ✓ é 日本語' }];
const env = await encryptJson(data, 'hunter2');
step('encrypts to an envelope, not plaintext', isEnvelope(env) && !JSON.stringify(env).includes('日本語'));
step('round-trips in Node (no DOM, no localStorage)',
  JSON.stringify(await decryptJson(env, 'hunter2')) === JSON.stringify(data));
let rejected = false;
try {
  await decryptJson(env, 'wrong');
} catch {
  rejected = true;
}
step('a wrong password fails rather than returning garbage', rejected);

process.exit(failed ? 1 : 0);
