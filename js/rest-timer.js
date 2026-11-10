// Rest timer: one per app, a bar docked above the bottom tab bar (not a
// modal), surviving tab switches and reloads.
//
// Timestamp-based: the only state is restEndsAt (epoch ms, kept in
// localStorage). Every tick, and every return to the page, renders from
// Date.now() — so it's right after the screen has been locked, when timers
// are throttled or frozen.
//
// A static site can't schedule a notification for a locked iPhone, so the
// alert at zero (a short tone and a flash) only plays in the foreground;
// keeping the screen awake (Wake Lock) during a session is the mitigation.
// No navigator.vibrate: iOS Safari doesn't have it.

import { REST_DEFAULT_SEC } from './config.js';
import { el } from './ui/components.js';

const END_KEY = 'ft.restEndsAt';
const LEN_KEY = 'ft.restLength';

// Settings (per browser): default on.
const flag = (key) => {
  try { return localStorage.getItem(key) !== '0'; } catch { return true; }
};
export const restSettings = {
  get auto() { return flag('ft.restAuto'); },
  get keepAwake() { return flag('ft.keepAwake'); },
  get sound() { return flag('ft.restSound'); },
};
export function setRestSetting(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* blocked */ }
}

// Rest for a set: the plan's restSec, else by category. Cardio: none.
export function restSecondsFor(exercise, target = {}) {
  if (target.restSec > 0) return target.restSec;
  if (!exercise || exercise.category === 'cardio') return 0;
  return REST_DEFAULT_SEC[exercise.category] ?? REST_DEFAULT_SEC.other;
}

// Overridable clock, for tests.
let now = () => Date.now();
export function _setClock(fn) { now = fn ?? (() => Date.now()); }

const read = (k) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const write = (k, v) => { try { if (v) localStorage.setItem(k, String(v)); else localStorage.removeItem(k); } catch { /* blocked */ } };

export function restEndsAt() { return read(END_KEY); }
export function remainingSec() {
  const end = restEndsAt();
  return end ? Math.max(0, Math.ceil((end - now()) / 1000)) : 0;
}

let bar = null;
let timeEl = null;
let fillEl = null;
let ticker = null;
let alerted = false;
let audioCtx = null;

export function startRest(sec) {
  if (!(sec > 0)) return;
  write(END_KEY, now() + sec * 1000);
  write(LEN_KEY, sec);
  alerted = false;
  primeAudio(); // inside the ✓ tap: a user gesture, so iOS lets audio play later
  render();
}
export function adjustRest(deltaSec) {
  const end = restEndsAt();
  if (!end) return;
  const next = Math.max(now(), end + deltaSec * 1000);
  write(END_KEY, next);
  write(LEN_KEY, Math.max(read(LEN_KEY), Math.ceil((next - now()) / 1000)));
  if (next > now()) alerted = false;
  render();
}
export function skipRest() {
  write(END_KEY, 0);
  write(LEN_KEY, 0);
  render();
}

function primeAudio() {
  if (!restSettings.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio */ }
}
function beep() {
  if (!restSettings.sound || !audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    for (const [at, f] of [[0, 880], [0.22, 1175]]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.2);
    }
  } catch { /* no audio */ }
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function ensureBar() {
  if (bar) return;
  timeEl = el('div', { class: 'rest-time', 'aria-live': 'off' }, '0:00');
  fillEl = el('div', { class: 'rest-fill' });
  bar = el('div', { class: 'rest-bar', role: 'timer', 'aria-label': 'Rest timer', hidden: true },
    el('div', { class: 'rest-progress' }, fillEl),
    el('div', { class: 'rest-main' },
      el('div', {}, el('div', { class: 'rest-label' }, 'Rest'), timeEl),
      el('div', { class: 'rest-actions' },
        el('button', { class: 'btn ghost rest-btn', type: 'button', onclick: () => adjustRest(-15) }, '−15'),
        el('button', { class: 'btn ghost rest-btn', type: 'button', onclick: () => adjustRest(15) }, '+15'),
        el('button', { class: 'btn secondary rest-btn', type: 'button', onclick: skipRest }, 'Skip'),
      ),
    ),
  );
  document.body.appendChild(bar);
}

// Draw from the clock. At zero: tone + flash, then the bar clears itself a
// few seconds later.
export function render() {
  ensureBar();
  const end = restEndsAt();
  const left = remainingSec();
  const show = !!end && (left > 0 || now() - end < 4000);
  bar.hidden = !show;
  document.body.classList.toggle('resting', show);
  if (!show) {
    if (end) { write(END_KEY, 0); write(LEN_KEY, 0); }
    clearInterval(ticker);
    ticker = null;
    return;
  }
  timeEl.textContent = mmss(left);
  const len = read(LEN_KEY) || 1;
  fillEl.style.width = `${Math.min(100, (left / len) * 100)}%`;
  bar.classList.toggle('rest-done', left === 0);
  if (left === 0 && !alerted) {
    alerted = true;
    // Only alert when it actually ran out with the page in view, not when
    // you come back to a timer that ended long ago.
    if (now() - end < 1500 && document.visibilityState === 'visible') beep();
  }
  if (!ticker) ticker = setInterval(render, 250);
}

// ---------- keep the screen awake during a session ----------

let wakeLock = null;
let sessionActive = false;
async function acquireWakeLock() {
  if (!sessionActive || !restSettings.keepAwake || !('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = null; });
  } catch { wakeLock = null; /* denied, or the page isn't visible */ }
}
export function setSessionActive(on) {
  sessionActive = on;
  if (on) acquireWakeLock();
  else {
    wakeLock?.release?.().catch?.(() => {});
    wakeLock = null;
  }
}
export const isSessionActive = () => sessionActive;

let installed = false;
export function installRestTimer() {
  if (installed) return;
  installed = true;
  // The browser drops a wake lock when the page is hidden; take it back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      acquireWakeLock();
      render();
    }
  });
  render();
}
