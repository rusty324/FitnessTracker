// Decoder for Google's encoded polyline algorithm format, as used by
// Strava's map.summary_polyline (precision 5). Decode-only ES module,
// equivalent to @mapbox/polyline's decode().
// Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm

export function decode(str, precision = 5) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < str.length) {
    lat += readDelta();
    lng += readDelta();
    coords.push([lat / factor, lng / factor]);
  }
  return coords; // [[lat, lng], ...]

  function readDelta() {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
