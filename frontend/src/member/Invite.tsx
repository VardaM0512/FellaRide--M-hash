import { useState } from 'react';
import { useAcceptInvite, useCommunity, useInviteSuggestions, useMemberMap, useSendInvite } from '../api/hooks';
import type { InviteSuggestion } from '../api/types';
import { ErrorNote, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { firstName, people } from '../lib/format';
import { useIdentity } from '../lib/identity';

interface Sent { referralId: number; name: string; joined: boolean }

export default function Invite() {
  const { memberId } = useIdentity();
  const community = useCommunity();
  const suggestions = useInviteSuggestions(memberId);
  const { map } = useMemberMap();
  const send = useSendInvite();
  const accept = useAcceptInvite();
  const announce = useAnnounce();
  const [sent, setSent] = useState<Record<number, Sent[]>>({});
  const mine = memberId ? sent[memberId] || [] : [];

  // "Lives in Old Town, near 4 people who already carpool."
  const reason = (s: InviteSuggestion) => {
    const carpoolers = [...map.values()].filter((m) => m.area === s.area && m.rides_count > 0).length;
    const parts = [`Lives in ${s.area}${carpoolers ? `, near ${people(carpoolers)} who already carpool` : ''}.`];
    if (s.hot_corridor) parts.push('Their commute route is one of the busiest, so they’d be matched quickly.');
    return parts.join(' ');
  };

  async function invite(s: InviteSuggestion) {
    if (!memberId) return;
    const r = await send.mutateAsync({ inviterId: memberId, inviteeId: s.member_id });
    setSent((prev) => ({ ...prev, [memberId]: [...(prev[memberId] || []), { referralId: r.id, name: s.name, joined: false }] }));
    announce(`Invited ${firstName(s.name)}.`);
  }

  async function simulateJoin(item: Sent) {
    if (!memberId) return;
    await accept.mutateAsync({ referralId: item.referralId });
    setSent((prev) => ({ ...prev, [memberId]: (prev[memberId] || []).map((x) => (x.referralId === item.referralId ? { ...x, joined: true } : x)) }));
    announce(`${firstName(item.name)} joined the community.`);
  }

  return (
    <section aria-labelledby="invite-h" style={{ display: 'grid', gap: 14 }}>
      <div>
        <h1 id="invite-h" style={{ fontSize: 'var(--fs-h2)' }}>Invite people who commute like you</h1>
        <p className="muted" style={{ marginTop: 6 }}>Picked from people you know who haven’t joined yet, most likely to ride first.</p>
      </div>

      {suggestions.isLoading ? <><Skeleton h={64} /><Skeleton h={64} /></>
        : suggestions.error ? <ErrorNote error={suggestions.error} onRetry={() => suggestions.refetch()} />
          : (suggestions.data || []).length === 0 && mine.length === 0 ? <p>Everyone you know is already here.</p>
            : (
              <div>
                {(suggestions.data || []).map((s) => (
                  <div className="invite-row" key={s.member_id}>
                    <div>
                      <p style={{ fontWeight: 700 }}>{s.name}</p>
                      <p className="small muted">{reason(s)}</p>
                    </div>
                    <button className="btn btn-invite" onClick={() => invite(s)} disabled={send.isPending}>Invite {firstName(s.name)}</button>
                  </div>
                ))}
              </div>
            )}
      <ErrorNote error={send.error} />

      {mine.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <h2 style={{ fontSize: 'var(--fs-h3)' }}>Your invites</h2>
          {mine.map((item) => (
            <div className="invite-row" key={item.referralId}>
              <p>{item.joined ? `${firstName(item.name)} joined. Thanks for bringing them in.` : `Invited, waiting for ${firstName(item.name)} to join.`}</p>
              {!item.joined && community.data?.synthetic && (
                <button className="btn btn-quiet" onClick={() => simulateJoin(item)} disabled={accept.isPending}>Simulate {firstName(item.name)} joining</button>
              )}
            </div>
          ))}
          <ErrorNote error={accept.error} />
        </div>
      )}
    </section>
  );
}
