// Home: "How are you travelling today?" is asked every time (you can drive one day and ride the next).
// If you're already in a ride, that comes first.
import { Link } from 'react-router-dom';
import { useImpact } from '../api/community';
import { useMyTrips, type Trip } from '../api/trips';
import DepartureBoard from '../components/DepartureBoard';
import { Avatar, ErrorNote, Icon, Skeleton } from '../components/ui';
import { firstName } from '../lib/format';
import { savedPickup } from '../lib/pickup';
import { useSession } from '../lib/session';
import { ChallengeCard } from './Community';
import { GENDER_LABEL, SEAT_STATUS, TRIP_STATUS, ratingText, whenLabel } from '../lib/tripFormat';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** This week, Monday to Sunday: a lime mark on each day you shared a ride. */
function RideWeek({ trips, streak }: { trips: Trip[]; streak: number }) {
  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - today);
  const rode = new Set(trips.filter((t) => t.status === 'completed' || t.status === 'started').map((t) => {
    const d = new Date(t.depart_at);
    return Math.floor((d.getTime() - monday.getTime()) / 86_400_000);
  }).filter((i) => i >= 0 && i < 7));
  return (
    <div className="week-wrap">
      <ol className="week" aria-label={`Your ride week: ${rode.size} ${rode.size === 1 ? 'day' : 'days'} with a shared ride`}>
        {DAYS.map((d, i) => (
          <li key={d} className={`${rode.has(i) ? 'on' : ''}${i === today ? ' today' : ''}`}><i aria-hidden="true" />{d}</li>
        ))}
      </ol>
      <p className="small">{rode.size ? `${rode.size} ${rode.size === 1 ? 'day' : 'days'} shared this week. Keep the run going.`
        : streak > 0 ? `Keep your ${streak}-week streak alive: share a ride this week.` : 'No shared rides yet this week. Today is a good day to start.'}</p>
    </div>
  );
}

export function TripRow({ trip, note }: { trip: Trip; note?: string }) {
  return (
    <Link to={`/trip/${trip.id}`} className="trip-row">
      <Avatar name={trip.driver.name} driver />
      <span>
        <span className="who">{trip.from.name.split(',')[0]} → {trip.to.name.split(',')[0]}</span><br />
        <span className="small muted">{whenLabel(trip.depart_at)} · {trip.you === 'driver' ? 'You drive' : `${trip.driver.name} · ${GENDER_LABEL[trip.driver.gender]} · ${ratingText(trip.driver.rating)}`}</span>
        {note && <><br /><span className="small" style={{ fontWeight: 700 }}>{note}</span></>}
      </span>
      <span className="chev" aria-hidden="true">›</span>
    </Link>
  );
}

/** A seat you asked for: the torn-off stub of the ticket, kept here until the driver answers. */
function Stub({ trip }: { trip: Trip }) {
  const d = new Date(trip.depart_at);
  return (
    <Link to={`/trip/${trip.id}`} className="stub">
      <span className="stub-time">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      <span className="stub-route">{trip.from.name.split(',')[0]} → {trip.to.name.split(',')[0]}</span>
      <span className="small">{trip.driver.name.split(' ')[0]} · {whenLabel(trip.depart_at).split(' ')[0]}</span>
      <span className="stub-state"><span className="live-dot" /> Waiting for {trip.driver.name.split(' ')[0]}</span>
    </Link>
  );
}

export default function Home() {
  const { session } = useSession();
  const mine = useMyTrips();
  const impact = useImpact();
  const name = session?.profile?.name ? firstName(session.profile.name) : '';

  if (mine.error) return <ErrorNote error={mine.error} onRetry={() => mine.refetch()} />;
  if (!mine.data) return <><Skeleton h={64} /><Skeleton h={60} /><div className="tiles"><Skeleton h={168} /><Skeleton h={168} /></div></>;
  const { active, pending, history } = mine.data;
  const toRate = history.filter((t) => t.to_rate > 0);
  const waitingOnMe = active?.you === 'driver' ? active.riders.filter((r) => r.status === 'pending').length : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      {active ? (
        <section className="status-card s-matched" aria-labelledby="active-h">
          <p className="status-eyebrow"><span className="live-dot" /> {active.you === 'driver' ? 'You’re driving' : 'You’re riding'} · {TRIP_STATUS[active.status]}</p>
          <h2 id="active-h" style={{ fontSize: 24 }}>{active.from.name.split(',')[0]} → {active.to.name.split(',')[0]}</h2>
          <p className="muted">{whenLabel(active.depart_at)}
            {active.you === 'driver' ? ` · ${active.seats_total - active.seats_left} of ${active.seats_total} seats taken` : ` · ${SEAT_STATUS[active.my_seat!.status]}`}</p>
          {waitingOnMe > 0 && <p className="note note-info">{waitingOnMe} {waitingOnMe === 1 ? 'person wants' : 'people want'} a seat. Approve or decline.</p>}
          <Link to={`/trip/${active.id}`} className="btn btn-primary btn-block">Open your ride {Icon.arrow}</Link>
        </section>
      ) : (
        <section className="stack-lg" aria-labelledby="role-h">
          <div className="today-pass">
            <div className="pass-top">
              <p className="eyebrow">{greeting}{name ? `, ${name}` : ''}</p>
              {(impact.data?.streak_weeks ?? 0) > 0 && <span className="streak">{Icon.flame} {impact.data!.streak_weeks}-week streak</span>}
            </div>
            <h2 id="role-h">Where are you headed?</h2>
            <Link to="/find" className="where-to">
              {Icon.search}<span className="grow">Where to?</span>
              <span className="when">{Icon.clock} Now</span>
            </Link>
            <RideWeek trips={[...history, ...(active ? [active] : [])]} streak={impact.data?.streak_weeks ?? 0} />
          </div>
          <DepartureBoard from={savedPickup(session?.user.id)} />
          <div className="tiles">
            <Link to="/offer" className="tile drive">
              <span className="go" aria-hidden="true">→</span>
              <span className="tile-art">{Icon.car}</span>
              <span><strong>I’m driving</strong><span className="small">Offer your empty seats on your route.</span></span>
            </Link>
            <Link to="/find" className="tile ride">
              <span className="go" aria-hidden="true">→</span>
              <span className="tile-art">{Icon.seat}</span>
              <span><strong>I need a ride</strong><span className="small">See who’s going your way.</span></span>
            </Link>
          </div>
          <p className="small muted">Pick one each time. You can drive today and ride tomorrow.</p>
        </section>
      )}

      <ChallengeCard compact />

      <Link to="/invite" className="role-card invite">
        <span className="role-icon">{Icon.invite}</span>
        <span><strong>Invite someone</strong><br /><span className="small">Know someone who commutes your way? You’re credited when they join.</span></span>
      </Link>

      {pending.length > 0 && (
        <section aria-labelledby="pending-h">
          <h3 id="pending-h" className="section-head">Your stubs</h3>
          <div className="stubs">{pending.map((t) => <Stub key={t.id} trip={t} />)}</div>
        </section>
      )}

      {toRate.length > 0 && (
        <section aria-labelledby="rate-h">
          <h3 id="rate-h" className="section-head">Rate your last rides</h3>
          <div className="list">{toRate.map((t) => <TripRow key={t.id} trip={t} note={`${t.to_rate} ${t.to_rate === 1 ? 'person' : 'people'} to rate`} />)}</div>
        </section>
      )}
    </>
  );
}
