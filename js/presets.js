// Starter content bundled with the site (presets/). Because GitHub Pages
// serves these files from the same branch as the app, they load with a plain
// relative fetch: no PAT, no GitHub API, no rate limit, and the browser
// caches them so they keep working offline.
//
// Adding your own is a two-step, no-code change: drop a file into
// presets/plans or presets/exercises, then add an entry to presets/index.json.

const BASE = new URL('../presets/', import.meta.url);

let manifestPromise = null;

export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetchJson('index.json').catch((e) => {
      manifestPromise = null; // let a later attempt retry
      throw e;
    });
  }
  return manifestPromise;
}

export function loadPreset(file) {
  return fetchJson(file);
}

async function fetchJson(file) {
  const res = await fetch(new URL(file, BASE));
  if (!res.ok) throw new Error(`Could not load presets/${file} (${res.status})`);
  return res.json();
}
