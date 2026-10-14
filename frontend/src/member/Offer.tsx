// Offer a ride: from, to, when, seats -> pick and confirm the route on the map -> post.
// Posting tells everyone whose last location is near the route.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePostTrip, type Place } from '../api/trips';
import MapView, { type MapPoint } from '../components/MapView';
import PlaceField from '../components/PlaceField';
import { ErrorNote, Icon } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { nameOf, routesBetween, type RouteOption } from '../lib/places';
import { useSession } from '../lib/session';
import { GENDER_LABEL, ratingText, soon, toLocalInput } from '../lib/tripFormat';

export default function Offer() {
  const { session } = useSession();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const post = usePostTrip();
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [active, setActive] = useState<'from' | 'to'>('from');
  const [when, setWhen] = useState(toLocalInput(soon(30)));
  const [seats, setSeats] = useState(3);
  const [routes, setRoutes] = useState<RouteOption[] | null>(null);
  const [chosen, setChosen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const p = session?.profile;

  async function tapMap(pt: { lat: number; lon: number }) {
    if (routes) return;
    const place = { ...pt, name: await nameOf(pt.lat, pt.lon) };
    if (active === 'from') { setFrom(place); setActive('to'); } else setTo(place);
  }

  async function showRoutes(e: FormEvent) {
    e.preventDefault();
    if (!from || !to) return setError(new Error('Set where you start and where you’re going.'));
    if (new Date(when).getTime() < Date.now() - 5 * 60_000) return setError(new Error('Pick a time from now on.'));
    setError(null); setBusy(true);
    const r = await routesBetween(from, to);
    setRoutes(r); setChosen(0); setBusy(false);
  }

  async function confirm() {
    if (!from || !to || !routes) return;
    const r = routes[chosen];
    try {
      const trip = await post.mutateAsync({
        from_name: from.name, from_lat: from.lat, from_lon: from.lon, to_name: to.name, to_lat: to.lat, to_lon: to.lon,
        depart_at: new Date(when).toISOString(), route: r.coords, route_km: r.km, route_min: r.min, seats,
      });
      announce(`Ride posted. ${trip.notified ?? 0} people nearby were told.`);
      navigate(`/trip/${trip.id}`, { replace: true, state: { notified: trip.notified ?? 0 } });
    } catch (err) { setError(err); }
  }

  const points: MapPoint[] = [
    ...(from ? [{ ...from, kind: 'from' as const, label: `Start: ${from.name}` }] : []),
    ...(to ? [{ ...to, kind: 'to' as const, label: `End: ${to.name}` }] : []),
  ];

  if (routes) {
    return (
      <section className="stack-lg" aria-labelledby="route-h">
        <div className="stack" style={{ gap: 4 }}>
          <h2 id="route-h" style={{ fontSize: 'var(--fs-h3)' }}>Which way will you drive?</h2>
          <p className="muted small">Riders along this route will see your ride. Tap a line on the map or pick below.</p>
        </div>
        <MapView label="Route options" points={points} routes={routes.map((r) => ({ id: r.id, coords: r.coords, selected: r.id === chosen }))}
          onRouteClick={setChosen} height={300} />
        <div className="stack" role="radiogroup" aria-label="Route">
          {routes.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={r.id === chosen} className={`route-opt${r.id === chosen ? ' on' : ''}`} onClick={() => setChosen(r.id)}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="tick" aria-hidden="true">{r.id === chosen && Icon.check}</span>
                <strong>{r.label}</strong>
              </span>
              <span className="num" style={{ fontWeight: 600 }}>{r.km} km · {r.min} min</span>
            </button>
          ))}
        </div>
        {routes[0].approximate && <p className="note note-info">Couldn’t reach the route service, so this is a straight line. Riders near it will still see your ride.</p>}
        <dl className="facts">
          <dt>From</dt><dd>{from?.name}</dd>
          <dt>To</dt><dd>{to?.name}</dd>
          <dt>Leaving</dt><dd>{new Date(when).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</dd>
          <dt>Seats</dt><dd>{seats}</dd>
        </dl>
        <ErrorNote error={error} />
        <div className="btn-row">
          <button className="btn btn-quiet" onClick={() => setRoutes(null)}>Back</button>
          <button className="btn btn-primary" onClick={confirm} disabled={post.isPending}>{post.isPending ? 'Posting…' : <>Confirm route & post {Icon.arrow}</>}</button>
        </div>
      </section>
    );
  }

  return (
    <form className="stack-lg" onSubmit={showRoutes}>
      <div className="note note-info" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span>Posting as <strong>{p?.name}</strong> · {p ? GENDER_LABEL[p.gender] : ''} · {p ? ratingText(p.rating) : ''}</span>
        <Link to="/me" className="btn-link small">Edit</Link>
      </div>
      <div className="journey-box">
      <PlaceField label="From" value={from} onChange={setFrom} active={active === 'from'} onActivate={() => setActive('from')} near={from ?? session?.tenant.center} placeholder="Where you start" />
      <PlaceField label="To" value={to} onChange={setTo} active={active === 'to'} onActivate={() => setActive('to')} near={from ?? session?.tenant.center} allowLocate={false} placeholder="Where you’re going" />
      </div>
      <MapView label={`Map. Tap to set ${active === 'from' ? 'where you start' : 'where you’re going'}.`} points={points} center={session?.tenant.center} onPick={tapMap} />
      <label className="field">Leaving at
        <input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} required />
      </label>
      <div className="field"><span>Empty seats</span>
        <div className="stepper" role="group" aria-label="Empty seats">
          <button type="button" onClick={() => setSeats((s) => Math.max(1, s - 1))} aria-label="One fewer">−</button>
          <output aria-live="polite"><span key={seats}>{seats}</span></output>
          <button type="button" onClick={() => setSeats((s) => Math.min(7, s + 1))} aria-label="One more">+</button>
        </div>
      </div>
      <ErrorNote error={error} />
      <button className="btn btn-primary btn-block" disabled={busy || !from || !to}>{busy ? 'Finding routes…' : <>Next: confirm route {Icon.arrow}</>}</button>
    </form>
  );
}
