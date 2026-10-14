export interface LatLon { lat: number; lon: number }

/** Fit lat/lon points into a width x height box (equirectangular, fine at city scale). */
export function makeProjection(points: LatLon[], width: number, height: number, pad = 24) {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * kx, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((width - 2 * pad) / spanX, (height - 2 * pad) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return (p: LatLon): [number, number] => [offX + (p.lon - minLon) * kx * scale, offY + (maxLat - p.lat) * scale];
}
