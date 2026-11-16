// The Library tab's mutable state, shared by its views (js/ui/library-tab.js
// and js/ui/library/*.js). One object, so a view can assign to it.
import { emptyFilters } from '../exercise-filter-bar.js';

export const S = {
  root: null,
  unsub: null,
  view: { name: 'exercises' },
  listScrollY: 0,
  filters: emptyFilters(),
};
