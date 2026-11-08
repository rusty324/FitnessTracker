// Shared test helpers. The suites drive the real pages in a real browser —
// there is no build step to test against, so this is the only honest level.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BASE = `http://localhost:${process.env.TEST_PORT ?? 8613}`;

// Playwright may be installed locally or globally; try both before giving up.
export async function chromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const root = execSync('npm root -g').toString().trim();
    const mod = await import(pathToFileURL(join(root, 'playwright', 'index.js')).href);
    return (mod.chromium ?? mod.default?.chromium);
  }
}

export function reporter() {
  let failed = false;
  return {
    step(name, ok, extra = '') {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
      if (!ok) failed = true;
    },
    done(browser) {
      return browser.close().then(() => process.exit(failed ? 1 : 0));
    },
  };
}

// A fake GitHub: every file 404s (so writes create), PUTs succeed, directory
// listings are empty, and every request is recorded for assertions.
export async function stubGithub(page, { dirs = {}, files = {} } = {}) {
  const calls = [];
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = req.url();
    calls.push({ method: req.method(), url, body: req.postData() });
    if (req.method() === 'PUT') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{"content":{"sha":"newsha"}}' });
    }
    if (req.method() === 'POST') return route.fulfill({ status: 204, body: '' });
    const path = decodeURIComponent(url.split('/contents/')[1]?.split('?')[0] ?? '');
    if (path && dirs[path]) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dirs[path]) });
    }
    if (path && files[path]) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: Buffer.from(files[path]).toString('base64'), sha: `sha-${path}` }),
      });
    }
    if (/\/repos\/[^/]+\/[^/]+$/.test(url.split('?')[0])) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"private":true}' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
  });
  return {
    calls,
    puts: () => calls.filter((c) => c.method === 'PUT'),
    putBody: (match) => {
      const call = calls.find((c) => c.method === 'PUT' && c.url.includes(match));
      return call?.body ? Buffer.from(JSON.parse(call.body).content, 'base64').toString('utf8') : '';
    },
    reset: () => { calls.length = 0; },
  };
}
