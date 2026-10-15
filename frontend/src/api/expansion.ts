// Network Expansion Engine (organisers): where to grow, which communities to link, actions taken and what worked.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../lib/session';
import { request } from './client';

export type ActionKind = 'recruit_drivers' | 'activate_riders' | 'invite_neighbours' | 'reactivate' | 'shared_corridor';
export interface Gap { code: 'drivers' | 'riders' | 'untapped' | 'retention' | 'isolated'; text: string; severity: number }
export interface Area {
  id: string; label: string; zones: string[]; lat: number; lon: number; score: number;
  joined: number; drivers: number; riders: number; potential: number | null; coverage: number | null;
  demand_7: number; unmet_7: number; unfilled_7: number; lapsed: number; rides_7: number;
  forecast: { demand_next_7: number; unmet_next_7: number; trend: 'rising' | 'falling' | 'steady' };
  gaps: Gap[];
}
export interface Finding { code: string; title: string; detail: string; severity: number }
export interface SharedCorridor {
  id: string; zone: string; area: string; heading: string; members_here: number; members_there: number;
  drivers_together: number; riders_together: number; viable_together: boolean;
}
export interface CommunityLink {
  community_id: number; community: string; synthetic: boolean; shared_corridors: SharedCorridor[];
  corridors_unlocked: number; members_near_destinations: number; recommendation: string;
}
export interface ExpansionAction {
  id: number; day: number; kind: ActionKind; label: string; area: string; reason: string; message: string; targeted: number;
  status: 'active' | 'evaluated' | 'proposed'; expected: number;
  baseline: { joined?: number; rides_7?: number };
  outcome: { sent?: number; responded?: number; joined_delta?: number; rides_delta?: number; success?: boolean; evaluated_day?: number };
}
export interface Effect { label: string; trials: number; successes: number; rate: number }
export interface ExpansionReport {
  day: number;
  network: { members_joined: number; roster_not_joined: number | null; zones_active: number; expansion_areas: number };
  diagnosis: Finding[];
  areas: Area[];
  next_actions: { kind: ActionKind; label: string; area: string; why: string; value: number }[];
  cross_community: CommunityLink[];
  actions: ExpansionAction[];
  effectiveness: Record<string, Effect>;
  privacy: string;
}

export const useExpansion = () => {
  const { tenantId } = useMe();
  return useQuery({ queryKey: ['expansion', tenantId], queryFn: () => request<ExpansionReport>(`/tenants/${tenantId}/expansion`), enabled: !!tenantId });
};

/** Every expansion action changes the community, so refresh everything the dashboard shows. */
function useExpansionAction<V, R>(fn: (tenantId: number, v: V) => Promise<R>) {
  const { tenantId } = useMe();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: V) => fn(tenantId, v), onSuccess: () => qc.invalidateQueries() });
}

export const useRunExpansion = () => useExpansionAction((t, maxActions: number) =>
  request<{ day: number; evaluated: number; actions: ExpansionAction[] }>(`/tenants/${t}/expansion/run`, { method: 'POST', body: { max_actions: maxActions } }));
export const useAutopilot = () => useExpansionAction((t, days: number) =>
  request<{ current_day: number; actions_taken: number }>(`/tenants/${t}/expansion/autopilot`, { method: 'POST', body: { days } }));
export const useProposeCorridor = () => useExpansionAction((t, v: { communityId: number; corridor: string }) =>
  request<ExpansionAction>(`/tenants/${t}/expansion/corridors`, { method: 'POST', body: { community_id: v.communityId, corridor: v.corridor } }));
export const useDemoNeighbour = () => useExpansionAction((t, _: void) =>
  request<{ id: number; name: string; created: boolean }>(`/tenants/${t}/expansion/demo-neighbour`, { method: 'POST' }));
