import { TABS, DEFAULT_TAB, APP_REPO, SYNC_WORKFLOW_FILE } from './config.js';
import { getUnits, setUnits } from './units.js';
import * as store from './storage/store.js';
import {
  syncSections, setupRows, checkRow, syncBlocker, badgeState, errorPanel,
} from '../ghsync/settings-ui.js';
import { initTabbar } from './ui/tabbar.js';
import { el, openModal, toast, downloadJson } from './ui/components.js';
import { loadPreset } from './presets.js';
import { syncFromPresets } from './preset-sync.js';
import { installDraftFlush } from './draft.js';
import { installRestTimer, restSettings, setRestSetting } from './rest-timer.js';
import { todayStr } from './dates.js';

const badge = document.getElementById('sync-badge');

function renderBadge() {
  const { text, cls, title, actionable } = badgeState(store);
  badge.hidden = false;
  badge.className = 'sync-badge';
  badge.textContent = text;
  if (cls) badge.classList.add(cls);
  // With an error behind it, the badge opens the details: a tooltip alone
  // can't be copied, and phones don't show tooltips at all.
  badge.title = actionable ? `${title} — tap for details` : title;
  if (actionable) {
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('aria-label', `${text}: show details`);
  } else {
    badge.removeAttribute('role');
    badge.removeAttribute('tabindex');
    badge.removeAttribute('aria-label');
  }
}

// The copyable error report, from the badge.
function openSyncDetails() {
  if (!badgeState(store).actionable) return;
  const { status } = store.syncStatus();
  let modal;
  modal = openModal(status === 'error' ? 'Sync error' : 'Sync details', errorPanel(store, {
    toast,
    onRetry: (st) => {
      renderBadge();
      if (st.status === 'ok') {
        modal.close();
        tabbar.refresh();
      }
    },
  }), [{ label: 'Close', class: 'btn secondary', onClick: () => {} }]);
}
badge.addEventListener('click', openSyncDetails);
badge.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openSyncDetails();
  }
});

// ---------- Settings ----------
// Sections are native <details> so the modal fits one screen; each summary
// shows its current state, and every action sits next to the input it acts
// on (the Save button used to live in the modal footer, which read as if
// "Sync Strava now" were the way to save a token).

function settingsSection({ id, name, state, body, open = false }) {
  return el('details', { class: 'settings-section', dataset: { section: id }, open },
    el('summary', {},
      el('span', { class: 'sec-name' }, name),
      el('span', { class: 'sec-state' }, state),
    ),
    el('div', { class: 'settings-body' }, body),
  );
}

// Triggers the Polar sync workflow, which lives in the DATA repo, not this one.
function activitySyncSection() {
  const blocker = syncBlocker(store);
  const syncBtn = el('button', {
    class: 'btn secondary',
    disabled: !!blocker,
    onclick: async () => {
      try {
        await store.client.dispatchWorkflow(SYNC_WORKFLOW_FILE);
        toast('Sync triggered — new activities land in a minute or two');
        pollActivities();
      } catch (e) {
        toast(`Could not trigger sync: ${e.message}`, 'error');
      }
    },
  }, 'Sync activities now');

  return {
    state: blocker ? 'needs setup' : 'ready',
    body: el('div', {},
      el('p', { class: 'muted' },
        'Polar activities sync on a schedule from a workflow in your data repo — this button just runs ',
        'it now. It needs the Polar credentials set up there first; see datarepo-template/README.md. ',
        'If you changed “Folder in the repo” above, set the same folder as the DATA_DIR variable there. ',
        'You can also import GPX/TCX files directly from Logs → History, with no API at all.'),
      syncBtn,
      blocker ? el('p', { class: 'muted', style: 'margin:6px 0 0' }, blocker) : null,
    ),
  };
}

function workoutSection() {
  const box = (key, label, on) => el('label', { class: 'check-inline', style: 'margin-bottom:8px' },
    el('input', { type: 'checkbox', checked: on, dataset: { setting: key }, onchange: (e) => setRestSetting(key, e.target.checked) }),
    ` ${label}`);
  return {
    state: restSettings.auto ? 'rest timer on' : 'rest timer off',
    body: el('div', {},
      box('ft.restAuto', 'Start the rest timer when I tick a set', restSettings.auto),
      box('ft.restSound', 'Play a short tone when rest is over', restSettings.sound),
      box('ft.keepAwake', 'Keep the screen on during a session', restSettings.keepAwake),
      el('div', { class: 'field', style: 'margin-top:6px' }, el('label', {}, 'Weeks start on (weekly review)'),
        el('select', {
          dataset: { setting: 'ft.weekStart' },
          onchange: (e) => { try { localStorage.setItem('ft.weekStart', e.target.value); } catch { /* blocked */ } tabbar.refresh(); },
        },
        [['mon', 'Monday'], ['sun', 'Sunday']].map(([v, label]) => el('option', {
          value: v, selected: (localStorage.getItem('ft.weekStart') ?? 'mon') === v,
        }, label)))),
      el('p', { class: 'muted' },
        'A web app can’t alert you on a locked iPhone screen: the timer is right when you come back, and the tone ',
        'plays only while the app is open. Keeping the screen on during a session is the workaround.'),
    ),
  };
}

function unitsSection() {
  // Units apply immediately on change; stored data stays metric, only the
  // display converts, so this is always safe to flip back and forth.
  const units = getUnits();
  const unitSelect = (key, options) => el('select', {
    onchange: (e) => {
      setUnits({ [key]: e.target.value });
      tabbar.refresh();
    },
  }, options.map(([v, label]) => el('option', { value: v, selected: units[key] === v }, label)));

  return {
    state: `${units.weight} · ${units.distance} · ${units.length}`,
    body: el('div', {},
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', {}, 'Weight'),
          unitSelect('weight', [['kg', 'kilograms (kg)'], ['lb', 'pounds (lb)']])),
        el('div', { class: 'field' }, el('label', {}, 'Distance'),
          unitSelect('distance', [['km', 'kilometers (km)'], ['mi', 'miles (mi)']])),
        el('div', { class: 'field' }, el('label', {}, 'Body'),
          unitSelect('length', [['cm', 'centimeters (cm)'], ['in', 'inches (in)']])),
      ),
      el('p', { class: 'muted' },
        'Display only — stored data and exported templates are always metric, so switching never rewrites anything.'),
    ),
  };
}

function templatesSection() {
  return {
    state: 'example .plan.json',
    body: el('div', {},
      el('button', {
        class: 'btn secondary',
        onclick: async () => {
          try {
            downloadJson('example.plan.json', await loadPreset('plans/example.plan.json'));
            toast('Template downloaded — edit it, then use Import on the Plans tab');
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      }, 'Download plan template'),
      el('p', { class: 'muted' },
        'A starter file showing every target type (metric: kg / meters). The Plans and Fitness Library ',
        'tabs also have Import buttons listing all the bundled starter plans and exercise packs.'),
    ),
  };
}

// Copy for the three ghsync sections that mentions this app's specifics.
const SYNC_TEXT = {
  defaultOwner: APP_REPO.owner,
  repoPlaceholder: 'fitness-data',
  previewFile: 'logs.json',
  appRepoNote: `The app itself is served from the public ${APP_REPO.owner}/${APP_REPO.repo}, `
    + 'which holds no personal data.',
  tokenScopeNote: 'A fine-grained personal access token scoped to only your private data repo, with '
    + 'Contents read/write (plus Actions read/write for the activity sync button). '
    + 'It needs no access to the public repo that serves this app.',
  privacyLocked: 'Some synced files are encrypted and the password is missing or wrong — '
    + 'enter it below to unlock.',
  privacyOn: 'Logs, body metrics, goals, gear, and GPS data are encrypted in the repo. '
    + 'Set the same password as the ENCRYPTION_PASSWORD secret in your data repo so the sync can read it.',
  privacyOff: 'Optional second layer: encrypt logs, body metrics, goals, gear, and GPS data before they are '
    + 'committed. Plans and the exercise library stay readable.',
};

// openSection: which section to expand. Defaults to the first unfinished
// setup step, so opening Settings shows you what to do next.
function openSettings({ openSection = null } = {}) {
  let modal;
  const reopen = (section) => {
    modal?.close();
    openSettings({ openSection: section });
  };

  const repoDone = store.hasDataRepo();
  const tokenDone = store.hasToken();
  const active = openSection ?? (!repoDone ? 'datarepo' : !tokenDone ? 'token' : 'datarepo');

  // Data repo, token, and privacy come from ghsync; the rest are this app's.
  const [repoSpec, tokenSpec, privacySpec] = syncSections({
    store,
    toast,
    reopen,
    onChange: () => { renderBadge(); tabbar.refresh(); },
    text: SYNC_TEXT,
  });
  const specs = [
    repoSpec,
    tokenSpec,
    { id: 'activitysync', name: 'Activity sync', ...activitySyncSection() },
    privacySpec,
    { id: 'units', name: 'Units', ...unitsSection() },
    { id: 'workout', name: 'Workout', ...workoutSection() },
    { id: 'templates', name: 'Plan templates', ...templatesSection() },
  ];
  const sections = new Map();
  const sectionEls = specs.map((spec) => {
    const node = settingsSection({ ...spec, open: spec.id === active });
    sections.set(spec.id, node);
    return node;
  });

  const reveal = (id) => {
    const node = sections.get(id);
    if (!node) return;
    node.open = true;
    node.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // Setup checklist — answers "what do I still need to do?" at a glance.
  const checklist = el('div', { class: 'card' },
    setupRows(store, reveal),
    checkRow('Activity sync', false,
      syncBlocker(store) ? 'optional — needs the two above' : 'optional — ready to run',
      () => reveal('activitysync')),
  );

  modal = openModal('Settings', el('div', {}, checklist, sectionEls),
    [{ label: 'Close', class: 'btn secondary', onClick: () => {} }]);
}

// After a manual workflow dispatch, watch for new activity data for ~2 minutes.
function pollActivities() {
  let tries = 0;
  const timer = setInterval(async () => {
    tries++;
    const changed = await store.refreshActivities().catch(() => false);
    if (changed || tries >= 8) {
      clearInterval(timer);
      if (changed) toast('New activities synced');
    }
  }, 15000);
}

document.getElementById('settings-btn').addEventListener('click', openSettings);

store.onChange((e) => {
  if (e.type === 'sync-status') renderBadge();
});
store.init();
renderBadge();

// Bring the exercise library up to date with the bundled packs (fills empty
// fields; migrates the old Push-Up ladder so plan variant levels mean what
// the plan says) — before Logs needs variant names.
syncFromPresets();
// Gym-floor drafts left from an earlier visit are written out now, and every
// draft is written when the page is hidden (js/draft.js).
installDraftFlush(todayStr);
installRestTimer();

// The header shows where you are ("Today", "Metrics", "Plans"…) rather than
// the app's name: the phone's bottom bar already says which tab.
const pageTitle = document.getElementById('page-title');
function setTitle(text) {
  pageTitle.textContent = text;
}

const tabbar = initTabbar({
  tabs: TABS,
  defaultTab: DEFAULT_TAB,
  navEl: document.getElementById('tabbar'),
  viewEl: document.getElementById('view'),
  ctx: { store, openSettings, setTitle },
  onTabChange: (tab) => setTitle(tab.label),
});

// First-run nudge: no token and nothing cached yet.
if (!store.hasToken() && !localStorage.getItem('ft.welcomed')) {
  localStorage.setItem('ft.welcomed', '1');
  toast('Running in local-only mode — open ⚙ Settings to connect GitHub');
}
