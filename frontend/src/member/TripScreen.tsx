// One ride, for the driver or a rider. Polls every few seconds so approvals, boarding and messages show up live.
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useTrip, useTripStep, type Person, type Place, type Trip } from '../api/trips';
import MapView, { type MapPoint } from '../components/MapView';
import { Avatar, ErrorNote, Icon, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { useSession } from '../lib/session';
import { GENDER_LABEL, SEAT_STATUS, TRIP_STATUS, minutesUntil, ratingText, whenLabel } from '../lib/tripFormat';
import { Chat, RatePanel, ReportSheet } from './TripParts';

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
              <PersonLine p={r.person} extra={r.pickup_name ? `Pickup: ${r.pickup_name.split(',')[0]}` : undefined} onReport={() => report(r.person)} />
              <div className="btn-row">
                <button className="btn btn-quiet btn-small" disabled={busy} onClick={() => act(`seats/${r.seat_id}/reject`, `Declined ${r.person.name}.`)}>Decline</button>
                <button className="btn btn-ride btn-small" disabled={busy || trip.seats_left === 0} onClick={() => act(`seats/${r.seat_id}/approve`, `Approved ${r.person.name}.`)}>Approve</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {group.length > 0 && (
        <section className="stack" aria-labelledby="riders-h">
          <h3 id="riders-h">Your riders</h3>
          {group.map((r) => (
            <PersonLine key={r.seat_id} p={r.person} extra={SEAT_STATUS[r.status]} call={['approved', 'boarded'].includes(r.status)} onReport={() => report(r.person)} />
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
          {!anyoneIn && <button className="btn btn-danger btn-block" disabled={busy}
            onClick={() => window.confirm(approved.length ? 'Cancel this ride? You approved riders, so this lowers your rating.' : 'Cancel this ride?') && act('cancel', 'Ride cancelled.')}>Cancel ride</button>}
        </section>
      )}
    </>
  );
}

function RiderPanel({ trip, me, act, busy, report, pickup }: {
  trip: Trip; me: number; act: (path: string, ok?: string, body?: unknown) => void; busy: boolean; report: (p: Person) => void; pickup: Place | null;
}) {
  const seat = trip.my_seat;
  const live = LIVE.includes(trip.status);
  const others = trip.riders.filter((r) => r.person.id !== me);
  const lastOne = !others.some((r) => r.status === 'approved' || r.status === 'boarded');
  const onboard = seat && ['approved', 'boarded'].includes(seat.status);

  return (
    <>
      <section className="stack" aria-labelledby="drv-h">
        <h3 id="drv-h">Driver</h3>
        <PersonLine p={trip.driver} role="Driver" call={!!onboard} onReport={seat ? () => report(trip.driver) : undefined} />
      </section>

      {others.length > 0 && (
        <section className="stack" aria-labelledby="co-h">
          <h3 id="co-h">Riding with you</h3>
          {others.map((r) => <PersonLine key={r.seat_id} p={r.person} extra={SEAT_STATUS[r.status]} onReport={() => report(r.person)} />)}
        </section>
      )}

      {live && (
        <section className="stack" aria-label="Your seat">
          {!seat || seat.status === 'withdrawn' ? (
            trip.seats_left > 0
              ? <button className="btn btn-ride btn-block" disabled={busy}
                  onClick={() => act('request', 'Seat requested.', pickup ? { pickup_name: pickup.name, pickup_lat: pickup.lat, pickup_lon: pickup.lon } : {})}>
                  Ask {trip.driver.name.split(' ')[0]} for a seat</button>
              : <p className="note note-info">This ride is full.</p>
          ) : seat.status === 'pending' ? (
            <>
              <p className="note note-info">Waiting for {trip.driver.name.split(' ')[0]} to approve. You’ll get an alert.</p>
              <button className="btn btn-quiet btn-block" disabled={busy} onClick={() => act('withdraw', 'Request withdrawn.')}>Withdraw request</button>
            </>
          ) : seat.status === 'approved' ? (
            <>
              <p className="note note-ok">You’re approved. Meet {trip.driver.name.split(' ')[0]} at your pickup and check the code. The driver marks you as in the car.</p>
              <button className="btn btn-quiet btn-block" disabled={busy} onClick={() => window.confirm('Give up your seat?') && act('withdraw', 'You left this ride.')}>I can’t make it</button>
            </>
          ) : seat.status === 'boarded' ? (
            <button className="btn btn-primary btn-block" disabled={busy}
              onClick={() => window.confirm(lastOne ? 'You’re the last rider, so this ends the ride for everyone. End it?' : 'End your ride? The ride goes on for the others.') && act('end', 'Your ride has ended.')}>
              {lastOne ? 'End ride (you’re the last rider)' : 'End my ride (I got off)'}
            </button>
          ) : (
            <p className="note note-info">{SEAT_STATUS[seat.status]}.</p>
          )}
        </section>
      )}
      {!live && seat?.status === 'missed' && <p className="note note-error">The driver ended this ride before picking you up.</p>}
    </>
  );
}

export default function TripScreen() {
  const id = Number(useParams().id);
  const { state } = useLocation() as { state: { notified?: number; pickup?: Place } | null };
  const { session } = useSession();
  const me = session?.user.id ?? 0;
  const navigate = useNavigate();
  const announce = useAnnounce();
  const q = useTrip(id);
  const step = useTripStep();
  const [reporting, setReporting] = useState<Person | null>(null);
  const [done, setDone] = useState('');

  if (q.error) {
    return (q.error as ApiError).status === 404
      ? <><p className="note note-error">This ride doesn’t exist or you can’t see it.</p><button className="btn" onClick={() => navigate('/')}>Home</button></>
      : <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  }
  if (!q.data) return <><Skeleton h={380} /><Skeleton h={120} /></>;
  const trip = q.data;
  const isDriver = trip.you === 'driver';

  const act = (path: string, ok?: string, body?: unknown) => {
    setDone('');
    step.mutate({ tripId: trip.id, path, body }, {
      onSuccess: () => { if (ok) { setDone(ok); announce(ok); } },
    });
  };

  const points: MapPoint[] = [
    { ...trip.from, kind: 'from', label: `Start: ${trip.from.name}` },
    { ...trip.to, kind: 'to', label: `End: ${trip.to.name}` },
    ...(state?.pickup && !isDriver ? [{ ...state.pickup, kind: 'pickup' as const, label: 'Your pickup' }] : []),
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
        <MapView label="Ride route" points={points} routes={[{ id: 0, coords: trip.route, selected: true }]} height={220} />
        {trip.code && LIVE.includes(trip.status) && <CodeBox code={trip.code} />}
      </section>

      <ErrorNote error={step.error} />
      {done && <p className="note note-ok" role="status">{done}</p>}

      {isDriver
        ? <DriverPanel trip={trip} act={act} busy={step.isPending} report={setReporting} />
        : <RiderPanel trip={trip} me={me} act={act} busy={step.isPending} report={setReporting} pickup={state?.pickup ?? null} />}

      {trip.to_rate && trip.to_rate.some((p) => !p.rated) && <RatePanel trip={trip} />}
      {inGroup && <Chat trip={trip} isDriver={isDriver} me={me} />}
      {reporting && <ReportSheet trip={trip} person={reporting} onClose={() => setReporting(null)} />}
    </>
  );
}
