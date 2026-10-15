// Organiser dashboard API: activity feed, member-app overview, referrals, broadcasts and community settings.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe, useSession } from '../lib/session';
import { request } from './client';
import type { TripsOverview } from './trips';
import type { Community } from './types';

export interface ActivityItem {
  id: number; day: number; type: string; at: string; source: 'app' | 'engine';
  member: { id: number; name: string | null } | null;
  detail: { via?: string; rating?: number; kind?: string; area?: string; how?: string };
}

export type Audience = 'all' | 'drivers' | 'riders' | 'new';
export interface SentBroadcast { id: number; title: string; body: string; audience: Audience; sent: number; created_at: string }
export interface BroadcastLog { audiences: Record<Audience, number>; sent: SentBroadcast[] }

export interface ReferralReport {
  joined: number; rode: number; by_link: number; by_invite: number; share_of_members: number; first_ride_rate: number;
  top: { user_id: number; name: string; joined: number }[];
}

/** Organiser-only reads that poll, so member-app activity shows up without a reload. Keys start [name, tenantId]. */
function useOrgQuery<T>(key: string, path: string, every = 20_000) {
  const { tenantId, isAdmin } = useMe();
  return useQuery({ queryKey: [key, tenantId], queryFn: () => request<T>(`/tenants/${tenantId}${path}`), enabled: isAdmin && !!tenantId, refetchInterval: every });
}

export const useActivity = () => useOrgQuery<ActivityItem[]>('activity', '/activity?limit=60', 15_000);
export const useTripsOverview = () => useOrgQuery<TripsOverview>('trips-overview', '/trips-overview', 15_000);
export const useOrgReferrals = () => useOrgQuery<ReferralReport>('org-referrals', '/referrals');
export const useBroadcasts = () => useOrgQuery<BroadcastLog>('broadcasts', '/broadcasts', 60_000);

export function useSendBroadcast() {
  const { tenantId } = useMe();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { title: string; body: string; audience: Audience }) =>
      request<{ sent: number }>(`/tenants/${tenantId}/broadcast`, { method: 'POST', body: b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcasts', tenantId] }),
  });
}

export function useReviewReport() {
  const { tenantId } = useMe();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request(`/tenants/${tenantId}/reports/${id}/review`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips-overview', tenantId] }),
  });
}

/** Rename the community; the sidebar and every page pick up the new name straight away. */
export function useRenameCommunity() {
  const { tenantId } = useMe();
  const { session, update } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => request<Community>(`/tenants/${tenantId}`, { method: 'PUT', body: { name } }),
    onSuccess: (t) => {
      qc.setQueryData(['community', tenantId], t);
      if (session) update({ ...session, tenant: { ...session.tenant, name: t.name } });
    },
  });
}
