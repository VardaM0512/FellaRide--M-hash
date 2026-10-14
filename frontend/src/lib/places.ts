// Places and routes from OpenStreetMap services: Nominatim (search an address, name a tapped point)
// and OSRM (driving routes). Both are free public servers meant for light use, which is fine for testing;
// if routing is unreachable we fall back to a straight line so posting a ride still works.
import type { Place } from '../api/trips';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OSRM = 'https://router.project-osrm.org';

interface NominatimHit { display_name: string; lat: string; lon: string; name?: string }

const shortName = (h: NominatimHit) => h.display_name.split(',').slice(0, 3).join(',').trim();

export async function searchPlaces(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '6' });
  if (near) {   // prefer results around where the person is, without excluding the rest
    const d = 0.4;
    params.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
  }
  const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Place search is unavailable right now. Tap the map instead.');
  const hits = (await res.json()) as NominatimHit[];
  return hits.map((h) => ({ name: shortName(h), lat: +(+h.lat).toFixed(5), lon: +(+h.lon).toFixed(5) }));
}

export async function nameOf(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lon}`, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const h = (await res.json()) as NominatimHit;
      if (h.display_name) return shortName(h);
    }
  } catch { /* offline: use coordinates */ }
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

export interface RouteOption { id: number; coords: [number, number][]; km: number; min: number; label: string; approximate: boolean }

/** Keep at most `max` points (the backend stores the route and checks distances along it). */
function thin(coords: [number, number][], max = 300): [number, number][] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

function straightLine(a: Place, b: Place): RouteOption {
  const coords: [number, number][] = Array.from({ length: 21 }, (_, i) => [
    +(a.lat + ((b.lat - a.lat) * i) / 20).toFixed(5), +(a.lon + ((b.lon - a.lon) * i) / 20).toFixed(5)]);
  const km = haversineKm(a, b) * 1.3;
  return { id: 0, coords, km: +km.toFixed(1), min: Math.round((km / 30) * 60), label: 'Direct (approximate)', approximate: true };
}

export async function routesBetween(a: Place, b: Place): Promise<RouteOption[]> {
  try {
    const res = await fetch(`${OSRM}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?alternatives=3&overview=full&geometries=geojson`);
    if (!res.ok) throw new Error();
    const data = await res.json() as { routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
    if (!data.routes?.length) throw new Error();
    return data.routes.map((r, i) => ({
      id: i,
      coords: thin(r.geometry.coordinates.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)] as [number, number])),
      km: +(r.distance / 1000).toFixed(1), min: Math.round(r.duration / 60),
      label: i === 0 ? 'Fastest route' : `Other route ${i}`, approximate: false,
    }));
  } catch {
    return [straightLine(a, b)];
  }
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location isn’t available in this browser. Search or tap the map.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5) }),
      (e) => reject(new Error(e.code === 1
        ? 'Location permission was denied. Search or tap the map instead.'
        : 'Couldn’t get your location. Search or tap the map instead.')),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
