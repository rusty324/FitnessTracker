// GPX/TCX parsing for the in-app activity import, plus the polyline encoder
// that lets imported routes reuse the heatmap's existing decoder.
//
// Zero dependencies: XML goes through the browser's built-in DOMParser, and
// the encoder is the inverse of vendor/polyline.js.
//
// Why an import at all: Polar's API only exposes the last 30 days, and only
// from the moment you register a client, so there is no way to backfill
// history through it. A file import also works with any device that can
// export — Garmin, Coros, Suunto — with no OAuth anywhere.

const MAX_POINTS = 500; // plenty for heatmap density; keeps shards small

export class ParseError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'ParseError';
  }
}

// ---------- polyline encoding (precision 5, Google's algorithm) ----------

// Python-2 style rounding, which the polyline algorithm specifies and JS's
// Math.round does not match for negative values.
function py2Round(value) {
  return Math.floor(Math.abs(value) + 0.5) * (value >= 0 ? 1 : -1);
}

function encodeDelta(current, previous, factor) {
  let coordinate = (py2Round(current * factor) - py2Round(previous * factor)) * 2;
  if (coordinate < 0) coordinate = -coordinate - 1;
  let out = '';
  while (coordinate >= 0x20) {
    out += String.fromCharCode((0x20 | (coordinate & 0x1f)) + 63);
    coordinate = Math.floor(coordinate / 32);
  }
  out += String.fromCharCode(coordinate + 63);
  return out;
}

// points: [[lat, lng], ...] -> encoded polyline string
export function encodePolyline(points, precision = 5) {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    out += encodeDelta(lat, prevLat, factor);
    out += encodeDelta(lng, prevLng, factor);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

// Evenly thin a track. Always keeps the first and last point so the route
// still starts and ends where it really did.
export function downsample(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

// ---------- file parsing ----------

function parseXml(text, kind) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new ParseError(`Could not parse this ${kind} file — is it valid XML?`);
  return doc;
}

// Namespace-agnostic tag lookup: exporters vary in prefixes, and
// getElementsByTagNameNS requires knowing the namespace up front.
function tags(node, name) {
  return [...node.getElementsByTagName('*')].filter((el) => el.localName === name);
}
function firstText(node, name) {
  const el = tags(node, name)[0];
  return el ? el.textContent.trim() : null;
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Haversine, so distance can be derived when a file doesn't state it.
function trackDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    total += 6371000 * 2 * Math.asin(Math.sqrt(a));
  }
  return Math.round(total);
}

// Elevation gain with a 3 m dead band: raw GPS altitude jitters by a few
// meters, and summing every wiggle would report a flat loop as a hill.
// A climb only counts once it clears the band; a drop of the same size
// resets the reference.
function elevationGain(eles) {
  let gain = 0;
  let ref = null;
  for (const e of eles) {
    if (!Number.isFinite(e)) continue;
    if (ref == null) { ref = e; continue; }
    if (e - ref >= 3) { gain += e - ref; ref = e; } else if (ref - e >= 3) ref = e;
  }
  return Math.round(gain);
}

// -> { points, times, hrs, eles, name, sportHint, statedDistanceM, statedSec, statedCalories, statedMaxHr }
function readGpx(doc) {
  const points = [];
  const times = [];
  const hrs = [];
  const eles = [];
  for (const pt of tags(doc, 'trkpt')) {
    const lat = num(pt.getAttribute('lat'));
    const lon = num(pt.getAttribute('lon'));
    if (lat == null || lon == null) continue;
    points.push([lat, lon]);
    const t = firstText(pt, 'time');
    if (t) times.push(Date.parse(t));
    const hr = firstText(pt, 'hr');
    if (hr != null) hrs.push(num(hr));
    const ele = num(firstText(pt, 'ele'));
    if (ele != null) eles.push(ele);
  }
  const trk = tags(doc, 'trk')[0];
  return {
    points,
    times,
    hrs,
    eles,
    name: (trk && firstText(trk, 'name')) || firstText(doc, 'name'),
    sportHint: (trk && firstText(trk, 'type')) || null,
    statedDistanceM: null,
    statedSec: null,
    statedCalories: null,
    statedMaxHr: null,
  };
}

function readTcx(doc) {
  const points = [];
  const times = [];
  const hrs = [];
  const eles = [];
  for (const tp of tags(doc, 'Trackpoint')) {
    const lat = num(firstText(tp, 'LatitudeDegrees'));
    const lon = num(firstText(tp, 'LongitudeDegrees'));
    if (lat != null && lon != null) points.push([lat, lon]);
    const t = firstText(tp, 'Time');
    if (t) times.push(Date.parse(t));
    const hrNode = tags(tp, 'HeartRateBpm')[0];
    const hr = hrNode ? num(firstText(hrNode, 'Value')) : null;
    if (hr != null) hrs.push(hr);
    const ele = num(firstText(tp, 'AltitudeMeters'));
    if (ele != null) eles.push(ele);
  }
  const activity = tags(doc, 'Activity')[0];
  // TCX states distance, time and calories per lap; sum them when present,
  // and take the highest lap maximum heart rate.
  let statedDistanceM = 0;
  let statedSec = 0;
  let statedCalories = 0;
  let statedMaxHr = null;
  for (const lap of tags(doc, 'Lap')) {
    statedDistanceM += num(firstText(lap, 'DistanceMeters')) ?? 0;
    statedSec += num(firstText(lap, 'TotalTimeSeconds')) ?? 0;
    // Direct children only: Trackpoints nest deeper and carry no Calories.
    const cal = [...lap.children].find((c) => c.localName === 'Calories');
    statedCalories += num(cal?.textContent) ?? 0;
    const maxNode = [...lap.children].find((c) => c.localName === 'MaximumHeartRateBpm');
    const lapMax = maxNode ? num(firstText(maxNode, 'Value')) : null;
    if (lapMax != null) statedMaxHr = Math.max(statedMaxHr ?? 0, lapMax);
  }
  return {
    points,
    times,
    hrs,
    eles,
    name: firstText(doc, 'Notes'),
    sportHint: activity?.getAttribute('Sport') ?? null,
    statedDistanceM: statedDistanceM > 0 ? Math.round(statedDistanceM) : null,
    statedSec: statedSec > 0 ? Math.round(statedSec) : null,
    statedCalories: statedCalories > 0 ? Math.round(statedCalories) : null,
    statedMaxHr,
  };
}

// Stable id from the file's bytes, so re-importing the same export is a
// no-op rather than a duplicate.
async function fileId(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `import-${hex.slice(0, 16)}`;
}

function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Parse one GPX or TCX file into an activity record matching the shape the
// Polar sync writes, so History, the matcher, and the heatmap treat both
// sources identically.
export async function parseActivityFile(filename, text) {
  const isTcx = /\.tcx$/i.test(filename) || /<TrainingCenterDatabase/i.test(text);
  const isGpx = /\.gpx$/i.test(filename) || /<gpx/i.test(text);
  if (!isTcx && !isGpx) {
    // The picker accepts anything (see filePicker), so say something useful
    // about the two files people actually reach for by mistake.
    if (/\.zip$/i.test(filename) || text.startsWith('PK')) {
      throw new ParseError(`${filename}: this is a .zip archive — uncompress it first, then pick the .gpx or .tcx inside`);
    }
    if (/\.fit$/i.test(filename)) {
      throw new ParseError(`${filename}: .fit files are not supported — re-export the activity as .gpx or .tcx`);
    }
    throw new ParseError(`${filename}: not a .gpx or .tcx file`);
  }

  const doc = parseXml(text, isTcx ? 'TCX' : 'GPX');
  const r = isTcx ? readTcx(doc) : readGpx(doc);
  if (!r.points.length && !r.times.length) {
    throw new ParseError(`${filename}: no track points or timestamps found`);
  }

  const stamps = r.times.filter(Number.isFinite).sort((a, b) => a - b);
  if (!stamps.length) throw new ParseError(`${filename}: no usable timestamps`);
  // Parentheses matter: `a ?? b || c` is a syntax error in JS.
  const movingSec = r.statedSec ?? (Math.round((stamps[stamps.length - 1] - stamps[0]) / 1000) || null);
  const distanceM = r.statedDistanceM ?? (r.points.length > 1 ? trackDistance(r.points) : null);
  const avgHr = r.hrs.length ? Math.round(r.hrs.reduce((a, b) => a + b, 0) / r.hrs.length) : null;
  const maxHr = r.statedMaxHr ?? (r.hrs.length ? Math.round(Math.max(...r.hrs)) : null);
  const gain = r.eles.length > 1 ? elevationGain(r.eles) : null;
  // Treadmill/indoor from the sport name when the exporter says so; a GPS
  // track means it happened outside; otherwise leave it for the user.
  const environment = /treadmill|indoor|virtual|trainer/i.test(r.sportHint ?? '') ? 'indoor'
    : r.points.length > 1 ? 'outdoor' : null;

  const entry = {
    id: await fileId(text),
    sourceId: filename,
    date: localDate(stamps[0]),
    name: r.name || filename.replace(/\.(gpx|tcx)$/i, ''),
    type: r.sportHint || 'Workout',
    distanceM,
    movingSec,
    elapsedSec: movingSec,
    avgHr,
    maxHr,
    calories: r.statedCalories,
    elevationM: gain,
    environment,
    source: 'import',
  };
  if (r.points.length > 1) entry.gpsPolyline = encodePolyline(downsample(r.points));
  return entry;
}
