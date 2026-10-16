// Who is in the car, once the ride has matched: the driver, everyone riding with them, and the seats still free.
//
// It reads as the ride itself rather than a list of names. The app's shell already draws navigation as a transit
// line, so the group is drawn the same way: one stop per person, in the order they matter on this journey, each
// saying WHERE they get on. The seats still free are stops too, drawn hollow, so an empty car looks empty.
// Everything shown is something the ride actually knows — no match percentages, no invented "fit" scores.
import { Link } from 'react-router-dom';
import type { Person, SeatStatus, Trip } from '../api/trips';
import { Icon } from '../components/ui';
import { GENDER_LABEL, SEAT_STATUS, carText, ratingText } from '../lib/tripFormat';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/** Seats whose rider is part of the group (so they belong on the line), pending requests are not. */
const IN_GROUP: SeatStatus[] = ['approved', 'boarded', 'dropped', 'missed', 'no_show'];

/** Ordered by what the people in the car care about now: who is in, who is still to come, then who has finished. */
const RANK: Record<string, number> = { boarded: 0, approved: 1, dropped: 2, missed: 3, no_show: 3 };

type Rider = Trip['riders'][number];

const place = (s: string | null | undefined) => (s ? s.split(',')[0].trim() : '');

/** One line of plain English for where this person is on the journey. */
function riderWhere(r: Rider): string {
  const on = place(r.pickup_name);
  const off = place(r.drop_name);
  if (r.status === 'boarded') return on ? `In the car · got on at ${on}` : 'In the car';
  if (r.status === 'approved') return on ? `Gets on at ${on}` : 'Not in the car yet';
  if (r.status === 'dropped') return off ? `Got off at ${off}` : 'Got off';
  if (r.status === 'no_show') return on ? `Wasn’t at ${on}` : 'Wasn’t at the pickup';
  if (r.status === 'missed') return on ? `Never picked up at ${on}` : 'Never picked up';
  return SEAT_STATUS[r.status];
}

function Stop({ kind, mark, name, lines, seats, you, actions }: {
  kind: 'driver' | 'in' | 'waiting' | 'gone' | 'free';
  mark: React.ReactNode; name: string; lines: string[]; seats?: number; you?: boolean; actions?: React.ReactNode;
}) {
  return (
    <li className={`rg-stop rg-${kind}`}>
      <span className="rg-dot" aria-hidden="true">{mark}</span>
      <span className="rg-who">
        <span className="rg-name">{name}{you && <span className="rg-you">You</span>}
          {seats && seats > 1 ? <span className="rg-seats-taken"> ×{seats} seats</span> : null}</span>
        {lines.filter(Boolean).map((l) => <span key={l} className="small muted">{l}</span>)}
      </span>
      {actions && <span className="rg-act">{actions}</span>}
    </li>
  );
}

export default function RideGroup({ trip, me, onReport }: { trip: Trip; me: number; onReport?: (p: Person) => void }) {
  const riders = trip.riders.filter((r) => IN_GROUP.includes(r.status));
  if (riders.length === 0 && trip.seats_left === trip.seats_total) return null;   // nobody has matched yet

  const inSeats = trip.seats_total - trip.seats_left;
  const free = Math.max(0, trip.seats_left);
  const ordered = [...riders].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.seat_id - b.seat_id);
  const youDrive = trip.you === 'driver';
  // you don't call or report yourself: your own stop is marked "You" and carries no actions
  const call = (p: Person) => (p.mobile
    ? <a className="btn btn-quiet btn-small" href={`tel:${p.mobile}`} aria-label={`Call ${p.name}`}>{Icon.phone}<span className="rg-call-text">Call</span></a>
    : null);
  const report = (p: Person) => (onReport ? <button type="button" className="btn-link small" onClick={() => onReport(p)}>Report</button> : null);
  const actionsFor = (p: Person, reachable: boolean) => (p.id === me ? undefined : <>{reachable ? call(p) : null}{report(p)}</>);

  return (
    <section className="ride-group" aria-labelledby="rg-h">
      <header className="rg-top">
        <h3 id="rg-h">Who’s in the car</h3>
        <p className="rg-count">
          {/* one pip per seat the driver offered, filled for the seats taken: a count, not an estimate */}
          <span className="rg-pips" role="img" aria-label={`${inSeats} of ${trip.seats_total} seats taken`}>
            {Array.from({ length: trip.seats_total }, (_, i) => <i key={i} className={i < inSeats ? 'on' : ''} />)}
          </span>
          <span className="small">{free === 0 ? 'Full' : `${free} free`}</span>
        </p>
      </header>

      <ol className="rg-line">
        <Stop kind="driver" mark={Icon.car} name={trip.driver.name} you={youDrive}
          lines={[`Driving · ${GENDER_LABEL[trip.driver.gender]} · ${ratingText(trip.driver.rating)}`,
            trip.car ? carText(trip.car) : 'No car details added']}
          actions={actionsFor(trip.driver, true)} />

        {ordered.map((r) => (
          <Stop key={r.seat_id}
            kind={r.status === 'boarded' ? 'in' : r.status === 'approved' ? 'waiting' : 'gone'}
            mark={<span className="rg-initials">{initials(r.person.name)}</span>}
            name={r.person.name} seats={r.seats} you={r.person.id === me}
            lines={[riderWhere(r), `${GENDER_LABEL[r.person.gender]} · ${ratingText(r.person.rating)}`]}
            actions={actionsFor(r.person, ['approved', 'boarded'].includes(r.status))} />
        ))}

        {/* the seats still free are stops too, so an empty car looks empty instead of just reading "2 of 4" */}
        {Array.from({ length: free }, (_, i) => (
          <Stop key={`free-${i}`} kind="free" mark={Icon.seat} name="Seat free"
            lines={[i === 0 && trip.status === 'open' ? 'Someone going your way can still ask for it' : '']}
            actions={i === 0 && trip.status === 'open'
              ? <Link className="btn btn-quiet btn-small" to="/invite">Invite someone</Link> : undefined} />
        ))}
      </ol>
    </section>
  );
}
