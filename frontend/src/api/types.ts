// Types built from responses captured from the running Sprint 1 API (see the frontend brief).

export type MemberState = 'discovered' | 'registered' | 'interacted' | 'first_ride' | 'repeat' | 'referrer';
export type Role = 'driver' | 'rider' | 'connector' | 'referrer';

export interface Destination { id: number; name: string; lat: number; lon: number }

export interface Community {
  id: number;
  name: string;
  kind: string;
  center: { lat: number; lon: number };
  current_day: number;
  synthetic: boolean;
  destinations: Destination[];
}

export interface Funnel {
  registered_day: number | null;
  interacted_day: number | null;
  first_ride_day: number | null;
  repeat_day: number | null;
  referrer_day: number | null;
}

export interface Member {
  id: number;
  name: string;
  area: string;
  state: MemberState;
  home: { lat: number; lon: number };
  destination_id: number;
  destination: string | null;
  depart_time: string;
  depart_min: number;
  has_car: boolean;
  seats: number;
  ride_pref: 'quiet' | 'music' | 'any';
  is_connector: boolean;
  rides_count: number;
  last_ride_day: number | null;
  nudges_received: number;
  nudges_responded: number;
  funnel: Funnel;
  synthetic: boolean;
}

export type FeatureName = 'has_car' | 'corridor_density' | 'recent_rides' | 'social_degree' | 'past_response' | 'bias';

export interface MemberProfile extends Member {
  features: Record<FeatureName, number>;
  scores: Record<Role, number>;
  corridor: { key: string; area: string; size: number; registered: number; drivers: number; riders: number; hot: boolean };
  social_ties: number;
  ride_partners: number;
}

export interface MatchBreakdown { score: number; route_overlap: number; detour_km: number; time_gap_min: number; preference_fit: number }
export interface Recommendations { member_id: number; looking_for: 'drivers' | 'riders'; partners: { member: Member; match: MatchBreakdown }[] }

export type InterventionKind = 'driver' | 'rider' | 'connector' | 'generic' | 'reactivate';
export interface Intervention {
  id: number;
  member_id: number;
  day: number;
  kind: InterventionKind;
  strategy: 'smart' | 'random';
  message: string;
  suggested_member_id: number | null;
  priority: number;
  status: 'sent' | 'responded' | 'ignored';
}
export interface PlanResult { day: number; count: number; interventions: Intervention[] }
export interface RespondResult { intervention_id: number; status: string; offer_id: number | null; request_id: number | null }

export type OfferStatus = 'open' | 'full' | 'completed' | 'cancelled' | 'unfilled';
export interface RideOffer {
  id: number;
  driver_id: number;
  destination_id: number;
  day: number;
  depart_min: number;
  seats_total: number;
  seats_left: number;
  status: OfferStatus;
  riders: { rider_id: number; match_score: number; status: 'booked' | 'completed' | 'cancelled' }[];
}
export interface RidesForDay { day: number; offers: RideOffer[]; open_requests: { id: number; rider_id: number; depart_min: number }[] }
export interface MatchRunResult { day: number; matched: number; bookings: { id: number; offer_id: number; driver_id: number; rider_id: number; score: number }[] }

export interface InviteSuggestion { member_id: number; name: string; area: string; rider_propensity: number; hot_corridor: boolean; rank_score: number }
export interface Referral { id: number; inviter_id: number; invitee_id: number; status: 'sent' | 'joined' | 'expired'; day: number }

export interface Kpis {
  day: number;
  members_total: number;
  registered: number;
  active_users: number;
  rides_created: number;
  rides_completed: number;
  match_rate: number;
  completion_rate: number;
  repeat_rate: number;
  avg_network_connectivity: number;
  nudge_response_rate_7d: number;
  referral_conversion: number;
}
export interface DailySnapshot extends Kpis { rides_completed_today: number; riders_seated_today: number }
export interface FunnelStep { step: 'discovered' | 'registered' | 'first_interaction' | 'first_ride' | 'repeat_ride' | 'referral'; count: number; conversion_from_previous: number | null }

export interface GraphNode { id: number; name: string; state: MemberState; has_car: boolean; connector: boolean; lat: number; lon: number; rides: number }
export interface GraphEdge { source: number; target: number; kind: 'social' | 'co_ride' | 'referral'; weight: number; since_day: number }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

export interface Corridor {
  key: string; area: string; destination: string | null; window: string; size: number;
  registered: number; drivers: number; riders: number; hot: boolean; lat: number; lon: number; member_ids: number[];
}

export type ModelWeights = Record<Role, { weights: Record<FeatureName, number>; updates: number }>;

export interface CompareRun { tenant_id: number; kpis: Kpis; funnel: FunnelStep[]; timeseries: { day: number; active_users: number; rides_completed_today: number; registered: number }[] }
export interface CompareResult { smart: CompareRun; random: CompareRun; lift: Record<'active_users' | 'rides_completed' | 'registered' | 'match_rate', number | null> }
