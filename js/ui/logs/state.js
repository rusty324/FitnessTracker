// The Logs tab's mutable state, shared by its views (js/ui/logs-tab.js and
// js/ui/logs/*.js). One object, so a view can assign to it.
import { addDays, todayStr } from '../../dates.js';

export const S = {
  root: null,
  ctx: null,
  unsub: null,
  sub: 'today',
  histFilter: { from: addDays(todayStr(), -30), to: todayStr(), planId: '' },
  adherenceDays: 30,
  weightWeeks: 12,
  metricTab: 'weight',
  reviewThisWeek: false,
  expandedItem: null,
  openLast: null,
  heatmapMod: null,
  shortcutsOn: false,
};
