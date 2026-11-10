// Config-driven tab bar with lazy-loaded tab modules and hash routing.
// The hash is #/<tab>[/<path>]; a tab module may export route(path, opts) to
// open something inside itself (e.g. #/library/exercise/<id>). opts.navigated
// is true when the hash changed in this page — so there's somewhere to go
// back to — and false on the initial load.

// Static, trusted markup (never user data), so innerHTML is fine here.
const TAB_ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pulse: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  dumbbell: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
};

// onTabChange(tab): called before a tab mounts (the app sets the page title
// from it; a tab with sub-views then refines it through ctx.setTitle).
export function initTabbar({ tabs, defaultTab, navEl, viewEl, ctx, onTabChange }) {
  const loaded = new Map(); // tabId -> module
  let active = null; // { id, module }

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.dataset.tab = tab.id;
    if (TAB_ICONS[tab.icon]) {
      btn.insertAdjacentHTML('beforeend',
        `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[tab.icon]}</svg>`);
    }
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = tab.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      location.hash = `#/${tab.id}`;
    });
    navEl.appendChild(btn);
  }

  async function activate(tabId, path = '', navigated = false) {
    const tab = tabs.find((t) => t.id === tabId) ?? tabs.find((t) => t.id === defaultTab) ?? tabs[0];
    if (active?.id === tab.id) {
      active.module.route?.(path, { navigated });
      return;
    }
    if (active?.module?.unmount) active.module.unmount();
    viewEl.innerHTML = '';
    for (const btn of navEl.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tab === tab.id);
    }
    let mod = loaded.get(tab.id);
    if (!mod) {
      mod = await import(tab.module);
      loaded.set(tab.id, mod);
    }
    active = { id: tab.id, module: mod };
    onTabChange?.(tab);
    await mod.mount(viewEl, ctx);
    mod.route?.(path, { navigated });
  }

  function fromHash(event) {
    const m = location.hash.match(/^#\/([\w-]+)(?:\/(.*))?$/);
    activate(m ? m[1] : defaultTab, m?.[2] ?? '', !!event);
  }

  window.addEventListener('hashchange', fromHash);
  fromHash();

  return {
    // Re-mount the active tab (used when underlying data changes remotely).
    refresh() {
      if (!active) return;
      const id = active.id;
      active = null;
      activate(id);
    },
  };
}
