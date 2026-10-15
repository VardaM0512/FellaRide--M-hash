// Find a ride: your pickup (and drop, optional) -> every ride whose route passes close to both,
// with the driver's name, gender, rating and car. Compare them, sort them, and ask one or several drivers
// for a seat right from the list: the first to approve gets you, and the other requests are withdrawn.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchTrips, useTripStep, type Place, type Trip } from '../api/trips';
import MapView, { type MapPoint } from '../components/MapView';
import PlaceField from '../components/PlaceField';
import { Avatar, ErrorNote, Icon, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { savePickup, savedPickup } from '../lib/pickup';
import { nameOf } from '../lib/places';
import { usePrefs } from '../lib/prefs';
import { useSession } from '../lib/session';
import { GENDER_LABEL, SEAT_STATUS, carText, ratingText, whenLabel } from '../lib/tripFormat';
import SeatStepper from '../components/SeatStepper';
import { rupees } from '../lib/pricing';

type GenderFilter = 'all' | 'female' | 'male';
type SortBy = 'match' | 'soonest' | 'rating';
const SORTS: [SortBy, string][] = [['match', 'Closest'], ['soonest', 'Soonest'], ['rating', 'Top rated']];

function sorted(trips: Trip[], by: SortBy) {
  const near = (t: Trip) => (t.pickup_km ?? 0) + (t.drop_km ?? 0);
  return [...trips].sort((a, b) =>
    by === 'soonest' ? a.depart_at.localeCompare(b.depart_at)
      : by === 'rating' ? (b.driver.rating.average ?? 0) - (a.driver.rating.average ?? 0) || near(a) - near(b)
        : near(a) - near(b));
}

export default function Find() {
  const { session } = useSession();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const step = useTripStep();
  const { motionReduced } = usePrefs();
  const uid = session?.user.id;
  const [from, setFrom] = useState<Place | null>(() => savedPickup(uid));
  const [punched, setPunched] = useState<number | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [active, setActive] = useState<'from' | 'to'>('from');
  const [when, setWhen] = useState('');
  const [need, setNeed] = useState(1);   // seats: the rider plus friends travelling with them
  const [results, setResults] = useState<Trip[] | null>(null);
  const [gender, setGender] = useState<GenderFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('match');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function tapMap(pt: { lat: number; lon: number }) {
    const place = { ...pt, name: await nameOf(pt.lat, pt.lon) };
    if (active === 'from') { setFrom(place); setActive('to'); } else setTo(place);
  }

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (!from) return setError(new Error('Set your pickup point first.'));
    setBusy(true); setError(null);
    try {
      const r = await searchTrips({ from, to, when: when ? new Date(when).toISOString() : null });
      setResults(r);
      savePickup(uid, from);
      announce(`${r.length} ride${r.length === 1 ? '' : 's'} going your way.`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  /** Ask for a seat: the ticket is punched while the request goes out. You stay on the list, so you can ask
   *  other drivers too; whoever approves first gets you. */
  async function ask(trip: Trip) {
    setPunched(trip.id);
    navigator.vibrate?.(12);
    try {
      const [updated] = await Promise.all([
        step.mutateAsync({ tripId: trip.id, path: 'request', body: { pickup_name: from?.name ?? '', pickup_lat: from?.lat, pickup_lon: from?.lon, seats: need } }),
        new Promise((r) => setTimeout(r, motionReduced ? 0 : 1100)),
      ]);
      setResults((rs) => rs && rs.map((t) => (t.id === trip.id ? { ...t, ...updated, pickup_km: t.pickup_km, drop_km: t.drop_km } : t)));
      announce(`${need === 1 ? 'Seat' : `${need} seats`} requested from ${trip.driver.name}. You can ask other drivers too.`);
    } catch (err) { setError(err); } finally { setPunched(null); }
  }

  const points: MapPoint[] = [
    ...(from ? [{ ...from, kind: 'pickup' as const, label: `Pickup: ${from.name}` }] : []),
    ...(to ? [{ ...to, kind: 'to' as const, label: `Drop: ${to.name}` }] : []),
  ];
  const shown = sorted((results || []).filter((t) => gender === 'all' || t.driver.gender === gender), sortBy);
  const asked = (results || []).filter((t) => t.my_seat?.status === 'pending');

  return (
    <>
      <form className="stack-lg" onSubmit={search}>
        <div className="journey-box">
        <PlaceField label="Pickup" value={from} onChange={(p) => { setFrom(p); setResults(null); }} active={active === 'from'} onActivate={() => setActive('from')}
          near={from ?? session?.tenant.center} placeholder="Where you’ll be picked up" />
        <PlaceField label="Drop (optional)" value={to} onChange={(p) => { setTo(p); setResults(null); }} active={active === 'to'} onActivate={() => setActive('to')}
          near={from ?? session?.tenant.center} allowLocate={false} placeholder="Where you’re going" />
        </div>
        <MapView label={`Map. Tap to set your ${active === 'from' ? 'pickup' : 'drop'}.`} points={points} center={session?.tenant.center} onPick={tapMap} height={220} />
        <label className="field">Around (optional)
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <span className="hint">Leave empty to see every upcoming ride. With a time, you see rides within 90 minutes of it.</span>
        </label>
        <SeatStepper value={need} onChange={setNeed} max={4} />
        <ErrorNote error={error} />
        <button className="btn btn-ride btn-block" disabled={busy || !from}>{busy ? 'Looking…' : <>{Icon.search} Find rides</>}</button>
      </form>

      {busy && <div className="stack"><Skeleton h={150} /><Skeleton h={150} /></div>}
      {results && !busy && (
        <section aria-labelledby="results-h" className="stack stagger">
          <div className="section-head">
            <h3 id="results-h">{shown.length} driver{shown.length === 1 ? '' : 's'} going your way</h3>
            <div className="segmented" role="group" aria-label="Driver">
              {(['all', 'female', 'male'] as GenderFilter[]).map((g) => (
                <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)}>{g === 'all' ? 'All' : g === 'female' ? 'Female' : 'Male'}</button>
              ))}
            </div>
          </div>
          {shown.length > 1 && (
            <div className="section-head">
              <span className="small muted">Sort by</span>
              <div className="segmented" role="group" aria-label="Sort rides">
                {SORTS.map(([k, label]) => <button key={k} type="button" aria-pressed={sortBy === k} onClick={() => setSortBy(k)}>{label}</button>)}
              </div>
            </div>
          )}
          {asked.length > 0 && (
            <p className="note note-ok" role="status">
              You’ve asked {asked.length} driver{asked.length === 1 ? '' : 's'}. {asked.length > 1 ? 'The first to approve gets you, and your other requests are withdrawn automatically.' : 'You can ask more drivers to improve your chances. The first to approve gets you.'} You’ll get an alert.
            </p>
          )}
          {shown.length === 0 && <p className="note note-info">No rides pass near you yet. Try without a drop point or a time, or check back soon. You’ll get an alert when someone posts a ride near you.</p>}
          {shown.map((t) => (
            <article key={t.id} className={`card ride-card ticket${punched === t.id ? ' punched' : ''}`}>
              {punched === t.id && <span className="punch" aria-hidden="true"><span className="stamp">Seat requested</span></span>}
              <div className="person">
                <Avatar name={t.driver.name} driver />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700 }}>{t.driver.name}</p>
                  <p className="small muted">{GENDER_LABEL[t.driver.gender]} · {ratingText(t.driver.rating)}</p>
                </div>
                <span className="ride-time">{whenLabel(t.depart_at).replace(/^Today /, '')}</span>
              </div>
              <p className="ride-route">
                <span className="dot" />{t.from.name.split(',')[0]}<span className="route-line" /><span className="sq" />{t.to.name.split(',')[0]}
              </p>
              {t.car && <p className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{Icon.car} {carText(t.car)}</p>}
              <p className="small muted">
                Passes {t.pickup_km! < 0.2 ? 'right by' : `${t.pickup_km} km from`} your pickup
                {t.drop_km != null ? ` and ${t.drop_km < 0.2 ? 'right by' : `${t.drop_km} km from`} your drop` : ''}
              </p>
              <p className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="seat-meter" aria-hidden="true">
                  {Array.from({ length: t.seats_total }, (_, i) => <i key={i} className={i < t.seats_left ? '' : 'taken'} />)}
                </span>
                <strong>{t.seats_left} seat{t.seats_left === 1 ? '' : 's'} left</strong>
              </p>
              {t.per_seat !== undefined && (
                <p className="price-tag">
                  {t.per_seat === 0 ? <><strong>Free ride</strong> · the driver isn’t asking for anything</>
                    : <><strong>{rupees(t.per_seat * need)}</strong>{need > 1 ? ` for ${need} seats` : ' per seat'} · cost-sharing for your {t.rider_km} km</>}
                </p>
              )}
              <div className="btn-row">
                <button className="btn btn-quiet btn-small" onClick={() => navigate(`/trip/${t.id}`, { state: { pickup: from, seats: need } })}>Details</button>
                {t.my_seat && t.my_seat.status !== 'withdrawn'
                  ? <button className="btn btn-small" onClick={() => navigate(`/trip/${t.id}`, { state: { pickup: from, seats: need } })}>{SEAT_STATUS[t.my_seat.status]}</button>
                  : t.seats_left < need
                    ? <button className="btn btn-small" disabled>Only {t.seats_left} left</button>
                    : <button className="btn btn-ride btn-small" disabled={step.isPending} onClick={() => ask(t)}>{need === 1 ? 'Ask for a seat' : `Ask for ${need} seats`}</button>}
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
