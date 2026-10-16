// Community: the board (posts, reactions, replies), activity from real rides, weekly challenge, leaderboard, your impact.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../lib/session';
import { request } from './client';
import type { Session } from './types';

export type PostKind = 'update' | 'ask' | 'offer' | 'thanks' | 'tip';
export type Emoji = 'thumbs' | 'heart' | 'party' | 'thanks';

export interface Post {
  type: 'post'; id: number; kind: PostKind; body: string; author: string; mine: boolean; created_at: string;
  reactions: Record<Emoji, number>; my_reactions: Emoji[]; comments: number;
}
export interface Activity { type: 'activity'; id: string; kind: 'ride' | 'join' | 'invite'; text: string; day: number; created_at: string }
export type FeedItem = Post | Activity;
export interface Comment { id: number; author: string; body: string; mine: boolean; created_at: string }

export interface Challenge { title: string; goal: number; progress: number; seats_filled: number; last_week: number; days_left: number }
export interface LeaderRow { rank: number; name: string; value: number; rides: number; drove: number; me: boolean }
export interface Overview {
  community: string;
  stats: { members: number; rides_total: number; rides_week: number; seats_total: number; km_total: number; co2_kg: number; connections: number };
  challenge: Challenge;
  top: LeaderRow[];
}
export interface Badge { code: string; label: string; desc: string; earned: boolean; progress: number; have: number; need: number }
export interface Impact {
  rides: number; drove: number; km: number; co2_kg: number; people_met: number; streak_weeks: number; rank: number | null; badges: Badge[];
}
export type Metric = 'rides' | 'co2' | 'people';
export type Period = 'week' | 'all';

// ---------- which community you're in ----------
export interface CommunityBrief {
  id: number; name: string; kind: string; open: boolean; synthetic: boolean; members: number; destinations: string[];
}
export interface MyCommunity {
  current: CommunityBrief & { join_code: string | null; your_rides: number };
  /** False while a ride here is still open, or for an organiser account: `blocked` says why. */
  can_switch: boolean;
  blocked: string | null;
  /** The one community offered by name. Null when you're already in it; any other needs its join code. */
  open_community: CommunityBrief | null;
}

const useUid = () => useSession().session?.user.id ?? 0;

export const useMyCommunity = () => {
  const uid = useUid();
  return useQuery({ queryKey: ['community', 'mine', uid], queryFn: () => request<MyCommunity>('/me/community') });
};
/** Move to the community with this join code, or to the open one when there's no code. Returns a new session. */
export const switchCommunity = (joinCode?: string) =>
  request<Session>('/me/community', { method: 'POST', body: { join_code: joinCode?.trim().toUpperCase() || null } });

export const useOverview = () => {
  const uid = useUid();
  return useQuery({ queryKey: ['community', 'overview', uid], queryFn: () => request<Overview>('/community/overview'), refetchInterval: 30_000 });
};
export const useFeed = (show: 'all' | 'posts' | 'activity') => {
  const uid = useUid();
  return useQuery({ queryKey: ['community', 'feed', show, uid], queryFn: () => request<{ items: FeedItem[] }>(`/community/feed?show=${show}`), refetchInterval: 15_000 });
};
export const useLeaderboard = (period: Period, metric: Metric) => {
  const uid = useUid();
  return useQuery({
    queryKey: ['community', 'board', period, metric, uid],
    queryFn: () => request<{ rows: LeaderRow[]; me: LeaderRow | null }>(`/community/leaderboard?period=${period}&metric=${metric}`),
  });
};
export const useImpact = () => {
  const uid = useUid();
  return useQuery({ queryKey: ['community', 'me', uid], queryFn: () => request<Impact>('/community/me') });
};
export const useComments = (postId: number, enabled: boolean) => useQuery({
  queryKey: ['community', 'comments', postId], queryFn: () => request<Comment[]>(`/community/posts/${postId}/comments`), enabled,
});

function useCommunityAction<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['community'] }) });
}

export const useCreatePost = () => useCommunityAction((body: { kind: PostKind; body: string }) => request<Post>('/community/posts', { method: 'POST', body }));
export const useDeletePost = () => useCommunityAction((id: number) => request(`/community/posts/${id}`, { method: 'DELETE' }));
export const useComment = () => useCommunityAction(({ id, body }: { id: number; body: string }) =>
  request<Comment>(`/community/posts/${id}/comments`, { method: 'POST', body: { body } }));

/** Reactions update the post in place right away, then settle with the server's counts. */
export const useReact = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, emoji }: { id: number; emoji: Emoji }) => request<Post>(`/community/posts/${id}/reactions`, { method: 'POST', body: { emoji } }),
    onMutate: ({ id, emoji }) => {
      qc.setQueriesData<{ items: FeedItem[] }>({ queryKey: ['community', 'feed'] }, (old) => old && {
        items: old.items.map((i) => {
          if (i.type !== 'post' || i.id !== id) return i;
          const on = i.my_reactions.includes(emoji);
          return { ...i, my_reactions: on ? i.my_reactions.filter((e) => e !== emoji) : [...i.my_reactions, emoji],
            reactions: { ...i.reactions, [emoji]: i.reactions[emoji] + (on ? -1 : 1) } };
        }),
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['community', 'feed'] }),
  });
};
