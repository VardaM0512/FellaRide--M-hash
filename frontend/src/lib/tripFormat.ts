// Wording for the member app.
import type { Gender, Rating, SeatStatus, TripStatus } from '../api/trips';

export const GENDER_LABEL: Record<Gender, string> = { female: 'Woman', male: 'Man', other: 'Non-binary', unsaid: 'Prefers not to say' };
export const GENDER_OPTIONS: [Gender, string][] = [['female', 'Woman'], ['male', 'Man'], ['other', 'Non-binary'], ['unsaid', 'Prefer not to say']];

export const ratingText = (r: Rating) => (r.average === null ? 'New' : `★ ${r.average.toFixed(1)} (${r.count})`);

/** "Today 08:30", "Tomorrow 18:05", "Fri 12 Oct 09:00" in the viewer's own time zone. */
export function whenLabel(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(today)) / 86_400_000);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff === -1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export function minutesUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

export const TRIP_STATUS: Record<TripStatus, string> = {
  open: 'Taking riders', started: 'On the way', completed: 'Ride complete', cancelled: 'Cancelled', expired: 'Expired',
};

export const SEAT_STATUS: Record<SeatStatus, string> = {
  pending: 'Waiting for approval', approved: 'Approved, not in yet', rejected: 'Declined', withdrawn: 'Withdrew',
  boarded: 'In the car', dropped: 'Got off', missed: 'Left behind', cancelled: 'Ride cancelled',
};

/** <input type="datetime-local"> value for a Date, in local time. */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Now plus `mins`, rounded up to the next 5 minutes. */
export function soon(mins = 30) {
  const d = new Date(Date.now() + mins * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}
