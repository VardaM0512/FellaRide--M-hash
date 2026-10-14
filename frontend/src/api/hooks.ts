import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { request, t } from './client';
import type {
  Community, CompareResult, Corridor, DailySnapshot, FunnelStep, Graph, Intervention, InviteSuggestion, Kpis, Member,
  MatchRunResult, MemberProfile, MemberState, ModelWeights, PlanResult, Recommendations, Referral, RespondResult,
  RideOffer, RidesForDay,
} from './types';
import { TENANT_ID } from './client';

export const keys = {
  community: ['community', TENANT_ID] as const,
  members: (state?: string) => ['members', TENANT_ID, state ?? 'all'] as const,
  member: (id: number) => ['member', TENANT_ID, id] as const,
  recs: (id: number) => ['recs', TENANT_ID, id] as const,
  interventions: (day: number, memberId?: number) => ['interventions', TENANT_ID, day, memberId ?? 'all'] as const,
  rides: (day: number) => ['rides', TENANT_ID, day] as const,
  invites: (id: number) => ['invites', TENANT_ID, id] as const,
  metrics: ['metrics', TENANT_ID] as const,
  timeseries: ['timeseries', TENANT_ID] as const,
  funnel: ['funnel', TENANT_ID] as const,
  graph: ['graph', TENANT_ID] as const,
  clusters: ['clusters', TENANT_ID] as const,
  model: ['model', TENANT_ID] as const,
};

/** The community the app shows (VITE_TENANT_ID, default 1 = the synthetic demo). */
export function useCommunity() {
  return useQuery({
    queryKey: keys.community,
    queryFn: async () => {
      const all = await request<Community[]>('/tenants');
      const c = all.find((x) => x.id === TENANT_ID);
      if (!c) throw new Error(`Community ${TENANT_ID} not found. Start the API once so it seeds the demo community.`);
      return c;
    },
  });
}

export const useMembers = (state?: MemberState, includeAll = false) =>
  useQuery({
    queryKey: keys.members(includeAll ? 'everyone' : state),
    queryFn: () => request<Member[]>(t(`/members?limit=1000${state ? `&state=${state}` : ''}`)),
  });

/** One lookup table id -> member, for rides and nudges that only carry ids. */
export function useMemberMap() {
  const q = useMembers(undefined, true);
  const map = new Map<number, Member>();
  for (const m of q.data || []) map.set(m.id, m);
  return { ...q, map };
}

export const useMember = (id: number | null) =>
  useQuery({ queryKey: keys.member(id ?? -1), queryFn: () => request<MemberProfile>(t(`/members/${id}`)), enabled: id !== null });

export const useMemberProfiles = (ids: number[]) =>
  useQueries({ queries: ids.map((id) => ({ queryKey: keys.member(id), queryFn: () => request<MemberProfile>(t(`/members/${id}`)) })) });

export const useRecommendations = (id: number | null) =>
  useQuery({ queryKey: keys.recs(id ?? -1), queryFn: () => request<Recommendations>(t(`/members/${id}/recommendations?limit=5`)), enabled: id !== null });

export const useInterventions = (day: number | undefined, memberId?: number | null) =>
  useQuery({
    queryKey: keys.interventions(day ?? -1, memberId ?? undefined),
    queryFn: () => request<Intervention[]>(t(`/interventions?day=${day}${memberId ? `&member_id=${memberId}` : ''}&limit=200`)),
    enabled: day !== undefined && memberId !== null,
  });

export const useRides = (day: number | undefined) =>
  useQuery({ queryKey: keys.rides(day ?? -1), queryFn: () => request<RidesForDay>(t(`/rides?day=${day}`)), enabled: day !== undefined });

export const useInviteSuggestions = (id: number | null) =>
  useQuery({ queryKey: keys.invites(id ?? -1), queryFn: () => request<InviteSuggestion[]>(t(`/members/${id}/invite-suggestions`)), enabled: id !== null });

export const useMetrics = () => useQuery({ queryKey: keys.metrics, queryFn: () => request<Kpis>(t('/metrics')) });
export const useTimeseries = () => useQuery({ queryKey: keys.timeseries, queryFn: () => request<DailySnapshot[]>(t('/metrics/timeseries')) });
export const useFunnel = () => useQuery({ queryKey: keys.funnel, queryFn: () => request<FunnelStep[]>(t('/metrics/funnel')) });
export const useGraph = () => useQuery({ queryKey: keys.graph, queryFn: () => request<Graph>(t('/graph?include_discovered=true')) });
export const useClusters = () => useQuery({ queryKey: keys.clusters, queryFn: () => request<Corridor[]>(t('/clusters?hot_only=true')) });
export const useModel = () => useQuery({ queryKey: keys.model, queryFn: () => request<ModelWeights>(t('/model')) });

/** After any action, refetch everything that could have changed (cheap at this data size). */
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === TENANT_ID });
}

function useAction<TVars, TResult>(fn: (v: TVars) => Promise<TResult>) {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: fn, onSuccess: () => refresh() });
}

export const useRespond = () =>
  useAction(({ id, responded }: { id: number; responded: boolean }) =>
    request<RespondResult>(t(`/interventions/${id}/respond`), { method: 'POST', body: { responded } }));

export const useOfferSeats = () =>
  useAction(({ memberId, seats }: { memberId: number; seats: number }) =>
    request<RideOffer>(t('/rides/offers'), { method: 'POST', body: { member_id: memberId, seats } }));

export const useAskSeat = () =>
  useAction(({ memberId }: { memberId: number }) => request<{ id: number }>(t('/rides/requests'), { method: 'POST', body: { member_id: memberId } }));

export const useFinishRide = () =>
  useAction(({ offerId, completed }: { offerId: number; completed: boolean }) =>
    request<RideOffer>(t(`/rides/offers/${offerId}/finish`), { method: 'POST', body: { completed } }));

export const useSendInvite = () =>
  useAction(({ inviterId, inviteeId }: { inviterId: number; inviteeId: number }) =>
    request<Referral>(t('/referrals'), { method: 'POST', body: { inviter_id: inviterId, invitee_id: inviteeId } }));

export const useAcceptInvite = () =>
  useAction(({ referralId }: { referralId: number }) => request<Referral>(t(`/referrals/${referralId}/accept`), { method: 'POST' }));

// ----- operator panel (dashboard) -----
export const usePlanNudges = () =>
  useAction((budget: number) => request<PlanResult>(t('/interventions/plan'), { method: 'POST', body: { budget } }));
export const useMatchRides = () => useAction(() => request<MatchRunResult>(t('/rides/match'), { method: 'POST' }));
export const useCloseDay = () => useAction(() => request<Kpis>(t('/day/close'), { method: 'POST', admin: true }));
export const useSimulate = () =>
  useAction((days: number) => request<unknown>(t('/simulate'), { method: 'POST', body: { days }, admin: true }));
export const useCompare = () =>
  useMutation({ mutationFn: (days: number) => request<CompareResult>('/demo/compare', { method: 'POST', body: { days }, admin: true }) });
