// The last pickup point you searched from, kept on this device so Home can show departures near it
// and Find can start from it. Per signed-in user; storage can be unavailable, so every access is guarded.
import type { Place } from '../api/trips';

const key = (uid: number) => `fr.pickup.${uid}`;

export function savedPickup(uid: number | undefined): Place | null {
  if (!uid) return null;
  try {
    const v = JSON.parse(localStorage.getItem(key(uid)) || 'null');
    return v && typeof v.name === 'string' && typeof v.lat === 'number' && typeof v.lon === 'number' ? v : null;
  } catch { return null; }
}

export function savePickup(uid: number | undefined, p: Place) {
  if (!uid) return;
  try { localStorage.setItem(key(uid), JSON.stringify({ name: p.name, lat: p.lat, lon: p.lon })); } catch { /* not saved */ }
}
