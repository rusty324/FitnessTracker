// Unit preferences and conversions. Stored data is ALWAYS canonical metric
// (kg, meters, sec/km, cm) — matching the activity sync and keeping exported
// templates portable. These helpers convert at the UI edge only; the
// preference lives in this browser's localStorage like the PAT does.

const KEY = 'ft.units';
const LB_PER_KG = 1 / 0.45359237;
const M_PER_MI = 1609.344;
const CM_PER_IN = 2.54;
const FT_PER_M = 1 / 0.3048;

const DEFAULTS = { weight: 'kg', distance: 'km', length: 'cm' };

export function getUnits() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setUnits(partial) {
  localStorage.setItem(KEY, JSON.stringify({ ...getUnits(), ...partial }));
}

export const weightUnit = () => getUnits().weight; // 'kg' | 'lb'
export const distanceUnit = () => getUnits().distance; // 'km' | 'mi'
export const paceUnit = () => (distanceUnit() === 'mi' ? '/mi' : '/km');
export const lengthUnit = () => getUnits().length; // 'cm' | 'in'

// ---------- weight (canonical: kg) ----------

export function weightToInput(kg) {
  if (kg == null) return null;
  return weightUnit() === 'lb' ? +(kg * LB_PER_KG).toFixed(1) : kg;
}
export function weightFromInput(v) {
  if (v == null) return null;
  return weightUnit() === 'lb' ? +(v / LB_PER_KG).toFixed(2) : v;
}
export function formatWeight(kg) {
  if (kg == null) return '';
  return `${weightToInput(kg)} ${weightUnit()}`;
}

// ---------- distance (canonical: meters) ----------

export function distanceToInput(meters) {
  if (meters == null) return null;
  const v = distanceUnit() === 'mi' ? meters / M_PER_MI : meters / 1000;
  return +v.toFixed(2);
}
export function distanceFromInput(v) {
  if (v == null) return null;
  return Math.round(distanceUnit() === 'mi' ? v * M_PER_MI : v * 1000);
}
export function formatDistance(meters) {
  if (meters == null) return '';
  const v = distanceUnit() === 'mi' ? meters / M_PER_MI : meters / 1000;
  return `${v.toFixed(meters >= 100000 ? 0 : 2)} ${distanceUnit()}`;
}

// ---------- elevation (canonical: meters) ----------
// Follows the distance unit: miles pair with feet, kilometers with meters.

export const elevationUnit = () => (distanceUnit() === 'mi' ? 'ft' : 'm');
export function elevationToInput(meters) {
  if (meters == null) return null;
  return Math.round(distanceUnit() === 'mi' ? meters * FT_PER_M : meters);
}
export function elevationFromInput(v) {
  if (v == null) return null;
  // One decimal of meters keeps a feet value stable through a round trip.
  return distanceUnit() === 'mi' ? +(v / FT_PER_M).toFixed(1) : v;
}
export function formatElevation(meters) {
  if (meters == null) return '';
  return `${elevationToInput(meters)} ${elevationUnit()}`;
}

// ---------- pace (canonical: sec per km) ----------

function paceDisplaySec(secPerKm) {
  return distanceUnit() === 'mi' ? secPerKm * (M_PER_MI / 1000) : secPerKm;
}
export function paceToInput(secPerKm) {
  if (secPerKm == null) return null;
  return +(paceDisplaySec(secPerKm) / 60).toFixed(2); // minutes in display unit
}
export function paceFromInput(minutes) {
  if (minutes == null) return null;
  const sec = minutes * 60;
  return Math.round(distanceUnit() === 'mi' ? sec / (M_PER_MI / 1000) : sec);
}
export function formatPaceValue(secPerKm) {
  const s = paceDisplaySec(secPerKm);
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}${paceUnit()}`;
}
export function formatPace(meters, seconds) {
  if (!meters || !seconds) return '';
  return formatPaceValue(seconds / (meters / 1000));
}
// Pace in display minutes for charting (min/km or min/mi).
export function paceChartValue(meters, seconds) {
  return paceDisplaySec(seconds / (meters / 1000)) / 60;
}

// ---------- body length (canonical: cm) ----------

export function lengthToInput(cm) {
  if (cm == null) return null;
  return lengthUnit() === 'in' ? +(cm / CM_PER_IN).toFixed(1) : cm;
}
export function lengthFromInput(v) {
  if (v == null) return null;
  return lengthUnit() === 'in' ? +(v * CM_PER_IN).toFixed(1) : v;
}

// ---------- body-metric registry resolution ----------
// Resolves a BODY_METRICS entry (whose unit/step are metric defaults) to the
// user's display unit, with converters for its dimension.
export function resolveMetric(m) {
  if (m.dimension === 'weight') {
    return { unit: weightUnit(), step: 0.1, toInput: weightToInput, fromInput: weightFromInput };
  }
  if (m.dimension === 'length') {
    return { unit: lengthUnit(), step: lengthUnit() === 'in' ? 0.25 : m.step, toInput: lengthToInput, fromInput: lengthFromInput };
  }
  return { unit: m.unit, step: m.step, toInput: (v) => v, fromInput: (v) => v };
}
