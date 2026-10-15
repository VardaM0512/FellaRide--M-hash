// The welcome page's lower half, kept deliberately quiet so impact is the one thing that stands out: a dark band with
// one big live number (counting up as it scrolls into view) and three small ones, then two cards (alone vs shared CO2,
// and a rotating environment fact), then a footer. The live numbers include the synthetic demo community;
// CO2 is an estimate (the assumptions are in the band's tooltip).
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '../api/client';
import { CountUp, Logo } from '../components/ui';

export interface Impact {
  people: number; connections: number; rides: number; seats: number; km_shared: number; co2_kg: number;
  trees_year: number; communities: number; includes_demo: boolean; co2_kg_per_km: number;
}

/** The public, live impact numbers (shared by the hero chips and the impact band). */
export function usePublicImpact() {
  return useQuery({ queryKey: ['public-impact'], queryFn: () => request<Impact>('/community/impact', { auth: false }), staleTime: 60_000 });
}

/** True once the element has scrolled into view (so the numbers count up when people actually see them). */
function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!('IntersectionObserver' in window)) { setSeen(true); return; }
    // in view, or already scrolled past (a jump to the footer still starts the count)
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting || e.boundingClientRect.top < 0) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

// an example 12 km trip shared by 3 people (same assumptions as the rest of the app)
const TRIP_KM = 12, RIDERS = 3, CO2_PER_KM = 0.12, TREE_KG_PER_YEAR = 21;
const CO2_ALONE = TRIP_KM * CO2_PER_KM, CO2_SHARED = CO2_ALONE / RIDERS;

// short, well-known environment facts for the fact card (one at a time, rotating)
const FACTS = [
  { big: '2.3 kg', text: 'of CO₂ from burning a single litre of petrol.', src: 'Fuel combustion estimates' },
  { big: '4.6 t', text: 'of CO₂ a typical car puts out in a year.', src: 'US EPA' },
  { big: '21 kg', text: 'of CO₂ a mature tree absorbs in a year.', src: 'Common forestry estimate' },
];

/** One environment fact at a time; rotates every few seconds, and the dots pick one. */
function FactCard() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((n) => (n + 1) % FACTS.length), 5000);
    return () => clearInterval(t);
  }, [paused]);
  const f = FACTS[i];
  return (
    <section className="pic-card" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="vart vart-fact" aria-live="polite">
        <div key={i} className="fact-body">
          <strong>{f.big}</strong>
          <span>{f.text}</span>
          <small>{f.src}</small>
        </div>
        <div className="fact-dots" role="group" aria-label="Choose a fact">
          {FACTS.map((x, n) => (
            <button key={x.big} type="button" aria-label={`Fact ${n + 1}`} aria-pressed={n === i} onClick={() => setI(n)} />
          ))}
        </div>
      </div>
      <h3>Did you know?</h3>
    </section>
  );
}

function Figure({ value, unit, label, seen }: { value: number; unit?: string; label: string; seen: boolean }) {
  return (
    <div className="band-fig">
      <strong className="num"><CountUp value={seen ? value : 0} />{unit && <small>{unit}</small>}</strong>
      <span>{label}</span>
    </div>
  );
}

export default function WelcomeImpact() {
  const q = usePublicImpact();
  const [ref, seen] = useSeen<HTMLDivElement>();
  const d = q.data;
  const on = seen && !!d;
  const how = `Estimate: ${CO2_PER_KM} kg of CO₂ per car km not driven, ${TREE_KG_PER_YEAR} kg a tree absorbs in a year.`
    + (d?.includes_demo ? ' Includes our demo community.' : '');
  return (
    <div className={`welcome-impact${seen ? ' in' : ''}`} ref={ref}>
      <section className="impact-band" aria-label="FellaRide's impact so far" hidden={!d && !q.isLoading}>
        <p className="band-live"><span className="live-dot" aria-hidden="true" /> Live impact</p>
        <div className="band-hero">
          <strong className="num"><CountUp value={on ? d!.co2_kg : 0} /><small>kg</small></strong>
          <p title={how}>of CO₂ kept out of the air{d ? <>, like <b>{d.trees_year} trees</b> growing for a year</> : ''}</p>
        </div>
        <div className="band-figs">
          <Figure seen={on} value={d?.people ?? 0} label="people" />
          <Figure seen={on} value={d?.rides ?? 0} label="shared rides" />
          <Figure seen={on} value={d?.km_shared ?? 0} unit="km" label="together" />
        </div>
      </section>

      <div className="pic-cards">
        <section className="pic-card">
          <div className="vart vart-bars">
            <div><span>Alone</span><i style={{ ['--w' as string]: '100%' }} /><b>{CO2_ALONE.toFixed(2)} kg</b></div>
            <div className="win"><span>Shared</span><i style={{ ['--w' as string]: `${100 / RIDERS}%` }} /><b>{CO2_SHARED.toFixed(2)} kg</b></div>
            <small>CO₂ per person, {TRIP_KM} km trip with {RIDERS} riders</small>
          </div>
          <h3>Cleaner air</h3>
        </section>
        <FactCard />
      </div>

      <footer className="welcome-footer">
        <span className="welcome-footer-brand"><Logo size={18} /> FellaRide</span>
        <span className="tiny muted">© 2026 · Built at the Ignition Hackathon, Manipal</span>
      </footer>
    </div>
  );
}
