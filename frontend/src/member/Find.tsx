// Find a ride: your pickup (and drop, optional) -> every ride whose route passes close to both,
// with the driver's name, gender and rating. Ask for a seat right from the list.
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
import { GENDER_LABEL, SEAT_STATUS, ratingText, whenLabel } from '../lib/tripFormat';

type GenderFilter = 'all' | 'female' | 'male';

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
  const [results, setResults] = useState<Trip[] | null>(null);
  const [gender, setGender] = useState<GenderFilter>('all');
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

  /** Ask for a seat: the ticket is punched and its stub tears off while the request goes out. */
  async function ask(trip: Trip) {
    setPunched(trip.id);
    navigator.vibrate?.(12);
    try {
      await Promise.all([
        step.mutateAsync({ tripId: trip.id, path: 'request', body: { pickup_name: from?.name ?? '', pickup_lat: from?.lat, pickup_lon: from?.lon } }),
        new Promise((r) => setTimeout(r, motionReduced ? 0 : 1100)),
      ]);
      announce(`Seat requested from ${trip.driver.name}.`);
      navigate(`/trip/${trip.id}`, { state: { pickup: from } });
    } catch (err) { setPunched(null); setError(err); }
  }

  const points: MapPoint[] = [
    ...(from ? [{ ...from, kind: 'pickup' as const, label: `Pickup: ${from.name}` }] : []),
    ...(to ? [{ ...to, kind: 'to' as const, label: `Drop: ${to.name}` }] : []),
  ];
  const shown = (results || []).filter((t) => gender === 'all' || t.driver.gender === gender);

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
        <ErrorNote error={error} />
        <button className="btn btn-ride btn-block" disabled={busy || !from}>{busy ? 'Looking…' : <>{Icon.search} Find rides</>}</button>
      </form>

      {busy && <div className="stack"><Skeleton h={150} /><Skeleton h={150} /></div>}
      {results && !busy && (
        <section aria-labelledby="results-h" className="stack stagger">
          <div className="section-head">
            <h3 id="results-h">{shown.length} ride{shown.length === 1 ? '' : 's'} going your way</h3>
            <div className="segmented" role="group" aria-label="Driver">
              {(['all', 'female', 'male'] as GenderFilter[]).map((g) => (
                <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)}>{g === 'all' ? 'All' : g === 'female' ? 'Women' : 'Men'}</button>
              ))}
            </div>
          </div>
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
              <div className="btn-row">
                <button className="btn btn-quiet btn-small" onClick={() => navigate(`/trip/${t.id}`, { state: { pickup: from } })}>Details</button>
                {t.my_seat
                  ? <button className="btn btn-small" onClick={() => navigate(`/trip/${t.id}`, { state: { pickup: from } })}>{SEAT_STATUS[t.my_seat.status]}</button>
                  : <button className="btn btn-ride btn-small" disabled={step.isPending} onClick={() => ask(t)}>Ask for a seat</button>}
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
