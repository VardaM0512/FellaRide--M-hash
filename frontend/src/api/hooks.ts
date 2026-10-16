import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../lib/session';
import { request } from './client';
import type {
  Community, CompareResult, Corridor, DailySnapshot, DemoAccount, FeedbackDue, FunnelStep, Graph, Inbox, Intervention,
  InviteSuggestion, Kpis, Member, MatchRunResult, MemberProfile, ModelWeights, PlanResult, Recommendations, Referral,
  RespondResult, RideOffer, RideRequest, RidesForDay, Session,
} from './types';

/** Path under the signed-in community: useT()('/members') -> /tenants/1/members */
function useT() {
  const { tenantId } = useMe();
  return (path: string) => `/tenants/${tenantId}${path}`;
}

// ---------- public / auth ----------
export const usePublicCommunities = () => useQuery({ queryKey: ['public', 'tenants'], queryFn: () => request<Community[]>('/tenants', { auth: false }) });
export const useDemoAccounts = (tenantId: number | undefined, q: string) =>
  useQuery({
    queryKey: ['public', 'demo-accounts', tenantId, q],
    queryFn: () => request<DemoAccount[]>(`/tenants/${tenantId}/demo-accounts?limit=60${q ? `&q=${encodeURIComponent(q)}` : ''}`, { auth: false }),
    enabled: !!tenantId,
  });
export const login = (email: string, password: string) => request<Session>('/auth/login', { method: 'POST', body: { email, password }, auth: false });
export const forgotPassword = (email: string) =>
  request<{ ok: boolean; message: string }>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });
/** Set a new password with the emailed link's token, or with the email address and the 6-digit code. */
export const resetPassword = (proof: { token: string } | { email: string; code: string }, password: string) =>
  request<Session>('/auth/reset-password', { method: 'POST', body: { ...proof, password }, auth: false });
export const deleteAccount = (password: string) => request<{ ok: boolean }>('/me/delete', { method: 'POST', body: { password } });
export const demoLogin = (tenantId: number, memberId: number) => request<Session>('/auth/demo-login', { method: 'POST', body: { tenant_id: tenantId, member_id: memberId }, auth: false });
export const lookupJoinCode = (code: string) => request<Community>(`/join/${encodeURIComponent(code)}`, { auth: false });
export const register = (body: Record<string, unknown>) => request<Session>('/auth/register', { method: 'POST', body, auth: false });
export const createCommunity = (body: Record<string, unknown>) =>
  request<Community & { join_code: string; session: Session }>('/tenants', { method: 'POST', body, auth: false });

// ---------- signed-in member ----------
export function useCommunity() {
  const t = useT();
  const { tenantId } = useMe();
  return useQuery({ queryKey: ['community', tenantId], queryFn: () => request<Community>(t('')), enabled: !!tenantId });
}

export function useMember(id: number | null) {
  const t = useT();
  const { tenantId } = useMe();
  return useQuery({ queryKey: ['member', tenantId, id], queryFn: () => request<MemberProfile>(t(`/members/${id}`)), enabled: id !== null && !!tenantId });
}

export function useMemberProfiles(ids: number[]) {
  const t = useT();
  const { tenantId } = useMe();
  return useQueries({ queries: ids.map((id) => ({ queryKey: ['member', tenantId, id], queryFn: () => request<MemberProfile>(t(`/members/${id}`)) })) });
}

export function useRecommendations(id: number | null) {
  const t = useT();
  const { tenantId } = useMe();
  return useQuery({ queryKey: ['recs', tenantId, id], queryFn: () => request<Recommendations>(t(`/members/${id}/recommendations?limit=5`)), enabled: id !== null });
}

export function useInterventions(day: number | undefined, memberId?: number | null) {
  const t = useT();
  const { tenantId } = useMe();
  return useQuery({
    queryKey: ['interventions', tenantId, day, memberId ?? 'all'],
    queryFn: () => request<Intervention[]>(t(`/interventions?day=${day}${memberId ? `&member_id=${memberId}` : ''}&limit=200`)),
    enabled: day !== undefined && memberId !== null,
  });
}

/** Today's rides. Polls while something is in motion so "matched" and "started" appear without a refresh. */
export function useRides(day: number | undefined, poll = false) {
  const t = useT();
  const { tenantId } = useMe();
  return useQuery({
    queryKey: ['rides', tenantId, day],
    queryFn: () => request<RidesForDay>(t(`/rides?day=${day}`)),
    enabled: day !== undefined,
    refetchInterval: poll ? 8_000 : false,
  });
}

export function useInviteSuggestions(id: number | null) {
  const t = useT();
  const { tenantId } = useMe();
  return useQuery({ queryKey: ['invites', tenantId, id], queryFn: () => request<InviteSuggestion[]>(t(`/members/${id}/invite-suggestions`)), enabled: id !== null });
}

export function useMyReferrals() {
  const t = useT();
  const { tenantId, memberId } = useMe();
  return useQuery({ queryKey: ['my-referrals', tenantId, memberId], queryFn: () => request<Referral[]>(t('/me/referrals')), enabled: memberId !== null });
}

export function useInbox() {
  const t = useT();
  const { tenantId, memberId } = useMe();
  return useQuery({
    queryKey: ['inbox', tenantId, memberId],
    queryFn: () => request<Inbox>(t('/me/notifications?limit=50')),
    enabled: memberId !== null,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
}

export function useFeedbackDue() {
  const t = useT();
  const { tenantId, memberId } = useMe();
  return useQuery({ queryKey: ['feedback-due', tenantId, memberId], queryFn: () => request<FeedbackDue[]>(t('/me/feedback-due')), enabled: memberId !== null, refetchInterval: 20_000 });
}

// ---------- admin ----------
// Live: member-app activity (sign-ups, rides, invites) shows up on the dashboard without a reload.
function useAdminQuery<T>(key: string, path: string) {
  const t = useT();
  const { tenantId, isAdmin } = useMe();
  return useQuery({ queryKey: [key, tenantId], queryFn: () => request<T>(t(path)), enabled: isAdmin, refetchInterval: 20_000 });
}
export const useMembers = () => useAdminQuery<Member[]>('members', '/members?limit=1000');
export function useMemberMap() {
  const q = useMembers();
  const map = new Map<number, Member>();
  for (const m of q.data || []) map.set(m.id, m);
  return { ...q, map };
}
export const useMetrics = () => useAdminQuery<Kpis>('metrics', '/metrics');
export const useTimeseries = () => useAdminQuery<DailySnapshot[]>('timeseries', '/metrics/timeseries');
export const useFunnel = () => useAdminQuery<FunnelStep[]>('funnel', '/metrics/funnel');
export const useGraph = () => useAdminQuery<Graph>('graph', '/graph?include_discovered=true');
export const useClusters = () => useAdminQuery<Corridor[]>('clusters', '/clusters?hot_only=true');
export const useModel = () => useAdminQuery<ModelWeights>('model', '/model');

// ---------- actions ----------
/** After any action, refetch everything for this community (cheap at this data size). */
export function useRefreshAll() {
  const qc = useQueryClient();
  const { tenantId } = useMe();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === tenantId });
}

function useAction<TVars, TResult>(fn: (t: (p: string) => string, v: TVars) => Promise<TResult>) {
  const t = useT();
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (v: TVars) => fn(t, v), onSuccess: () => refresh() });
}

export const useRespond = () => useAction((t, { id, responded }: { id: number; responded: boolean }) =>
  request<RespondResult>(t(`/interventions/${id}/respond`), { method: 'POST', body: { responded } }));
export const useOfferSeats = () => useAction((t, { seats }: { seats: number }) =>
  request<RideOffer>(t('/rides/offers'), { method: 'POST', body: { seats } }));
export const useAskSeat = () => useAction((t, { preferredDriverId }: { preferredDriverId?: number | null }) =>
  request<RideRequest>(t('/rides/requests'), { method: 'POST', body: preferredDriverId ? { preferred_driver_id: preferredDriverId } : {} }));
export const useCancelRequest = () => useAction((t, { requestId }: { requestId: number }) =>
  request<RideRequest>(t(`/rides/requests/${requestId}/cancel`), { method: 'POST' }));
export const useStartRide = () => useAction((t, { offerId }: { offerId: number }) =>
  request<RideOffer>(t(`/rides/offers/${offerId}/start`), { method: 'POST' }));
export const useFinishRide = () => useAction((t, { offerId, completed }: { offerId: number; completed: boolean }) =>
  request<RideOffer>(t(`/rides/offers/${offerId}/finish`), { method: 'POST', body: { completed } }));
export const useSendInvite = () => useAction((t, { inviteeId }: { inviteeId: number }) =>
  request<Referral>(t('/referrals'), { method: 'POST', body: { invitee_id: inviteeId } }));
export const useAcceptInvite = () => useAction((t, { referralId }: { referralId: number }) =>
  request<Referral>(t(`/referrals/${referralId}/accept`), { method: 'POST' }));
export const useGiveFeedback = () => useAction((t, v: { bookingId: number; rating: number; tags: string[]; comment: string }) =>
  request(t(`/rides/bookings/${v.bookingId}/feedback`), { method: 'POST', body: { rating: v.rating, tags: v.tags, comment: v.comment } }));
export const useMarkRead = () => useAction((t, ids: number[] | null) =>
  request(t('/me/notifications/read'), { method: 'POST', body: ids ? { ids } : {} }));

export const usePlanNudges = () => useAction((t, budget: number) => request<PlanResult>(t('/interventions/plan'), { method: 'POST', body: { budget } }));
export const useMatchRides = () => useAction((t) => request<MatchRunResult>(t('/rides/match'), { method: 'POST' }));
export const useCloseDay = () => useAction((t) => request<{ closed_day: number; current_day: number }>(t('/day/close'), { method: 'POST' }));
export const useSimulate = () => useAction((t, days: number) => request<unknown>(t('/simulate'), { method: 'POST', body: { days } }));
export const useCompare = () => useMutation({ mutationFn: (days: number) => request<CompareResult>('/demo/compare', { method: 'POST', body: { days } }) });
