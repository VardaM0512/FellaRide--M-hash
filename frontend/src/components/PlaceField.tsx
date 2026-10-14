// "From" / "To" input: type to search a place, use your current location, or tap the map (handled by the page).
import { useEffect, useState } from 'react';
import type { Place } from '../api/trips';
import { currentPosition, nameOf, searchPlaces } from '../lib/places';
import { Icon } from './ui';

export default function PlaceField({ label, value, onChange, active, onActivate, near, allowLocate = true, placeholder }: {
  label: string; value: Place | null; onChange: (p: Place | null) => void; active: boolean; onActivate: () => void;
  near?: { lat: number; lon: number }; allowLocate?: boolean; placeholder?: string;
}) {
  const [text, setText] = useState(value?.name ?? '');
  const [hits, setHits] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // a place chosen elsewhere (map tap, my location) fills the box; typing only clears the chosen place
  useEffect(() => { if (value) setText(value.name); }, [value]);

  // search 600 ms after typing stops (Nominatim asks for at most one request per second)
  useEffect(() => {
    const q = text.trim();
    if (q.length < 3 || q === value?.name) { setHits([]); return; }
    const t = window.setTimeout(async () => {
      try { setErr(''); setHits(await searchPlaces(q, near)); } catch (e) { setErr((e as Error).message); }
    }, 600);
    return () => window.clearTimeout(t);
  }, [text, value?.name, near]);

  async function locate() {
    setBusy(true); setErr('');
    try {
      const p = await currentPosition();
      onChange({ ...p, name: await nameOf(p.lat, p.lon) });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className={`place-field${active ? ' active' : ''}`}>
      <label className="field">{label}
        <div className="place-input">
          <input value={text} placeholder={placeholder || 'Search a place, or tap the map'} onFocus={onActivate}
            onChange={(e) => { setText(e.target.value); if (value) onChange(null); }} autoComplete="off" />
          {allowLocate && (
            <button type="button" className="icon-btn" onClick={locate} aria-label="Use my current location" disabled={busy}>{Icon.pin}</button>
          )}
        </div>
      </label>
      {busy && <p className="small muted">Finding you…</p>}
      {err && <p className="small field-error" role="alert">{err}</p>}
      {hits.length > 0 && (
        <ul className="suggest" role="listbox" aria-label={`${label} suggestions`}>
          {hits.map((h, i) => (
            <li key={i}><button type="button" onClick={() => { onChange(h); setHits([]); }}>{h.name}</button></li>
          ))}
        </ul>
      )}
      {active && !value && <p className="small muted">Or tap the map to set {label.toLowerCase()}.</p>}
    </div>
  );
}
