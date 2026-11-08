// Gear (Fitness Library → Gear): shoes, bikes and anything else whose
// distance is worth tracking. Mileage is computed, never stored — the sum of
// every cardio entry that used the item (explicitly, or as the default for
// its sport on that date) plus the distance it had when it was added.

import * as store from '../storage/store.js';
import { makeGear } from '../models.js';
import { CARDIO_SPORTS, GEAR_KINDS } from '../config.js';
import { todayStr, formatDate, formatDuration } from '../dates.js';
import { formatDistance, distanceUnit, distanceToInput, distanceFromInput } from '../units.js';
import { cardioItems, gearStats, defaultGear } from '../cardio.js';
import { el, openModal, confirmDialog, toast, emptyState } from './components.js';
import { gearIcon } from './cardio-form.js';

function allStats(gear) {
  return gearStats(gear, cardioItems({
    logs: store.get('logs'),
    activities: store.getActivityEntries(),
    exercises: store.get('exercises'),
    matches: store.get('matches'),
  }));
}

// Sports this item is the current default for (today).
function defaultFor(gear, g) {
  const today = todayStr();
  return CARDIO_SPORTS.filter((s) => defaultGear(gear, s.id, today)?.id === g.id).map((s) => s.label.toLowerCase());
}

export function renderGear(root) {
  const gear = store.get('gear');
  root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'Gear'),
    el('button', { class: 'btn small', onclick: () => gearModal(null) }, '+ Add gear'),
  ));
  if (!gear.length) {
    root.appendChild(emptyState(
      'Add your shoes or bike to see how far they’ve gone. Runs and rides count toward the default for their '
      + 'sport automatically — synced and imported ones too — and any single activity can name different gear.'));
    return;
  }
  const stats = allStats(gear);
  const byUse = (a, b) => (stats.get(b.id).lastUsed ?? '').localeCompare(stats.get(a.id).lastUsed ?? '') || a.name.localeCompare(b.name);
  const active = gear.filter((g) => !g.retiredOn).sort(byUse);
  const retired = gear.filter((g) => g.retiredOn).sort(byUse);
  for (const g of active) root.appendChild(gearCard(gear, g, stats.get(g.id)));
  if (retired.length) {
    root.appendChild(el('h3', {}, 'Retired'));
    for (const g of retired) root.appendChild(gearCard(gear, g, stats.get(g.id)));
  }
}

function gearCard(gear, g, s) {
  const defaults = g.retiredOn ? [] : defaultFor(gear, g);
  const card = el('div', { class: 'card tappable gear-card', dataset: { gear: g.id }, onclick: () => gearModal(g) },
    el('div', { class: 'list-row', style: 'border:none;padding:0' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, `${gearIcon(g)} ${g.name}`),
        el('div', { class: 'row-sub' },
          `${s.count} activit${s.count === 1 ? 'y' : 'ies'}`
          + (s.movingSec ? ` · ${formatDuration(s.movingSec)}` : '')
          + (s.lastUsed ? ` · last used ${formatDate(s.lastUsed)}` : '')),
      ),
      el('div', { class: 'gear-distance' }, formatDistance(s.distanceM)),
    ),
  );
  const pills = el('div', { class: 'gear-pills' });
  if (g.retiredOn) pills.appendChild(el('span', { class: 'pill' }, `retired ${formatDate(g.retiredOn)}`));
  if (defaults.length) pills.appendChild(el('span', { class: 'pill accent' }, `default · ${defaults.join(', ')}`));

  if (g.alertDistanceM) {
    const pct = s.distanceM / g.alertDistanceM;
    const level = pct >= 1 ? 'danger' : pct >= 0.9 ? 'warn' : 'ok';
    if (!g.retiredOn && level !== 'ok') {
      pills.appendChild(el('span', { class: `pill ${level}` }, level === 'danger' ? 'time to replace' : 'replace soon'));
    }
    card.append(
      el('div', { class: 'gear-bar' }, el('div', { class: `gear-bar-fill ${level}`, style: `width:${Math.min(100, pct * 100).toFixed(1)}%` })),
      el('div', { class: 'row-sub' }, pct >= 1
        ? `${formatDistance(s.distanceM - g.alertDistanceM)} past the ${formatDistance(g.alertDistanceM)} limit`
        : `${formatDistance(g.alertDistanceM - s.distanceM)} left of ${formatDistance(g.alertDistanceM)}`),
    );
  }
  if (pills.childNodes.length) card.appendChild(pills);
  return card;
}

// How many entries name this gear explicitly (logs and activity edits), for
// the delete warning.
function explicitUses(id) {
  return store.get('logs').filter((l) => l.actual?.gearId === id).length
    + store.get('activityEdits').filter((e) => e.gearId === id).length;
}

export function gearModal(existing) {
  const isNew = !existing;
  const g = existing ? { ...existing } : makeGear({ kind: 'shoes', sports: [...GEAR_KINDS[0].sports] });
  const kindDef = (id) => GEAR_KINDS.find((k) => k.id === id) ?? GEAR_KINDS[2];
  const alertFor = (kind) => kindDef(kind).alert?.[distanceUnit()] ?? null;
  if (isNew && g.alertDistanceM == null && alertFor(g.kind)) g.alertDistanceM = distanceFromInput(alertFor(g.kind));

  const name = el('input', { type: 'text', value: g.name, placeholder: 'e.g. Pegasus 40 (blue)', dataset: { name: 'name' } });
  const kind = el('select', { dataset: { name: 'kind' } },
    GEAR_KINDS.map((k) => el('option', { value: k.id, selected: k.id === g.kind }, `${k.icon} ${k.label}`)));
  const sportBoxes = CARDIO_SPORTS.map((sp) => {
    const box = el('input', { type: 'checkbox', value: sp.id, checked: (g.sports ?? []).includes(sp.id) });
    return { sp, box, label: el('label', { class: 'check-inline' }, box, ` ${sp.label}`) };
  });
  const isDefault = el('input', { type: 'checkbox', checked: g.isDefault });
  const num = (value, dataName) => el('input', {
    type: 'number', inputmode: 'decimal', step: '0.1', min: '0', value: value ?? '', dataset: { name: dataName },
  });
  const shownStart = distanceToInput(g.startDistanceM || 0);
  const shownAlert = g.alertDistanceM ? distanceToInput(g.alertDistanceM) : '';
  const start = num(shownStart, 'start');
  const alert = num(shownAlert, 'alert');
  const addedOn = el('input', { type: 'date', value: g.addedOn ?? todayStr(), dataset: { name: 'addedOn' } });
  const notes = el('textarea', { placeholder: 'Size, where you bought it, anything worth remembering' }, g.notes ?? '');

  // A new item follows its kind: shoes default to running and a replace-at
  // distance, a bike to cycling. Nothing is changed once it exists.
  kind.addEventListener('change', () => {
    if (!isNew) return;
    const k = kindDef(kind.value);
    for (const { sp, box } of sportBoxes) box.checked = k.sports.includes(sp.id);
    isDefault.checked = k.sports.length > 0;
    alert.value = alertFor(kind.value) ?? '';
  });

  const recent = !isNew ? allStats(store.get('gear')).get(g.id)?.items.slice(0, 8) ?? [] : [];
  let modal;
  const save = async () => {
    if (!name.value.trim()) { toast('Give it a name', 'error'); return false; }
    const n = (input) => (input.value === '' ? null : parseFloat(input.value));
    if ([n(start), n(alert)].some((v) => v != null && (Number.isNaN(v) || v < 0))) {
      toast('Distances can’t be negative', 'error');
      return false;
    }
    const sports = sportBoxes.filter((x) => x.box.checked).map((x) => x.sp.id);
    Object.assign(g, {
      name: name.value.trim(),
      kind: kind.value,
      sports,
      isDefault: isDefault.checked && sports.length > 0,
      // Unchanged fields keep their stored meters: 6.21 mi isn't 10000 m.
      startDistanceM: start.value === String(shownStart) ? g.startDistanceM || 0 : distanceFromInput(n(start) ?? 0),
      alertDistanceM: alert.value === String(shownAlert) ? g.alertDistanceM ?? null : distanceFromInput(n(alert)),
      addedOn: addedOn.value || todayStr(),
      notes: notes.value.trim(),
    });
    await store.upsert('gear', g);
    modal.close();
    toast(isNew ? `Added ${g.name}` : 'Gear updated');
  };

  const actions = [{ label: 'Cancel', class: 'btn secondary', onClick: () => {} }];
  if (!isNew) {
    actions.push({
      label: 'Delete',
      class: 'btn danger',
      keepOpen: true,
      onClick: async () => {
        const uses = explicitUses(g.id);
        const msg = `Delete “${g.name}”?${uses ? ` ${uses} activit${uses === 1 ? 'y names' : 'ies name'} it and will show no gear.` : ''}`
          + ' Retiring keeps its mileage and history instead.';
        if (!(await confirmDialog(msg))) return false;
        await store.remove('gear', g.id);
        modal.close();
        toast('Gear deleted');
      },
    });
    actions.push({
      label: g.retiredOn ? 'Unretire' : 'Retire',
      class: 'btn secondary',
      onClick: async () => {
        // Retiring stops it being anyone's default from tomorrow; what it
        // already covered stays counted.
        await store.upsert('gear', { ...existing, retiredOn: existing.retiredOn ? null : todayStr() });
        toast(existing.retiredOn ? `${g.name} is back in use` : `${g.name} retired`);
      },
    });
  }
  actions.push({ label: 'Save', class: 'btn', keepOpen: true, onClick: save });

  const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);
  modal = openModal(isNew ? 'Add gear' : g.name, el('div', {},
    field('Name', name),
    field('Kind', kind),
    el('div', { class: 'field' }, el('label', {}, 'Used for'), el('div', { class: 'check-group' }, sportBoxes.map((x) => x.label))),
    el('label', { class: 'check-inline' }, isDefault, ' Default gear for these sports — new and synced activities count toward it automatically'),
    el('div', { class: 'field-row', style: 'margin-top:12px' },
      field(`Distance already on it (${distanceUnit()})`, start),
      field(`Replace at (${distanceUnit()})`, alert),
    ),
    field('In use since', addedOn),
    field('Notes', notes),
    el('p', { class: 'muted' },
      'Activities on or after “In use since” count toward the default automatically. If two items are the default for '
      + 'the same sport, the one added most recently wins — so adding a new pair takes over from the old one.'),
    recent.length ? el('div', {},
      el('h3', {}, 'Recent activities'),
      recent.map((it) => el('div', { class: 'row-sub' },
        `${formatDate(it.date)} · ${it.name}${it.distanceM ? ` · ${formatDistance(it.distanceM)}` : ''}`)),
    ) : null,
  ), actions);
}
