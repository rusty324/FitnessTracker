// "Move to tomorrow" (or, for a later session, "a day later"): before a
// session's day is over, push it back a day — just that session, or it and
// every later unfinished session of its plan (the same slide the open-session
// card offers afterwards). Writes data/schedule.json only (js/schedule.js);
// the plan and your logs are never touched.

import * as store from '../storage/store.js';
import { el, openModal, toast } from './components.js';
import { formatDate, todayStr, addDays } from '../dates.js';
import { occurrences, slidePlan, moveSession } from '../schedule.js';
import { sessionStatus, doneItemIds } from '../sessions.js';

const wd = (d) => formatDate(d, { weekday: 'short' });

export const delayLabel = (date) => (date === todayStr() ? 'Move to tomorrow' : 'Move a day later');

// o: an occurrence (js/schedule.js occurrences()): { plan, session, key, date, repeat }.
export function delayDialog(o) {
  const schedule = store.get('schedule');
  const records = store.get('sessions');
  const logs = store.get('logs');
  const doneIds = doneItemIds(logs, store.get('matches'));
  const isDone = (x) => sessionStatus({ session: x.session, date: x.date, records, doneIds, repeat: x.repeat, logs }).completed;
  const later = occurrences([o.plan], schedule, { activeOnly: false })
    .filter((x) => !x.repeat && !x.skipped && x.key !== o.key && x.date >= o.date && !isDone(x));
  const next = later[0] ?? null;
  const to = formatDate(addDays(o.date, 1), { weekday: 'long' });
  const name = o.session.label || 'This session';

  const body = el('div', { class: 'delay-sheet' },
    el('p', { style: 'margin-top:0' }, `${name}: ${wd(o.date)} → `, el('strong', {}, to), '.'),
    el('div', { class: 'delay-option' },
      el('div', { class: 'row-title' }, 'Just this session'),
      el('div', { class: 'row-sub' }, next
        ? `${next.session.label || 'The next session'} stays on ${formatDate(next.date, { weekday: 'long', month: 'short', day: 'numeric' })}`
          + (next.date === addDays(o.date, 1) ? ' — the same day, so you’d have two.' : '.')
        : 'Nothing else moves.')),
    !o.repeat && later.length > 0 && el('div', { class: 'delay-option' },
      el('div', { class: 'row-title' }, 'Slide the rest too'),
      el('div', { class: 'row-sub' },
        `It and the ${later.length} later session${later.length === 1 ? '' : 's'} each move a day: spacing stays the same and the plan ends a day later.`)),
    el('p', { class: 'muted', style: 'margin-bottom:0;font-size:0.85rem' }, 'Your plan and logs aren’t changed; this is kept with your schedule.'),
  );

  const save = (next2, msg) => { store.save('schedule', next2); toast(msg); };
  openModal(delayLabel(o.date), body, [
    { label: 'Cancel', class: 'btn secondary', onClick: () => {} },
    !o.repeat && later.length > 0 && {
      label: 'Slide the rest too', class: 'btn secondary',
      onClick: () => save(slidePlan({ plan: o.plan, fromDate: o.date, days: 1, schedule, isDone }), 'Plan slid a day'),
    },
    {
      label: 'Just this session', class: 'btn',
      onClick: () => save(moveSession({ plan: o.plan, session: o.session, key: o.key, date: o.date, days: 1, schedule }), `Moved to ${to}`),
    },
  ].filter(Boolean));
}

