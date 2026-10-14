import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAskSeat, useCommunity, useInterventions, useMember, useOfferSeats, useRecommendations, useRespond } from '../api/hooks';
import type { Intervention, Member, MemberProfile, MatchBreakdown } from '../api/types';
import { ErrorNote, Glyph, Sheet, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { firstName, km, minutesApart, overlapWords } from '../lib/format';
import { useIdentity } from '../lib/identity';
import ThreadPicture from './ThreadPicture';

export const WAITING_TEXT = 'Asked for a seat. Matches are made once everyone’s in, usually before 07:30.';

function Hero({ me, partners }: { me: MemberProfile; partners: { member: Member; match: MatchBreakdown }[] }) {
  const community = useCommunity();
  const dest = community.data?.destinations.find((d) => d.id === me.destination_id);
  return (
    <section aria-labelledby="leave-label" style={{ display: 'grid', gap: 8 }}>
      <p id="leave-label" className="muted">You leave</p>
      <p className="hero-time">{me.depart_time}</p>
      <p className="route-line">{me.area} <span aria-hidden="true">→</span><span className="sr-only">to</span> {me.destination}</p>
      {dest && (
        <ThreadPicture
          me={me.home}
          dest={dest}
          destName={dest.name}
          iDrive={me.has_car}
          partners={partners.slice(0, 3).map((p, i) => ({ home: p.member.home, drives: p.member.has_car, highlight: i === 0 }))}
          label={partners.length
            ? `Your route from ${me.area} to ${dest.name}, with ${partners.length} people commuting alongside`
            : `Your route from ${me.area} to ${dest.name}`}
        />
      )}
    </section>
  );
}

function SuggestionCard({ iv, me, onAnswered }: { iv: Intervention; me: MemberProfile; onAnswered: (text: string) => void }) {
  const respond = useRespond();
  const announce = useAnnounce();
  const navigate = useNavigate();

  const yesLabel = iv.kind === 'driver' ? `Offer ${me.seats} seat${me.seats === 1 ? '' : 's'}`
    : iv.kind === 'connector' ? 'Invite neighbours'
      : iv.kind === 'rider' ? 'Ask for a seat'
        : me.has_car ? `Offer ${me.seats} seats` : 'Ask for a seat';

  async function answer(responded: boolean) {
    try {
      const r = await respond.mutateAsync({ id: iv.id, responded });
      const text = !responded ? 'Okay, not today.'
        : r.offer_id ? `Offering ${me.seats} seats. We’ll match riders before you leave.`
          : r.request_id ? WAITING_TEXT
            : 'Thanks. Pick who to invite below.';
      onAnswered(text);
      announce(text);
      if (responded && iv.kind === 'connector') navigate('/invite');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { onAnswered(e.message); announce(e.message); return; }
      announce(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

  return (
    <section className={`suggestion kind-${iv.kind}`} aria-label="Today’s suggestion">
      <p>{iv.message}</p>
      <div className="btn-row">
        <button className={iv.kind === 'connector' ? 'btn btn-invite' : 'btn btn-primary'} onClick={() => answer(true)} disabled={respond.isPending}>{yesLabel}</button>
        <button className="btn btn-quiet" onClick={() => answer(false)} disabled={respond.isPending}>Not today</button>
      </div>
      {respond.error && !(respond.error instanceof ApiError && respond.error.status === 409) && <ErrorNote error={respond.error} />}
    </section>
  );
}

function PartnerSheet({ partner, match, me, onClose }: { partner: Member; match: MatchBreakdown; me: MemberProfile; onClose: () => void }) {
  const ask = useAskSeat();
  const offer = useOfferSeats();
  const announce = useAnnounce();
  const [done, setDone] = useState<string | null>(null);
  const theyDrive = partner.has_car && !me.has_car;
  const action = theyDrive ? 'Ask for a seat' : me.has_car ? `Offer ${me.seats} seat${me.seats === 1 ? '' : 's'}` : null;
  async function act() {
    try {
      if (theyDrive) await ask.mutateAsync({ memberId: me.id });
      else await offer.mutateAsync({ memberId: me.id, seats: me.seats });
      const text = theyDrive ? WAITING_TEXT : `Offering ${me.seats} seats today. ${firstName(partner.name)} can be matched with you.`;
      setDone(text);
      announce(text);
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Something went wrong';
      setDone(null);
      announce(text);
    }
  }
  const err = ask.error || offer.error;
  return (
    <Sheet title={partner.name} onClose={onClose}>
      <dl className="facts">
        <dt>Lives in</dt><dd>{partner.area}</dd>
        <dt>Leaves</dt><dd className="num">{partner.depart_time} ({minutesApart(match.time_gap_min)})</dd>
        <dt>Going to</dt><dd>{partner.destination}</dd>
        {partner.has_car && <><dt>Seats</dt><dd>{partner.seats} in their car</dd></>}
        <dt>Route</dt><dd>{overlapWords(match.route_overlap)}</dd>
        <dt>Pickup</dt><dd>+{km(match.detour_km)} for {theyDrive ? 'them' : 'you'}</dd>
      </dl>
      {done ? <div className="note note-ok">{done} <Link to="/ride" style={{ fontWeight: 700 }}>See your ride</Link></div>
        : action && <button className={theyDrive ? 'btn btn-ride' : 'btn btn-primary'} onClick={act} disabled={ask.isPending || offer.isPending}>{action}</button>}
      {err && <ErrorNote error={err} />}
    </Sheet>
  );
}

export default function Today() {
  const { memberId } = useIdentity();
  return <TodayFor key={memberId ?? 'none'} memberId={memberId} />;
}

function TodayFor({ memberId }: { memberId: number | null }) {
  // kept here, not in the card: answering refetches the suggestions and the card goes away
  const [answered, setAnswered] = useState<string | null>(null);
  const community = useCommunity();
  const me = useMember(memberId);
  const recs = useRecommendations(memberId);
  const day = community.data?.current_day;
  const ivs = useInterventions(day, memberId);
  const [open, setOpen] = useState<{ member: Member; match: MatchBreakdown } | null>(null);

  if (me.isLoading || !me.data) {
    return me.error ? <ErrorNote error={me.error} onRetry={() => me.refetch()} /> : (
      <div style={{ display: 'grid', gap: 12 }} aria-busy="true">
        <Skeleton w={90} h={14} /><Skeleton w={200} h={64} /><Skeleton w={220} h={16} />
        <Skeleton h={56} style={{ marginTop: 24 }} /><Skeleton h={56} />
      </div>
    );
  }
  const partners = recs.data?.partners || [];
  const suggestion = (ivs.data || []).find((i) => i.status === 'sent');
  return (
    <>
      <Hero me={me.data} partners={partners} />
      {answered ? (
        <div className="note note-ok" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>{answered}</span>
          <Link to="/ride" style={{ fontWeight: 700 }}>See your ride</Link>
        </div>
      ) : suggestion && <SuggestionCard key={suggestion.id} iv={suggestion} me={me.data} onAnswered={setAnswered} />}
      <section aria-labelledby="thread-h">
        <div className="section-head">
          <h2 id="thread-h" style={{ fontSize: 'var(--fs-h3)' }}>On your thread</h2>
          <span className="small muted">{recs.data?.looking_for === 'riders' ? 'People you could drive' : 'People who drive your way'}</span>
        </div>
        {recs.isLoading ? <><Skeleton h={56} /><Skeleton h={56} style={{ marginTop: 8 }} /></>
          : recs.error ? <ErrorNote error={recs.error} onRetry={() => recs.refetch()} />
            : partners.length === 0 ? (
              <div style={{ display: 'grid', gap: 12, paddingTop: 8 }}>
                <p>Nobody leaves your way at this time yet. Invite a neighbour and you’ll see them here.</p>
                <Link to="/invite" className="btn btn-invite" style={{ justifySelf: 'start', textDecoration: 'none' }}>Invite a neighbour</Link>
              </div>
            ) : (
              <ul className="partners">
                {partners.map(({ member, match }) => (
                  <li key={member.id}>
                    <button className="partner" onClick={() => setOpen({ member, match })} aria-haspopup="dialog">
                      <Glyph driver={member.has_car} connector={false} />
                      <span>
                        <span className="who">{member.name}</span><br />
                        <span className="small muted">{minutesApart(match.time_gap_min)}, {overlapWords(match.route_overlap)}</span>
                      </span>
                      <span className="time">{member.depart_time}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
      </section>
      {open && <PartnerSheet partner={open.member} match={open.match} me={me.data} onClose={() => setOpen(null)} />}
    </>
  );
}
