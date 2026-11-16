// Plans → the month calendar.
import * as store from '../../storage/store.js';
import { occurrences } from '../../schedule.js';
import { el } from '../components.js';
import { render } from '../plans-tab.js';
import { toDateStr, todayStr } from '../../dates.js';
import { S } from './state.js';

// ---------- Calendar ----------

export function renderCalendar() {
  if (!S.calMonth) {
    const now = new Date();
    S.calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const plans = store.get('plans').filter((p) => p.status === 'active');
  const byDate = new Map();
  for (const { plan: p, session, week, date: d, skipped, repeat } of occurrences(plans, store.get('schedule'))) {
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({ plan: p, session, week, skipped, repeat });
  }

  const monthName = S.calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  S.root.appendChild(el('div', { class: 'cal-header' },
    el('button', { class: 'btn small secondary', onclick: () => { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() - 1, 1); render(); } }, '‹'),
    el('h2', { style: 'margin:0' }, monthName),
    el('button', { class: 'btn small secondary', onclick: () => { S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + 1, 1); render(); } }, '›'),
  ));

  const grid = el('div', { class: 'cal-grid' });
  for (const dow of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    grid.appendChild(el('div', { class: 'cal-dow' }, dow));
  }
  const firstDow = (S.calMonth.getDay() + 6) % 7;
  const start = new Date(S.calMonth);
  start.setDate(1 - firstDow);
  const today = todayStr();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = toDateStr(d);
    const cell = el('div', {
      class: `cal-cell${d.getMonth() !== S.calMonth.getMonth() ? ' other-month' : ''}${ds === today ? ' today' : ''}`,
    }, el('span', { class: 'cal-day-num' }, d.getDate()));
    for (const { plan, session, week, skipped, repeat } of byDate.get(ds) ?? []) {
      // Phones get a compact "W1 S2" (a seventh of 390px fits nothing more);
      // wider screens the full label. Both carry the full text for tooltips
      // and screen readers.
      const n = (week?.sessions ?? []).indexOf(session) + 1;
      const full = `${plan.name}: ${session.label || plan.name}${skipped ? ' (skipped)' : repeat ? ' (repeat)' : ''}`;
      cell.appendChild(el('span', { class: `cal-dot${skipped ? ' cal-skipped' : ''}${repeat ? ' cal-repeat' : ''}`, title: full, 'aria-label': full },
        el('span', { class: 'cal-full', 'aria-hidden': 'true' }, session.label || plan.name),
        el('span', { class: 'cal-short', 'aria-hidden': 'true' }, week ? `W${week.index}${n ? ` S${n}` : ''}` : '•')));
    }
    grid.appendChild(cell);
  }
  S.root.appendChild(grid);
  if (!plans.length) S.root.appendChild(el('p', { class: 'muted', style: 'margin-top:12px' }, 'No active plans to show.'));
}
