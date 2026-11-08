// Small shared UI helpers: element builder, modal, confirm, toast.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function openModal(title, bodyEl, actions = []) {
  const root = document.getElementById('modal-root');
  const close = () => backdrop.remove();
  const actionBtns = actions.map(({ label, class: cls = 'btn', onClick, keepOpen }) =>
    el('button', {
      class: cls,
      onclick: async () => {
        const ok = await onClick?.();
        if (!keepOpen && ok !== false) close();
      },
    }, label),
  );
  const backdrop = el('div', { class: 'modal-backdrop', onclick: (e) => e.target === backdrop && close() },
    el('div', { class: 'modal' },
      el('h2', { class: 'modal-title' }, title),
      bodyEl,
      el('div', { class: 'modal-actions' }, actionBtns),
    ),
  );
  root.appendChild(backdrop);
  return { close };
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const modal = openModal('Confirm', el('p', {}, message), [
      { label: 'Cancel', class: 'btn secondary', onClick: () => resolve(false) },
      { label: 'Delete', class: 'btn danger', onClick: () => resolve(true) },
    ]);
    // Backdrop click closes without resolving; treat as cancel.
    modal.close = ((orig) => () => { resolve(false); orig(); })(modal.close);
  });
}

export function toast(message, type = '') {
  const root = document.getElementById('toast-root');
  const t = el('div', { class: `toast ${type}` }, message);
  root.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// File pickers deliberately carry no `accept` filter. iOS resolves accept
// values to system UTIs, and any extension it doesn't recognise — .gpx and
// .tcx among them — leaves every file greyed out and unselectable in the
// Files picker, with no way to override. Every importer validates content
// after selection (js/gps.js sniffs for <gpx>/<TrainingCenterDatabase>, the
// JSON importers parse and schema-check), so filtering the picker buys
// nothing and can lock a real file out entirely.
export function filePicker(attrs = {}) {
  return el('input', { type: 'file', ...attrs });
}

export function emptyState(message) {
  return el('div', { class: 'empty-state' }, message);
}

export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
