// One ride, for the driver or a rider. Polls every few seconds so approvals, boarding and messages show up live.
import { useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useTrip, useTripStep, type LivePosition, type Person, type Place, type Trip } from '../api/trips';
import MapView, { type MapPoint } from '../components/MapView';
import { Avatar, ErrorNote, Icon, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { useSession } from '../lib/session';
import { GENDER_LABEL, SEAT_STATUS, TRIP_STATUS, minutesUntil, ratingText, whenLabel } from '../lib/tripFormat';
import { Chat, RatePanel, ReportSheet } from './TripParts';
import SeatStepper from '../components/SeatStepper';
import { useLiveShare, type ShareState } from '../lib/liveShare';
import { rate, rupees } from '../lib/pricing';

const LIVE = ['open', 'started'];

function PersonLine({ p, role, extra, onReport, call }: { p: Person; role?: string; extra?: string; onReport?: () => void; call?: boolean }) {
  return (
    <div className="person-line">
      <Avatar name={p.name} driver={role === 'Driver'} />
      <div style={{ minWidth: 0 }}>
        <p style={{ fontWeight: 700 }}>{p.name}{role && <span className="small muted" style={{ fontWeight: 400 }}> · {role}</span>}</p>
        <p className="small muted">{GENDER_LABEL[p.gender]} · {ratingText(p.rating)}{extra ? ` · ${extra}` : ''}</p>
      </div>
      <div className="person-actions">
        {call && p.mobile && <a className="btn btn-quiet btn-small" href={`tel:${p.mobile}`} aria-label={`Call ${p.name}`}>{Icon.phone} Call</a>}
        {onReport && <button className="btn-link small" onClick={onReport}>Report</button>}
      </div>
    </div>
  );
}

/** The driver's car. Riders see the model and colour first, and the number plate once they're approved. */
function CarLine({ trip }: { trip: Trip }) {
  if (!trip.car) return <p className="small muted">The driver hasn’t added their car details.</p>;
  return (
    <div className="car-line">
      <p style={{ fontWeight: 600 }}>{trip.car.colour} {trip.car.model}</p>
      {trip.car.plate
        ? <p className="small">Number plate <strong className="num" style={{ letterSpacing: '0.05em' }}>{trip.car.plate}</strong></p>
        : <p className="small muted">You’ll see the number plate once the driver approves you.</p>}
    </div>
  );
}

function CodeBox({ code }: { code: string }) {
  return (
    <div className="code-box" aria-label={`Boarding code ${code.split('').join(' ')}`}>
      <span className="small">Boarding code</span>
      <span className="code" aria-hidden="true">{code.split('').map((c, i) => <span key={i}>{c}</span>)}</span>
      <span className="small">Everyone in this ride sees the same code. Check it matches before getting in.</span>
    </div>
  );
}

function DriverPanel({ trip, act, busy, report }: { trip: Trip; act: (path: string, ok?: string) => void; busy: boolean; report: (p: Person) => void }) {
  const [boardId, setBoardId] = useState<number | ''>('');
  const pending = trip.riders.filter((r) => r.status === 'pending');
  const approved = trip.riders.filter((r) => r.status === 'approved');
  const group = trip.riders.filter((r) => ['approved', 'boarded', 'dropped', 'missed'].includes(r.status));
  const live = LIVE.includes(trip.status);
  const anyoneIn = trip.riders.some((r) => r.status === 'boarded' || r.status === 'dropped');

  function start() {
    const early = minutesUntil(trip.depart_at);
    if (early > 5 && approved.length > 0 &&
      !window.confirm(`You posted ${early} min from now. If you leave now and an approved rider is left behind, your rating drops. Set off anyway?`)) return;
    act('start', 'Ride started. Your riders were told.');
  }
  function end() {
    const msg = approved.length
      ? `${approved.length} approved rider${approved.length > 1 ? 's haven’t' : ' hasn’t'} got in yet and will be marked as left behind. End the ride for everyone?`
      : 'End the ride for everyone?';
    if (window.confirm(msg)) act('end', 'Ride ended.');
  }

  return (
    <>
      {live && (
        <section className="stack" aria-labelledby="req-h">
          <h3 id="req-h">Seat requests {pending.length > 0 && <span className="chip">{pending.length}</span>}</h3>
          {pending.length === 0 && <p className="small muted">No requests waiting. People near your route have been told about your ride.</p>}
          {pending.map((r) => (
            <div key={r.seat_id} className="request">
              <PersonLine p={r.person} extra={[r.seats > 1 ? `Needs ${r.seats} seats` : '', r.pickup_name ? `Pickup: ${r.pickup_name.split(',')[0]}` : ''].filter(Boolean).join(' · ') || undefined} onReport={() => report(r.person)} />
              <div className="btn-row">
                <button className="btn btn-quiet btn-small" disabled={busy} onClick={() => act(`seats/${r.seat_id}/reject`, `Declined ${r.person.name}.`)}>Decline</button>
                <button className="btn btn-ride btn-small" disabled={busy || r.seats > trip.seats_left} onClick={() => act(`seats/${r.seat_id}/approve`, `Approved ${r.person.name}.`)}>
                  {r.seats > trip.seats_left ? `Only ${trip.seats_left} left` : r.seats > 1 ? `Approve ${r.seats}` : 'Approve'}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {group.length > 0 && (
        <section className="stack" aria-labelledby="riders-h">
          <h3 id="riders-h">Your riders</h3>
          {group.map((r) => (
            <div key={r.seat_id} className="rider-pay">
              <PersonLine p={r.person} extra={SEAT_STATUS[r.status] + (r.seats > 1 ? ` · ${r.seats} seats` : '')} call={['approved', 'boarded'].includes(r.status)} onReport={() => report(r.person)} />
              {r.contribution > 0 && ['approved', 'boarded', 'dropped'].includes(r.status) && (
                <div className="rider-pay-row">
                  <span className="small"><strong>{rupees(r.contribution)}</strong> · {r.payment.driver_got ? 'received' : r.payment.rider_paid ? 'they say they paid' : 'not paid yet'}</span>
                  {r.payment.driver_got
                    ? <span className="chip pay-state ok">{Icon.check} Received</span>
                    : <button className="btn btn-quiet btn-small" disabled={busy} onClick={() => act(`seats/${r.seat_id}/received`, `Marked ${r.person.name}’s ${rupees(r.contribution)} as received.`)}>Received {rupees(r.contribution)}</button>}
                </div>
              )}
            </div>
          ))}
          {live && approved.length > 0 && (
            <div className="board-row">
              <label className="field" style={{ flex: 1 }}>Who got in?
                <select value={boardId} onChange={(e) => setBoardId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Choose a rider</option>
                  {approved.map((r) => <option key={r.seat_id} value={r.seat_id}>{r.person.name}</option>)}
                </select>
              </label>
              <button className="btn btn-ride" disabled={busy || boardId === ''}
                onClick={() => { const r = approved.find((x) => x.seat_id === boardId); act(`seats/${boardId}/board`, `${r?.person.name} is in the car.`); setBoardId(''); }}>
                Got in
              </button>
            </div>
          )}
        </section>
      )}

      {live && (
        <section className="stack" aria-label="Ride actions">
          {trip.status === 'open' && <button className="btn btn-primary btn-block" disabled={busy} onClick={start}>Start ride (I’m setting off)</button>}
          <button className="btn btn-block" disabled={busy} onClick={end}>End ride for everyone</button>
          {!anyoneIn && <button className="btn btn-danger btn-block" disabled={busy || !trip.can_cancel}
            onClick={() => window.confirm(approved.length ? 'Cancel this ride? You approved riders, so this lowers your rating.' : 'Cancel this ride?') && act('cancel', 'Ride cancelled.')}>Cancel ride</button>}
          {!anyoneIn && approved.length > 0 && <CancelNote trip={trip} />}
        </section>
      )}
    </>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Under the map while the ride is tracked: where the car is (riders) or that you're sharing (driver). */
function LiveBar({ trip, isDriver, share }: { trip: Trip; isDriver: boolean; share: ShareState }) {
  const car = trip.live.find((x) => x.role === 'driver');
  const waiting = trip.live.filter((x) => x.role === 'rider');
  const first = trip.driver.name.split(' ')[0];
  const ago = (x: LivePosition) => (x.age_s < 15 ? 'just now' : `${x.age_s} s ago`);
  let main: string;
  if (isDriver) {
    main = share === 'on' ? `Sharing your live location with your riders${waiting.length ? ` · ${waiting.length} waiting at their pickup` : ''}`
      : share === 'starting' ? 'Starting live location…' : 'Turn on location so your riders can see you coming';
  } else if (car) {
    main = car.km_to_you !== undefined
      ? (car.km_to_you < 0.15 ? `${first} is at your pickup` : `${first} is ${car.km_to_you} km away · about ${car.eta_min} min`)
      : `${car.km_to_end} km to ${trip.to.name.split(',')[0]} · about ${car.eta_min} min`;
  } else {
    main = `Waiting for ${first}’s live location`;
  }
  return (
    <div className={`live-bar${car || share === 'on' ? ' on' : ''}`} role="status" aria-live="polite">
      <span className="live-dot" aria-hidden="true" />
      <span className="live-bar-text"><strong>{main}</strong>
        <span className="small">{car && !isDriver ? `Updated ${ago(car)}` : share === 'denied' ? 'Location is blocked. Allow it in your browser to share.' : share === 'unavailable' ? 'This device can’t share its location.' : 'Live while the ride is on'}</span>
      </span>
    </div>
  );
}

/** Settling up with the driver, outside the app: a UPI link with the amount filled in, or cash. */
function PayBox({ trip, act, busy }: { trip: Trip; act: (path: string, ok?: string) => void; busy: boolean }) {
  const seat = trip.my_seat;
  if (!seat || seat.contribution <= 0) return null;
  const first = trip.driver.name.split(' ')[0];
  const { rider_paid, driver_got } = seat.payment;
  return (
    <div className="pay-box">
      <div className="pay-head">
        <span><span className="small muted">Your contribution</span><strong className="num">{rupees(seat.contribution)}</strong></span>
        <span className={`chip pay-state${driver_got ? ' ok' : rider_paid ? ' wait' : ''}`}>
          {driver_got ? <>{Icon.check} {first} got it</> : rider_paid ? 'Paid · waiting for ' + first : 'Not paid yet'}</span>
      </div>
      {!rider_paid && (
        <div className="btn-row">
          {trip.pay_to && <a className="btn btn-ride btn-small" href={trip.pay_to.link}>Pay {rupees(trip.pay_to.amount)} by UPI</a>}
          <button className="btn btn-quiet btn-small" disabled={busy} onClick={() => act('paid', `Marked as paid. ${first} will confirm.`)}>
            {trip.pay_to ? 'I’ve paid' : 'I paid in cash or UPI'}</button>
        </div>
      )}
      <p className="tiny muted">{trip.pay_to ? `UPI: ${trip.pay_to.upi_id}. ` : `${first} hasn’t added a UPI ID, so pay in cash or ask in the chat. `}
        FellaRide never handles the money; sort out any questions with {first}.</p>
    </div>
  );
}

/** Backing out after a seat is confirmed: allowed until 10 minutes before departure, then locked. */
function CancelNote({ trip }: { trip: Trip }) {
  return trip.can_cancel
    ? <p className="small muted cancel-note">{Icon.clock} You can cancel until {clock(trip.cancel_until)}.</p>
    : <p className="small muted cancel-note">{Icon.clock} Cancelling closed at {clock(trip.cancel_until)}, 10 minutes before departure. Use the chat if something has come up.</p>;
}

function RiderPanel({ trip, me, act, busy, report, pickup, wanted = 1 }: {
  trip: Trip; me: number; act: (path: string, ok?: string, body?: unknown) => void; busy: boolean; report: (p: Person) => void; pickup: Place | null;
  wanted?: number;
}) {
  const seat = trip.my_seat;
  const live = LIVE.includes(trip.status);
  const others = trip.riders.filter((r) => r.person.id !== me);
  const lastOne = !others.some((r) => r.status === 'approved' || r.status === 'boarded');
  const onboard = seat && ['approved', 'boarded'].includes(seat.status);
  const [need, setNeed] = useState(wanted);   // seats to ask for: the rider plus friends
  const n = Math.max(1, Math.min(need, trip.seats_left));

  return (
    <>
      <section className="stack" aria-labelledby="drv-h">
        <h3 id="drv-h">Driver</h3>
        <PersonLine p={trip.driver} role="Driver" call={!!onboard} onReport={seat ? () => report(trip.driver) : undefined} />
        <CarLine trip={trip} />
        <p className="price-tag">{trip.price.free ? <><strong>Free ride</strong> · the driver isn’t asking for anything</>
          : <><strong>{rupees(seat && seat.status !== 'withdrawn' ? seat.contribution : trip.price.full_route_per_seat)}</strong>
            {seat && seat.status !== 'withdrawn' ? ` for your ${seat.seats > 1 ? `${seat.seats} seats` : 'seat'}` : ' a seat for the whole way'} · cost-sharing at {rate(trip.price.per_km)}</>}</p>
      </section>

      {others.length > 0 && (
        <section className="stack" aria-labelledby="co-h">
          <h3 id="co-h">Riding with you</h3>
          {others.map((r) => <PersonLine key={r.seat_id} p={r.person} extra={SEAT_STATUS[r.status] + (r.seats > 1 ? ` · ${r.seats} seats` : '')} onReport={() => report(r.person)} />)}
        </section>
      )}

      {live && (
        <section className="stack" aria-label="Your seat">
          {!seat || seat.status === 'withdrawn' ? (
            trip.seats_left > 0
              ? <>
                  {trip.seats_left > 1 && <SeatStepper value={Math.min(need, trip.seats_left)} onChange={setNeed} max={trip.seats_left} />}
                  <button className="btn btn-ride btn-block" disabled={busy}
                    onClick={() => act('request', n === 1 ? 'Seat requested.' : `${n} seats requested.`,
                      { ...(pickup ? { pickup_name: pickup.name, pickup_lat: pickup.lat, pickup_lon: pickup.lon } : {}), seats: n })}>
                    Ask {trip.driver.name.split(' ')[0]} for {n === 1 ? 'a seat' : `${n} seats`}</button>
                </>
              : <p className="note note-info">This ride is full.</p>
          ) : seat.status === 'pending' ? (
            <>
              <p className="note note-info">Waiting for {trip.driver.name.split(' ')[0]} to approve{seat.seats > 1 ? ` your ${seat.seats} seats` : ''}. You’ll get an alert.</p>
              <button className="btn btn-quiet btn-block" disabled={busy} onClick={() => act('withdraw', 'Request withdrawn.')}>Withdraw request</button>
            </>
          ) : seat.status === 'approved' ? (
            <>
              <p className="note note-ok">You’re approved{seat.seats > 1 ? ` for ${seat.seats} seats` : ''}. Meet {trip.driver.name.split(' ')[0]} at your pickup and check the code. The driver marks you as in the car.</p>
              <PayBox trip={trip} act={act} busy={busy} />
              <button className="btn btn-danger btn-block" disabled={busy || !trip.can_cancel}
                onClick={() => window.confirm(`Cancel your ${seat.seats > 1 ? `${seat.seats} seats` : 'seat'}? ${trip.driver.name.split(' ')[0]} is told straight away.`) && act('withdraw', 'Your seat is cancelled.')}>
                Cancel my {seat.seats > 1 ? `${seat.seats} seats` : 'seat'}</button>
              <CancelNote trip={trip} />
            </>
          ) : seat.status === 'boarded' ? (
            <>
            <PayBox trip={trip} act={act} busy={busy} />
            <button className="btn btn-primary btn-block" disabled={busy}
              onClick={() => window.confirm(lastOne ? 'You’re the last rider, so this ends the ride for everyone. End it?' : 'End your ride? The ride goes on for the others.') && act('end', 'Your ride has ended.')}>
              {lastOne ? 'End ride (you’re the last rider)' : 'End my ride (I got off)'}
            </button>
            </>
          ) : (
            <p className="note note-info">{SEAT_STATUS[seat.status]}.</p>
          )}
        </section>
      )}
      {!live && seat?.status === 'missed' && <p className="note note-error">The driver ended this ride before picking you up.</p>}
      {!live && seat?.status === 'dropped' && !seat.payment.driver_got && <PayBox trip={trip} act={act} busy={busy} />}
    </>
  );
}

export default function TripScreen() {
  const id = Number(useParams().id);
  const { state } = useLocation() as { state: { notified?: number; pickup?: Place; seats?: number } | null };
  const { session } = useSession();
  const me = session?.user.id ?? 0;
  const navigate = useNavigate();
  const announce = useAnnounce();
  const q = useTrip(id);
  const step = useTripStep();
  const [reporting, setReporting] = useState<Person | null>(null);
  const [done, setDone] = useState('');
  const sending = useRef(false);   // a second tap before the screen redraws must not send the action twice
  // live location: the driver and confirmed riders share theirs while the ride is tracked (from 30 min before)
  const t0 = q.data;
  const share = useLiveShare(id, !!t0 && t0.tracking && (t0.you === 'driver' || ['approved', 'boarded'].includes(t0.my_seat?.status ?? '')));

  if (q.error) {
    return (q.error as ApiError).status === 404
      ? <><p className="note note-error">This ride doesn’t exist or you can’t see it.</p><button className="btn" onClick={() => navigate('/')}>Home</button></>
      : <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data) return <><Skeleton h={380} /><Skeleton h={120} /></>;
  const trip = q.data;
  const isDriver = trip.you === 'driver';
  const confirmed = isDriver || (!!trip.my_seat && ['approved', 'boarded'].includes(trip.my_seat.status));

  const act = (path: string, ok?: string, body?: unknown) => {
    if (sending.current) return;
    sending.current = true;
    setDone('');
    step.mutate({ tripId: trip.id, path, body }, {
      onSuccess: () => { if (ok) { setDone(ok); announce(ok); } },
      onSettled: () => { sending.current = false; },
    });
  };

  const points: MapPoint[] = [
    { ...trip.from, kind: 'from', label: `Start: ${trip.from.name}` },
    { ...trip.to, kind: 'to', label: `End: ${trip.to.name}` },
    ...(state?.pickup && !isDriver ? [{ ...state.pickup, kind: 'pickup' as const, label: 'Your pickup' }] : []),
    ...trip.live.map((x) => ({ lat: x.lat, lon: x.lon, heading: x.heading, kind: x.role === 'driver' ? 'car' as const : 'rider' as const,
      label: x.role === 'driver' ? `${x.name}’s car (live)` : `${x.name} (waiting)` })),
  ];
  const inGroup = !!trip.code;

  return (
    <>
      {state?.notified !== undefined && isDriver && trip.status === 'open' && (
        <p className="note note-ok">Ride posted. {state.notified === 0 ? 'Nobody nearby has shared their location yet, but riders who search your route will find it.' : `${state.notified} ${state.notified === 1 ? 'person' : 'people'} near your route got an alert.`}</p>
      )}
      <section className={`status-card ${LIVE.includes(trip.status) ? 's-matched' : trip.status === 'completed' ? 's-done' : 's-bad'}`}>
        <p className="status-eyebrow">{LIVE.includes(trip.status) && <span className="live-dot" />}{TRIP_STATUS[trip.status]} · {trip.seats_left} of {trip.seats_total} seats free</p>
        <h2 style={{ fontSize: 'var(--fs-h3)' }}>{trip.from.name.split(',')[0]} → {trip.to.name.split(',')[0]}</h2>
        <p><span className="num" style={{ fontSize: 24, fontWeight: 700 }}>{whenLabel(trip.depart_at)}</span>
          <span className="muted small"> · {trip.route_km} km · about {trip.route_min} min</span></p>
        <MapView label="Ride route" points={points} routes={[{ id: 0, coords: trip.route, selected: true }]} height={trip.tracking && confirmed ? 280 : 220} />
        {trip.tracking && confirmed && <LiveBar trip={trip} isDriver={isDriver} share={share} />}
        {trip.code && LIVE.includes(trip.status) && <CodeBox code={trip.code} />}
      </section>

      <ErrorNote error={step.error} />
      {done && <p className="note note-ok" role="status">{done}</p>}

      {isDriver
        ? <DriverPanel trip={trip} act={act} busy={step.isPending} report={setReporting} />
        : <RiderPanel trip={trip} me={me} act={act} busy={step.isPending} report={setReporting} pickup={state?.pickup ?? null} wanted={state?.seats ?? 1} />}

      {trip.to_rate && trip.to_rate.some((p) => !p.rated) && <RatePanel trip={trip} />}
      {inGroup && <Chat trip={trip} isDriver={isDriver} me={me} />}
      {reporting && <ReportSheet trip={trip} person={reporting} onClose={() => setReporting(null)} />}
    </>
  );
}
