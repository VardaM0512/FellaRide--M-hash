// Offer a ride: from, to, when, seats -> pick and confirm the route on the map -> post.
// Posting tells everyone whose last location is near the route.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePostTrip, useRates, type Place } from '../api/trips';
import MapView, { type MapPoint } from '../components/MapView';
import PlaceField from '../components/PlaceField';
import { ErrorNote, Icon } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { haversineKm, nameOf, routesBetween, type RouteOption } from '../lib/places';
import { useSession } from '../lib/session';
import { GENDER_LABEL, ratingText, soon, toLocalInput } from '../lib/tripFormat';
import { DEFAULT_RATES, defaultPerKm, maxPerKm, perSeat, rate, rupees } from '../lib/pricing';

type Price = 'free' | 'half' | 'suggested';
const MAX_ROUTE_KM = 2000, MAX_ROUTE_MIN = 3000;   // the same limits the server checks
const MIN_TRIP_KM = 0.5;                           // trips.MIN_TRIP_KM: closer than this is the same place
const UPI_RE = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;

export default function Offer() {
  const { session, signIn } = useSession();
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
  const [car, setCar] = useState({ model: p?.car?.model ?? '', colour: p?.car?.colour ?? '', plate: p?.car?.plate ?? '' });
  const [licence, setLicence] = useState(false);   // ticked every time a ride is offered
  const [price, setPrice] = useState<Price>('suggested');
  const [upi, setUpi] = useState(p?.upi_id ?? '');
  const [costShare, setCostShare] = useState(false);   // ticked every time, like the licence
  const rates = useRates().data ?? DEFAULT_RATES;   // the organiser's rates for this community
  const perKm = price === 'free' ? 0 : price === 'half' ? Math.round((defaultPerKm(seats, rates) / 2) * 100) / 100 : defaultPerKm(seats, rates);
  const upiOk = !upi.trim() || UPI_RE.test(upi.trim());
  const carReady = car.model.trim().length >= 2 && car.colour.trim().length >= 2 && car.plate.trim().length >= 4;

  async function tapMap(pt: { lat: number; lon: number }) {
    if (routes) return;
    const place = { ...pt, name: await nameOf(pt.lat, pt.lon) };
    if (active === 'from') { setFrom(place); setActive('to'); } else setTo(place);
  }

  async function showRoutes(e: FormEvent) {
    e.preventDefault();
    if (!from || !to) return setError(new Error('Set where you start and where you’re going.'));
    if (haversineKm(from, to) < MIN_TRIP_KM) return setError(new Error('Your start and destination are the same place. Pick where you’re going.'));
    if (!carReady) return setError(new Error('Add your car’s model, colour and number, so riders can find you.'));
    if (!licence) return setError(new Error('Tick the box to confirm you have a valid driving licence.'));
    if (!costShare) return setError(new Error('Tick the box to confirm you’re sharing costs, not running a taxi.'));
    if (!upiOk) return setError(new Error('That UPI ID doesn’t look right. It looks like name@bank.'));
    if (new Date(when).getTime() < Date.now() - 5 * 60_000) return setError(new Error('Pick a time from now on.'));
    setError(null); setBusy(true);
    const all = await routesBetween(from, to);
    // the server's limits for one ride (schemas.TripIn); say so here instead of failing at the last step
    const r = all.filter((x) => x.km <= MAX_ROUTE_KM && x.min <= MAX_ROUTE_MIN).map((x, i) => ({ ...x, id: i }));
    setBusy(false);
    if (!r.length) {
      return setError(new Error(`That trip is about ${Math.round(all[0]?.km ?? 0).toLocaleString()} km. A ride can be up to `
        + `${MAX_ROUTE_KM.toLocaleString()} km, so check the From and To places.`));
    }
    setRoutes(r); setChosen(0);
  }

  async function confirm() {
    if (!from || !to || !routes) return;
    const r = routes[chosen];
    try {
      const trip = await post.mutateAsync({
        from_name: from.name, from_lat: from.lat, from_lon: from.lon, to_name: to.name, to_lat: to.lat, to_lon: to.lon,
        depart_at: new Date(when).toISOString(), route: r.coords, route_km: r.km, route_min: r.min, seats,
        car: { model: car.model.trim(), colour: car.colour.trim(), plate: car.plate.trim() }, licence_confirmed: licence,
        cost_share_confirmed: costShare, price_per_km: price === 'suggested' ? undefined : perKm, ...(upi.trim() ? { upi_id: upi.trim() } : {}),
      });
      // remember the car for next time (the server tidies the number plate)
      if (session && p) signIn({ ...session, profile: { ...p, car: trip.car, upi_id: upi.trim() || p.upi_id || null } });
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
          <dt>Car</dt><dd>{car.colour} {car.model} · {car.plate.toUpperCase()}</dd>
          <dt>Licence</dt><dd>Confirmed by you</dd>
          <dt>Contribution</dt><dd>{perKm === 0 ? 'Free ride' : `${rupees(perSeat(perKm, routes[chosen].km, routes[chosen].km, seats, rates))} a seat for the whole way · ${rate(perKm)}`}</dd>
          <dt>Trip cost</dt><dd>About {rupees(Math.round(9 * routes[chosen].km))} to drive. Riders together never pay more.</dd>
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
      <fieldset className="card stack" style={{ margin: 0 }}>
        <legend className="sr-only">You and your car</legend>
        <h2 style={{ fontSize: 'var(--fs-h3)' }} aria-hidden="true">You and your car</h2>
        <p className="small muted" style={{ marginTop: -8 }}>Only drivers fill this in. Riders see the model and colour; only riders you approve see the number plate.</p>
        <label className="field">Car model
          <input value={car.model} onChange={(e) => setCar({ ...car, model: e.target.value })} placeholder="Maruti Swift" required minLength={2} maxLength={60} autoComplete="off" />
        </label>
        <label className="field">Colour
          <input value={car.colour} onChange={(e) => setCar({ ...car, colour: e.target.value })} placeholder="White" required minLength={2} maxLength={30} autoComplete="off" />
        </label>
        <label className="field">Car number
          <input value={car.plate} onChange={(e) => setCar({ ...car, plate: e.target.value })} placeholder="KA 01 AB 1234" required minLength={4} maxLength={16}
            autoComplete="off" autoCapitalize="characters" style={{ textTransform: 'uppercase' }} />
          <span className="hint">Saved for your next ride.</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={licence} onChange={(e) => setLicence(e.target.checked)} required />
          <span>I have a valid driving licence for this car.</span>
        </label>
      </fieldset>
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
      <fieldset className="card stack price-box" style={{ margin: 0 }}>
        <legend className="sr-only">Cost sharing</legend>
        <h2 style={{ fontSize: 'var(--fs-h3)' }} aria-hidden="true">Cost sharing</h2>
        <p className="small muted" style={{ marginTop: -8 }}>Riders chip in for the distance they travel. FellaRide is cost-sharing only: you can’t make a profit.</p>
        <div className="segmented price-pick" role="radiogroup" aria-label="What riders pay">
          {(['free', 'half', 'suggested'] as Price[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={price === k} aria-pressed={price === k} onClick={() => setPrice(k)}>
              {k === 'free' ? 'Free' : k === 'half' ? 'Half' : 'Suggested'}
            </button>
          ))}
        </div>
        <p className="price-line">
          {perKm === 0 ? <><strong>Free ride.</strong> Riders pay nothing.</>
            : <><strong>{rate(perKm)}</strong> · a 10 km rider pays about <strong>{rupees(perSeat(perKm, 10, 10, seats, rates))}</strong>, minimum {rupees(rates.min_contribution)}</>}
        </p>
        <p className="tiny muted">Most you could ask with {seats} seat{seats === 1 ? '' : 's'}: {rate(maxPerKm(seats, rates))}, so a full car only covers the fuel and wear.</p>
        {perKm > 0 && (
          <label className="field">UPI ID (optional)
            <input value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="yourname@okaxis" autoComplete="off" autoCapitalize="none" spellCheck={false}
              aria-invalid={!upiOk} />
            <span className="hint">{upiOk ? 'Riders get a Pay by UPI button with the amount filled in. Cash works too.' : 'Looks like name@bank.'}</span>
          </label>
        )}
        <label className="check-row">
          <input type="checkbox" checked={costShare} onChange={(e) => setCostShare(e.target.checked)} required />
          <span>I’m sharing costs, not running a taxi.</span>
        </label>
      </fieldset>
      <ErrorNote error={error} />
      <button className="btn btn-primary btn-block" disabled={busy || !from || !to || !carReady || !licence || !costShare || !upiOk}>{busy ? 'Finding routes…' : <>Next: confirm route {Icon.arrow}</>}</button>
    </form>
  );
}
