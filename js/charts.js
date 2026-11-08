// Hand-rolled SVG line chart: enough for the weight and pace/distance trends.
// points: [{ x: Date-ms number, y: number }] sorted by x.

import { parseDateStr } from './dates.js';

const SVG = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// refLine (optional): { value, label } draws a horizontal dashed goal line
// at that y-value; the y-domain is widened to keep it in view.
export function lineChart({ points, width = 640, height = 220, yLabel = '', yFormat = (v) => v, invertY = false, refLine = null }) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg' });
  wrap.appendChild(svg);
  if (points.length < 2) {
    const t = s('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'tick-label' });
    t.textContent = points.length === 1 ? 'Need at least two data points for a trend' : 'No data yet';
    svg.appendChild(t);
    return wrap;
  }

  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  if (refLine?.value != null) ys.push(refLine.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPadding = (yMax - yMin) * 0.1;
  yMin -= yPadding;
  yMax += yPadding;

  const X = (x) => pad.l + ((x - xMin) / (xMax - xMin)) * iw;
  const Y = (y) => {
    const t = (y - yMin) / (yMax - yMin);
    return pad.t + (invertY ? t : 1 - t) * ih;
  };

  // y grid + ticks
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = Y(v);
    svg.appendChild(s('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: 'grid-line' }));
    const label = s('text', { x: pad.l - 6, y: y + 3, 'text-anchor': 'end', class: 'tick-label' });
    label.textContent = yFormat(v);
    svg.appendChild(label);
  }
  // x ticks: first, middle, last
  for (const t of [0, 0.5, 1]) {
    const x = xMin + (xMax - xMin) * t;
    const label = s('text', {
      x: X(x),
      y: height - 8,
      'text-anchor': t === 0 ? 'start' : t === 1 ? 'end' : 'middle',
      class: 'tick-label',
    });
    label.textContent = new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    svg.appendChild(label);
  }
  svg.appendChild(s('line', { x1: pad.l, x2: width - pad.r, y1: height - pad.b, y2: height - pad.b, class: 'axis-line' }));

  if (refLine?.value != null) {
    const y = Y(refLine.value);
    svg.appendChild(s('line', { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: 'ref-line' }));
    if (refLine.label) {
      const t = s('text', {
        x: width - pad.r - 4,
        y: y - 5,
        'text-anchor': 'end',
        class: 'tick-label ref-label',
      });
      t.textContent = refLine.label;
      svg.appendChild(t);
    }
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  svg.appendChild(s('path', { d, class: 'series-line' }));
  for (const p of points) {
    const dot = s('circle', { cx: X(p.x), cy: Y(p.y), r: 3, class: 'series-dot' });
    if (p.title) {
      const t = s('title');
      t.textContent = p.title;
      dot.appendChild(t);
    }
    svg.appendChild(dot);
  }
  if (yLabel) {
    const t = s('text', { x: pad.l, y: 10, class: 'tick-label' });
    t.textContent = yLabel;
    svg.appendChild(t);
  }
  return wrap;
}

export function datePoints(records, getY, getTitle) {
  return records
    .map((r) => ({ x: parseDateStr(r.date).getTime(), y: getY(r), title: getTitle?.(r) }))
    .filter((p) => p.y != null && !isNaN(p.y))
    .sort((a, b) => a.x - b.x);
}
