// The Plans tab's mutable state, shared by its views (js/ui/plans-tab.js and
// js/ui/plans/*.js). One object, so a view can assign to it.
export const S = {
  root: null,
  unsub: null,
  view: { name: 'overview' },
  viewWeek: null,
  weeksExpanded: false,
  calMonth: null,
};
