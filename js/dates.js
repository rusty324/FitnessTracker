// All app dates are local calendar dates as 'YYYY-MM-DD' strings.
// Never use new Date('YYYY-MM-DD') — it parses as UTC midnight and shifts
// the day in western timezones. These helpers keep everything local.

export function todayStr() {
  return toDateStr(new Date());
}

export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

// Whole-day difference b - a.
export function diffDays(a, b) {
  return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000);
}

export function formatDate(dateStr, opts = { month: 'short', day: 'numeric' }) {
  return parseDateStr(dateStr).toLocaleDateString(undefined, opts);
}

export function formatDateLong(dateStr) {
  return formatDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthKey(dateStr) {
  return dateStr.slice(0, 7); // 'YYYY-MM'
}

export function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return s ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
  return `${s}s`;
}

// Distance and pace formatting live in units.js — they depend on the
// user's unit preference; only unit-agnostic helpers belong here.
