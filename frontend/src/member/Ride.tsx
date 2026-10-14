// Today's ride state. One status at a time, never a table.
import { useState } from 'react';
import { useAskSeat, useCommunity, useFinishRide, useMember, useMemberMap, useOfferSeats, useRides } from '../api/hooks';
import type { MemberProfile, RideOffer, RidesForDay } from '../api/types';
import { ErrorNote, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { firstName, hhmm } from '../lib/format';
import { useIdentity } from '../lib/identity';
import { WAITING_TEXT } from './Today';

const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

function OfferSeats({ me }: { me: MemberProfile }) {
  const [seats, setSeats] = useState(me.seats);
  const offer = useOfferSeats();
  const announce = useAnnounce();
  return (
    <div className="status-block">
      <h2 style={{ fontSize: 'var(--fs-h3)' }}>Driving today?</h2>
      <p className="muted">You leave at <span className="num">{me.depart_time}</span> for {me.destination}.</p>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="stepper" role="group" aria-label="Seats to offer">
          <button onClick={() => setSeats((s) => Math.max(1, s - 1))} disabled={seats <= 1} aria-label="One seat fewer">−</button>
          <output aria-live="polite">{seats}</output>
          <button onClick={() => setSeats((s) => Math.min(me.seats, s + 1))} disabled={seats >= me.seats} aria-label="One seat more">+</button>
        </div>
        <button className="btn btn-primary" disabled={offer.isPending}
          onClick={async () => { await offer.mutateAsync({ memberId: me.id, seats }); announce(`Offering ${seats} seats.`); }}>
          Offer {seats} seat{seats === 1 ? '' : 's'}
        </button>
      </div>
      <ErrorNote error={offer.error} />
    </div>
  );
}

function AskSeat({ me }: { me: MemberProfile }) {
  const ask = useAskSeat();
  const announce = useAnnounce();
  return (
    <div className="status-block">
      <h2 style={{ fontSize: 'var(--fs-h3)' }}>Need a ride today?</h2>
      <p className="muted">You leave at <span className="num">{me.depart_time}</span> for {me.destination}.</p>
      <button className="btn btn-ride" style={{ justifySelf: 'start' }} disabled={ask.isPending}
        onClick={async () => { await ask.mutateAsync({ memberId: me.id }); announce(WAITING_TEXT); }}>
        Ask for a seat
      </button>
      <ErrorNote error={ask.error} />
    </div>
  );
}

function DriverStatus({ offer, names }: { offer: RideOffer; names: (id: number) => string }) {
  const finish = useFinishRide();
  const announce = useAnnounce();
  const riders = offer.riders.filter((r) => r.status !== 'cancelled');
  const who = joinNames(riders.map((r) => firstName(names(r.rider_id))));
  const done = async (completed: boolean) => {
    await finish.mutateAsync({ offerId: offer.id, completed });
    announce(completed ? 'Ride completed.' : 'Ride cancelled.');
  };
  let title: string, detail: string;
  switch (offer.status) {
    case 'completed': title = 'Ride completed'; detail = `You drove ${who}. Thanks for sharing your commute.`; break;
    case 'cancelled': title = 'Ride cancelled'; detail = 'Your riders were told. Offer again tomorrow.'; break;
    case 'unfilled': title = 'Nobody needed a seat today'; detail = 'Your offer closed without riders. Try again tomorrow.'; break;
    default:
      title = riders.length ? `Matched with ${who}` : `Offering ${offer.seats_total} seat${offer.seats_total === 1 ? '' : 's'}`;
      detail = riders.length
        ? `Leaving ${hhmm(offer.depart_min)}. ${offer.seats_left} seat${offer.seats_left === 1 ? '' : 's'} still free.`
        : `Waiting for a match. Matches are made once everyone’s in, usually before 07:30.`;
  }
  return (
    <div className="status-block" style={offer.status === 'cancelled' ? { borderLeft: '6px solid var(--chilli)' } : undefined}>
      <h2 style={{ fontSize: 'var(--fs-h3)' }}>{title}</h2>
      <p>{detail}</p>
      {(offer.status === 'open' || offer.status === 'full') && riders.length > 0 && (
        <div className="btn-row">
          <button className="btn btn-ride" onClick={() => done(true)} disabled={finish.isPending}>Mark ride done</button>
          <button className="btn btn-quiet" onClick={() => done(false)} disabled={finish.isPending}>Cancel ride</button>
        </div>
      )}
      <ErrorNote error={finish.error} />
    </div>
  );
}

function riderState(rides: RidesForDay, meId: number) {
  for (const o of rides.offers) {
    const seat = o.riders.find((r) => r.rider_id === meId);
    if (seat) return { offer: o, seat };
  }
  return null;
}

export default function Ride() {
  const { memberId } = useIdentity();
  const community = useCommunity();
  const me = useMember(memberId);
  const rides = useRides(community.data?.current_day);
  const { map } = useMemberMap();
  const names = (id: number) => map.get(id)?.name || 'a community member';

  if (!me.data || !rides.data) {
    const err = me.error || rides.error;
    return err ? <ErrorNote error={err} onRetry={() => { me.refetch(); rides.refetch(); }} /> : <div aria-busy="true"><Skeleton h={140} /></div>;
  }
  const m = me.data;
  const myOffer = rides.data.offers.find((o) => o.driver_id === m.id);
  const seat = riderState(rides.data, m.id);
  const waiting = rides.data.open_requests.some((q) => q.rider_id === m.id);

  let body;
  if (myOffer) body = <DriverStatus offer={myOffer} names={names} />;
  else if (seat) {
    const driver = names(seat.offer.driver_id);
    const text = seat.seat.status === 'completed' ? { t: 'Ride completed', d: `You rode with ${firstName(driver)}. Ride again tomorrow to start a habit.` }
      : seat.seat.status === 'cancelled' ? { t: 'Ride cancelled', d: `${firstName(driver)} cancelled today. Ask again tomorrow.` }
        : { t: `Matched with ${firstName(driver)}, leaving ${hhmm(seat.offer.depart_min)}`, d: `${driver} will pick you up on the way to ${m.destination}.` };
    body = (
      <div className="status-block" style={seat.seat.status === 'cancelled' ? { borderLeft: '6px solid var(--chilli)' } : { borderLeft: '6px solid var(--peacock)' }}>
        <h2 style={{ fontSize: 'var(--fs-h3)' }}>{text.t}</h2>
        <p>{text.d}</p>
      </div>
    );
  } else if (waiting) body = <div className="status-block"><h2 style={{ fontSize: 'var(--fs-h3)' }}>Waiting for a match</h2><p>{WAITING_TEXT}</p></div>;
  else body = m.has_car && m.seats > 0 ? <OfferSeats me={m} /> : <AskSeat me={m} />;

  return (
    <section aria-labelledby="ride-h" style={{ display: 'grid', gap: 14 }}>
      <div className="section-head">
        <h1 id="ride-h" style={{ fontSize: 'var(--fs-h2)' }}>Today’s ride</h1>
        <span className="small muted">Day {rides.data.day} of the community</span>
      </div>
      {body}
    </section>
  );
}
