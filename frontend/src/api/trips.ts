// Member app API (Sprint 3): profile, trips, seat requests, chat, ratings, reports, alerts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../lib/session';
import { request } from './client';

export type Gender = 'female' | 'male' | 'other' | 'unsaid';
export interface Rating { average: number | null; count: number }
export interface Person { id: number; name: string; gender: Gender; rating: Rating; mobile?: string | null }
export interface Place { name: string; lat: number; lon: number }
/** The driver's car. `plate` is null until you're approved for the ride. */
export interface Car { model: string; colour: string; plate: string | null }

export type TripStatus = 'open' | 'started' | 'completed' | 'cancelled' | 'expired';
export type SeatStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'boarded' | 'dropped' | 'missed' | 'cancelled';
export interface RateTarget extends Person { role: 'driver' | 'rider'; rated: boolean }

export interface Trip {
  id: number;
  status: TripStatus;
  from: Place;
  to: Place;
  depart_at: string;
  started_at: string | null;
  route: [number, number][];
  route_km: number;
  route_min: number;
  seats_total: number;
  seats_left: number;
  driver: Person;
  car: Car | null;
  you: 'driver' | 'rider' | 'none';
  my_seat: { id: number; status: SeatStatus } | null;
  code: string | null;
  riders: { seat_id: number; status: SeatStatus; pickup_name: string; person: Person }[];
  to_rate?: RateTarget[];
  pickup_km?: number;
  drop_km?: number | null;
  notified?: number;
}

export interface MyTrips { active: Trip | null; pending: Trip[]; history: (Trip & { to_rate: number })[] }
export interface Alert { id: number; kind: string; title: string; body: string; trip_id: number | null; read: boolean; created_at: string }
export interface Alerts { unread: number; items: Alert[] }
export interface ChatMessage { id: number; user_id: number; name: string; body: string; created_at: string }
export interface ReportReason { code: string; category: 'safety' | 'fraud' | 'reliability' | 'conduct' | 'other'; label: string }
export interface Profile { name: string; gender: Gender; mobile: string | null; rating: Rating; car?: Car | null }

export interface TripInput {
  from_name: string; from_lat: number; from_lon: number; to_name: string; to_lat: number; to_lon: number;
  depart_at: string; route: [number, number][]; route_km: number; route_min: number; seats: number;
  car: { model: string; colour: string; plate: string };
  licence_confirmed: boolean;
}

function useUserKey() {
  const { session } = useSession();
  return session?.user.id ?? 0;
}

export const useMyTrips = () => {
  const uid = useUserKey();
  return useQuery({ queryKey: ['trips', 'mine', uid], queryFn: () => request<MyTrips>('/me/trips'), refetchInterval: 10_000 });
};

export const useTrip = (id: number) => {
  const uid = useUserKey();
  return useQuery({ queryKey: ['trips', id, uid], queryFn: () => request<Trip>(`/trips/${id}`), refetchInterval: 5_000 });
};

export const useAlerts = () => {
  const uid = useUserKey();
  return useQuery({
    queryKey: ['alerts', uid], queryFn: () => request<Alerts>('/me/alerts?limit=60'),
    refetchInterval: 8_000, refetchIntervalInBackground: true,
  });
};

export const useChat = (tripId: number, enabled: boolean) => useQuery({
  queryKey: ['chat', tripId], queryFn: () => request<ChatMessage[]>(`/trips/${tripId}/messages`), enabled, refetchInterval: 4_000,
});

export const useReportReasons = () => useQuery({ queryKey: ['report-reasons'], queryFn: () => request<ReportReason[]>('/report-reasons'), staleTime: Infinity });

export const searchTrips = (p: { from: Place; to: Place | null; when: string | null }) => {
  const q = new URLSearchParams({ from_lat: String(p.from.lat), from_lon: String(p.from.lon) });
  if (p.to) { q.set('to_lat', String(p.to.lat)); q.set('to_lon', String(p.to.lon)); }
  if (p.when) q.set('when', p.when);
  return request<Trip[]>(`/trips/search?${q}`);
};

/** Home's departure board: upcoming rides passing near your usual pickup, refreshed every 30 seconds. */
export const useDepartures = (from: Place | null) => {
  const uid = useUserKey();
  return useQuery({
    queryKey: ['trips', 'board', uid, from?.lat, from?.lon], enabled: !!from,
    queryFn: () => searchTrips({ from: from!, to: null, when: null }), refetchInterval: 30_000,
  });
};

/** Any change to a trip: refresh trips, alerts and chat right away instead of waiting for the next poll. */
function useTripAction<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => ['trips', 'alerts', 'chat'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

export const usePostTrip = () => useTripAction((body: TripInput) => request<Trip>('/trips', { method: 'POST', body }));
export const useTripStep = () => useTripAction(({ tripId, path, body }: { tripId: number; path: string; body?: unknown }) =>
  request<Trip>(`/trips/${tripId}/${path}`, { method: 'POST', body: body ?? {} }));
export const useSendChat = () => useTripAction(({ tripId, body, update }: { tripId: number; body: string; update?: boolean }) =>
  request(`/trips/${tripId}/${update ? 'notify' : 'messages'}`, { method: 'POST', body: { body } }));
export const useRate = () => useTripAction(({ tripId, toId, stars, comment }: { tripId: number; toId: number; stars: number; comment: string }) =>
  request(`/trips/${tripId}/ratings`, { method: 'POST', body: { to_id: toId, stars, comment } }));
export const useReport = () => useMutation({
  mutationFn: (body: { trip_id: number; reported_id: number; reasons: string[]; note: string }) =>
    request<{ id: number; category: string }>('/reports', { method: 'POST', body }),
});
export const useMarkAlertsRead = () => useTripAction((ids: number[] | null) => request('/me/alerts/read', { method: 'POST', body: ids ? { ids } : {} }));
export const saveProfile = (body: { name: string; gender: Gender; mobile: string }) => request<Profile>('/me/profile', { method: 'PUT', body });
export const shareLocation = (lat: number, lon: number) => request('/me/location', { method: 'POST', body: { lat, lon } });
export const signup = (body: Record<string, unknown>) => request<import('./types').Session>('/auth/signup', { method: 'POST', body, auth: false });

// ---------- invites ----------
export interface Invite { id: number; name: string; email: string; status: 'sent' | 'joined' | 'expired'; day: number }
export interface Invites { community: string; join_code: string | null; invites: Invite[] }

export const useInvites = () => {
  const uid = useUserKey();
  return useQuery({ queryKey: ['my-invites', uid], queryFn: () => request<Invites>('/me/invites'), refetchInterval: 15_000 });
};
export const useSendInvite = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string }) => request<Invite>('/me/invites', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-invites'] }),
  });
};

// ---------- organiser ----------
export interface TripsOverview {
  trips: Partial<Record<TripStatus, number>>; riders_carried: number; avg_rating: number | null; penalties: number;
  open_reports_by_category: Record<string, number>;
  reports: { id: number; trip_id: number; category: string; severity: 'high' | 'medium' | 'low'; status: 'open' | 'reviewed';
    reasons: string[]; note: string; reporter: Person; reported: Person; created_at: string }[];
}
