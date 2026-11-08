// GPS heatmap: accumulated route density across all synced activities with
// polylines. Lazy-loaded — Leaflet (~150 KB) only loads when this view opens.

import { decode } from '../../vendor/polyline.js';

let leafletReady = null;

function loadLeaflet() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = 'vendor/leaflet/leaflet.js';
    script.onload = () => {
      const heat = document.createElement('script');
      heat.src = 'vendor/leaflet-heat.js';
      heat.onload = () => resolve(window.L);
      heat.onerror = reject;
      document.head.appendChild(heat);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return leafletReady;
}

export async function show(container, entries) {
  const L = await loadLeaflet();
  container.innerHTML = '';

  const points = [];
  const bounds = L.latLngBounds([]);
  for (const entry of entries) {
    try {
      // Thin very long routes a little; density, not fidelity, is the goal.
      const coords = decode(entry.gpsPolyline);
      const step = coords.length > 500 ? 2 : 1;
      for (let i = 0; i < coords.length; i += step) {
        points.push(coords[i]);
        bounds.extend(coords[i]);
      }
    } catch {
      // Malformed polyline — skip the activity rather than break the map.
    }
  }

  const map = L.map(container);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  L.heatLayer(points, { radius: 8, blur: 12, minOpacity: 0.35 }).addTo(map);
  map.fitBounds(bounds.pad(0.1));

  let removed = false;
  return {
    destroy() {
      if (removed) return; // Leaflet throws if a map is removed twice
      removed = true;
      map.remove();
    },
  };
}
