// Plain-language wording. The backend uses engineering names; members never see them (brief: "Words to use in the UI").
import type { FeatureName, MemberState, Role } from '../api/types';

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;
export const firstName = (name: string) => name.split(' ')[0];

export const STATE_LABEL: Record<MemberState, string> = {
  discovered: 'Not joined yet',
  registered: 'Joined',
  interacted: 'Getting started',
  first_ride: 'First ride done',
  repeat: 'Rides regularly',
  referrer: 'Brought someone in',
};

export const ROLE_LABEL: Record<Role, string> = {
  driver: 'Likely to drive',
  rider: 'Likely to ride',
  connector: 'Well connected',
  referrer: 'Likely to invite',
};

export const FEATURE_LABEL: Record<Exclude<FeatureName, 'bias'>, string> = {
  has_car: 'Has a car',
  corridor_density: 'Lives on a busy route',
  recent_rides: 'Has ridden recently',
  social_degree: 'Knows many people here',
  past_response: 'Said yes to earlier suggestions',
};

export const FUNNEL_LABEL: Record<string, string> = {
  discovered: 'Found',
  registered: 'Joined',
  first_interaction: 'Getting started',
  first_ride: 'First ride done',
  repeat_ride: 'Rides regularly',
  referral: 'Brought someone in',
};

export function overlapWords(overlap: number) {
  if (overlap >= 0.95) return 'shares almost all your route';
  if (overlap >= 0.8) return 'shares most of your route';
  if (overlap >= 0.6) return 'shares much of your route';
  return 'shares part of your route';
}

export const minutesApart = (gap: number) => (gap === 0 ? 'leaves when you do' : `${gap} min apart`);
export const km = (v: number) => `${v < 0.1 ? '0.1' : v.toFixed(1)} km`;

/** "a person" / "3 people" */
export const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);

/** "just now", "5 min ago", "3 h ago", then a date. */
export function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  if (m < 7 * 24 * 60) return `${Math.round(m / 1440)} d ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
