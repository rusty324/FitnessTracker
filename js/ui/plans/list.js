// Plans → the plan list, a plan's metadata editor, and a plan's detail page
// (grouped by week).
import * as store from '../../storage/store.js';
import { currentPlan, setCurrentPlan } from './overview.js';
import { confirmDialog, el, emptyState, exerciseLink, openModal, toast } from '../components.js';
import { render } from '../plans-tab.js';
import { exportPlan, importPlanModal } from './plan-io.js';
import { allSessions, makePlan, phaseForWeek, sessionItems } from '../../models.js';
import { formatDate, todayStr } from '../../dates.js';
import { editSession } from './session-editor.js';
import { effectiveSessionDate, isSkipped, sessionKey } from '../../schedule.js';
import { S } from './state.js';

// ---------- Plan list ----------

export function renderPlanList() {
  const plans = store.get('plans');
  const active = plans.filter((p) => p.status === 'active');
  const archived = plans.filter((p) => p.status !== 'active');

  if (currentPlan()) {
    S.root.appendChild(el('button', { class: 'btn small secondary', type: 'button', style: 'margin-bottom:8px',
      onclick: () => { S.view = { name: 'overview' }; render(); } }, '‹ Current plan'));
  }
  S.root.appendChild(el('div', { class: 'list-row' },
    el('h2', {}, 'Training plans'),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => importPlanModal() }, 'Import'),
      el('button', { class: 'btn small', onclick: () => editPlanMeta(null) }, '+ New plan'),
    ),
  ));

  if (!plans.length) {
    S.root.appendChild(emptyState('No plans yet. Create one, or Import a .plan.json file.'));
    return;
  }
  for (const p of active) S.root.appendChild(planCard(p));
  if (archived.length) {
    S.root.appendChild(el('h3', { class: 'muted' }, 'Archived'));
    for (const p of archived) S.root.appendChild(planCard(p));
  }
}

export function planCard(plan) {
  const sessions = allSessions(plan);
  const weeks = plan.weeks?.length ?? 0;
  const sub = [
    `${weeks} week${weeks === 1 ? '' : 's'}`,
    `${sessions.length} session${sessions.length === 1 ? '' : 's'}`,
    `starts ${formatDate(plan.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}`,
  ].join(' · ');
  // An active plan: tap to make it the current one; Edit opens its editor.
  const active = plan.status === 'active';
  return el('div', {
    class: 'card tappable', dataset: { plan: plan.id },
    onclick: () => {
      if (active) { setCurrentPlan(plan.id); S.viewWeek = null; S.view = { name: 'overview' }; }
      else S.view = { name: 'plan', planId: plan.id };
      render();
    },
  },
    el('div', { class: 'list-row', style: 'border:none;padding:0' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, plan.name),
        plan.goal && el('div', { class: 'row-sub' }, `🎯 ${plan.goal}`),
        el('div', { class: 'row-sub' }, sub),
      ),
      el('div', { class: 'row-actions' },
        plan.level && el('span', { class: 'pill' }, plan.level),
        el('span', { class: `pill ${plan.status === 'active' ? 'accent' : ''}` }, plan.type),
        active && el('button', { class: 'btn small secondary', type: 'button', dataset: { action: 'edit' },
          onclick: (e) => { e.stopPropagation(); S.view = { name: 'plan', planId: plan.id }; render(); } }, 'Edit'),
      ),
    ),
  );
}

export function editPlanMeta(plan) {
  const isNew = !plan;
  const draft = plan ? JSON.parse(JSON.stringify(plan)) : makePlan();
  const nameInput = el('input', { value: draft.name, placeholder: 'e.g. 10k progression, Push/Pull/Legs' });
  const typeInput = el('input', { value: draft.type, placeholder: 'strength / running / …' });
  const goalInput = el('input', { value: draft.goal ?? '', placeholder: 'e.g. Complete a 10K distance' });
  const dateInput = el('input', { type: 'date', value: draft.startDate });
  const statusSel = el('select', {},
    el('option', { value: 'active', selected: draft.status === 'active' }, 'Active'),
    el('option', { value: 'archived', selected: draft.status === 'archived' }, 'Archived'),
  );
  const body = el('div', {},
    el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
    el('div', { class: 'field' }, el('label', {}, 'Goal (optional)'), goalInput),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', {}, 'Type'), typeInput),
      el('div', { class: 'field' }, el('label', {}, 'Start date'), dateInput),
    ),
    !isNew && el('div', { class: 'field' }, el('label', {}, 'Status'), statusSel),
  );
  const actions = [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    {
      label: isNew ? 'Create' : 'Save',
      class: 'btn',
      onClick: () => {
        if (!nameInput.value.trim()) { toast('Give the plan a name', 'error'); return false; }
        Object.assign(draft, {
          name: nameInput.value.trim(),
          type: typeInput.value.trim() || 'custom',
          goal: goalInput.value.trim(),
          startDate: dateInput.value || todayStr(),
          status: isNew ? 'active' : statusSel.value,
        });
        store.upsert('plans', draft);
        if (isNew) S.view = { name: 'plan', planId: draft.id };
        render();
      },
    },
  ];
  if (!isNew) {
    actions.unshift({
      label: 'Delete',
      class: 'btn danger',
      onClick: async () => {
        if (!(await confirmDialog(`Delete plan “${plan.name}” and all its sessions?`))) return false;
        store.remove('plans', plan.id);
        S.view = { name: 'list' };
        render();
      },
    });
  }
  openModal(isNew ? 'New plan' : 'Edit plan', body, actions);
}

// ---------- Plan detail (grouped by week) ----------

export function renderPlanDetail(planId) {
  const plan = store.get('plans').find((p) => p.id === planId);
  if (!plan) { S.view = { name: 'list' }; render(); return; }
  const exercises = new Map(store.get('exercises').map((e) => [e.id, e]));

  S.root.appendChild(el('div', { class: 'list-row' },
    el('div', { class: 'row-main' },
      el('button', { class: 'btn small secondary', onclick: () => { S.view = { name: 'list' }; render(); } }, '‹ Plans'),
    ),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn small secondary', onclick: () => exportPlan(plan) }, 'Export'),
      el('button', { class: 'btn small secondary', onclick: () => editPlanMeta(plan) }, 'Edit'),
    ),
  ));
  S.root.appendChild(el('h2', {}, plan.name, ' ', el('span', { class: 'pill accent' }, plan.type)));
  if (plan.goal) S.root.appendChild(el('p', { class: 'muted' }, `🎯 ${plan.goal}`));
  if (plan.description) S.root.appendChild(el('p', { class: 'muted' }, plan.description));
  if (plan.assumptions?.length) {
    S.root.appendChild(el('div', { class: 'card' },
      el('h3', {}, 'Assumptions'),
      el('ul', { style: 'margin:0;padding-left:18px' }, plan.assumptions.map((a) => el('li', { class: 'muted' }, a))),
    ));
  }

  for (const week of plan.weeks ?? []) {
    const phase = phaseForWeek(plan, week.index);
    S.root.appendChild(el('div', { class: 'list-row', style: 'border:none;margin-top:8px' },
      el('div', { class: 'row-main' },
        el('h3', { style: 'margin:0' },
          `Week ${week.index}`,
          week.isDeload ? el('span', { class: 'pill warn', style: 'margin-left:8px' }, 'deload') : '',
          phase ? el('span', { class: 'pill', style: 'margin-left:8px' }, phase.name) : '',
        ),
        week.focus && el('div', { class: 'row-sub' }, week.focus),
      ),
    ));
    for (const session of week.sessions) {
      S.root.appendChild(sessionCard(plan, week, session, exercises));
    }
  }
  if (!plan.weeks?.length) S.root.appendChild(el('p', { class: 'muted' }, 'No sessions yet.'));
  S.root.appendChild(el('button', { class: 'btn', onclick: () => editSession(plan, null) }, '+ Add session'));
}

export function sessionCard(plan, week, session, exercises) {
  const dayOffset = session.dayOffset ?? (week.index - 1) * 7 + (session.dayInWeek ?? 0);
  const schedule = store.get('schedule');
  const date = effectiveSessionDate(plan, session, schedule, dayOffset);
  const moved = schedule.some((r) => r.id === sessionKey(plan.id, session.id) && r.kind === 'move');
  const skipped = isSkipped(plan, session, schedule);
  const items = sessionItems(session);
  const exNames = exerciseLinks(items.map(({ item }) => item.exerciseId), exercises, 'row-sub');
  return el('div', { class: 'card' },
    el('div', { class: 'list-row', style: 'border:none;padding:0' },
      el('div', { class: 'row-main tappable', onclick: () => editSession(plan, session) },
        el('div', { class: 'row-title' }, session.label || 'Session'),
        el('div', { class: 'row-sub' },
          `${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}`
          + `${skipped ? ' · skipped' : moved ? ' · moved' : ''}`
          + `${session.sessionType ? ` · ${session.sessionType}` : ''}`
          + `${session.estimatedDurationMin ? ` · ~${session.estimatedDurationMin} min` : ''}`),
        exNames,
        session.note && el('div', { class: 'row-sub' }, session.note),
      ),
    ),
  );
}

// "Bench, Row, Plank" with each name a link to its library page (taps on a
// link don't open the session underneath). Repeats listed once.
export function exerciseLinks(ids, lib, cls) {
  const unique = [...new Set(ids)];
  if (!unique.length) return null;
  const out = el('div', { class: cls });
  unique.forEach((id, i) => {
    if (i) out.append(', ');
    const ex = lib.get(id);
    out.append(ex ? exerciseLink(ex, ex.shortName || ex.name) : '?');
  });
  return out;
}
