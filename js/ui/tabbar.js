// Config-driven tab bar with lazy-loaded tab modules and hash routing.

export function initTabbar({ tabs, defaultTab, navEl, viewEl, ctx }) {
  const loaded = new Map(); // tabId -> module
  let active = null; // { id, module }

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.addEventListener('click', () => {
      location.hash = `#/${tab.id}`;
    });
    navEl.appendChild(btn);
  }

  async function activate(tabId) {
    const tab = tabs.find((t) => t.id === tabId) ?? tabs.find((t) => t.id === defaultTab) ?? tabs[0];
    if (active?.id === tab.id) return;
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
    await mod.mount(viewEl, ctx);
  }

  function fromHash() {
    const m = location.hash.match(/^#\/([\w-]+)/);
    activate(m ? m[1] : defaultTab);
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
