export interface LatLon { lat: number; lon: number }

const OUTLIER_KM = 40;   // a point this far from the middle of the community doesn't get to zoom the map out

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Fit lat/lon points into a width x height box (equirectangular, fine at city scale).
 *  The view fits where most people are: a few far-away points (a ride to another city) are pinned to the edge
 *  instead of shrinking everyone else into a dot. */
export function makeProjection(points: LatLon[], width: number, height: number, pad = 24) {
  const mid = { lat: median(points.map((p) => p.lat)), lon: median(points.map((p) => p.lon)) };
  const km = (p: LatLon) => Math.hypot((p.lat - mid.lat) * 110.574, (p.lon - mid.lon) * 111.32 * Math.cos((mid.lat * Math.PI) / 180));
  const near = points.filter((p) => km(p) <= OUTLIER_KM);
  const fit = near.length >= Math.max(2, points.length * 0.8) ? near : points;
  const lats = fit.map((p) => p.lat);
  const lons = fit.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * kx, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const clamp = (v: number, max: number) => Math.min(max - pad / 2, Math.max(pad / 2, v));
  return (p: LatLon): [number, number] => [
    clamp(offX + (p.lon - minLon) * kx * scale, width), clamp(offY + (maxLat - p.lat) * scale, height)];
}
