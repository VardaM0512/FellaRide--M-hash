// Impact: what sharing rides has saved in this community (CO2, km not driven, car trips avoided, money), how it
// built up day by day, and which routes it came from. Prints as a one-page report for a college or a sponsor.
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useImpact, type Impact } from '../api/organiser';
import { CountUp, ErrorNote, Icon, Skeleton } from '../components/ui';
import { displayName } from '../lib/format';
import { rupees } from '../lib/pricing';
import { useSession } from '../lib/session';
import { OrgIcon } from './orgIcons';

const nf = (n: number, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d });
const count = (n: number, one: string) => `${nf(n)} ${one}${n === 1 ? '' : 's'}`;

/** Running total of CO2 saved: one series, so no legend; hover or arrow keys move a crosshair with the day's values. */
function GrowthChart({ series }: { series: Impact['series'] }) {
  const [at, setAt] = useState<number | null>(null);
  const W = 760, H = 260, L = 48, R = 20, T = 18, B = 30;
  const maxY = Math.max(1, ...series.map((s) => s.co2_kg));
  const step = Math.pow(10, Math.floor(Math.log10(maxY)));
  const top = Math.ceil(maxY / step) * step;
  const n = Math.max(1, series.length - 1);
  const x = (i: number) => L + (i / n) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.co2_kg).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, top / 2, top];
  const days = [...new Set([0, Math.round(n / 2), n])];
  const last = series[series.length - 1];
  const p = at !== null ? series[at] : null;

  function move(e: MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - L - R);
    setAt(Math.max(0, Math.min(series.length - 1, Math.round((px / (W - L - R)) * n))));
  }
  function key(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setAt((i) => Math.max(0, Math.min(series.length - 1, (i ?? series.length - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
  }

  return (
    <div className="imp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" tabIndex={0} onKeyDown={key} onBlur={() => setAt(null)}
        aria-label={`CO2 saved, running total: ${nf(last?.co2_kg ?? 0)} kg by day ${last?.day ?? 0}. Use the arrow keys to read each day.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{nf(t)}</text>
          </g>
        ))}
        {days.map((d) => <text key={d} x={x(d)} y={H - 8} textAnchor={d === 0 ? 'start' : d === n ? 'end' : 'middle'} className="tick">Day {series[d]?.day ?? d}</text>)}
        <path d={area} className="area" />
        <path d={line} className="line" />
        {last && at === null && <circle cx={x(series.length - 1)} cy={y(last.co2_kg)} r="4.5" className="dot" />}
        {p && at !== null && (
          <g>
            <line x1={x(at)} x2={x(at)} y1={T} y2={y(0)} className="cross" />
            <circle cx={x(at)} cy={y(p.co2_kg)} r="4.5" className="dot" />
          </g>
        )}
        <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onMouseMove={move} onMouseLeave={() => setAt(null)} />
      </svg>
      {p && at !== null && (
        <div className="chart-tip" style={{ left: `${(x(at) / W) * 100}%` }} aria-live="polite">
          <strong>Day {p.day}</strong>
          <span>{nf(p.co2_kg)} kg CO₂ saved</span>
          <span className="muted">{nf(p.km)} km not driven</span>
        </div>
      )}
    </div>
  );
}

export default function ImpactPage() {
  const q = useImpact();
  const { session } = useSession();
  const [table, setTable] = useState(false);
  const d = q.data;
  if (!d) return q.error ? <ErrorNote error={q.error} onRetry={() => q.refetch()} /> : <Skeleton h={480} />;
  const name = displayName(session?.tenant.name || '');
  const topKm = Math.max(1, ...d.routes.map((r) => r.km));
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="imp-page">
      <p className="print-only print-head"><strong>{name}</strong> · FellaRide impact report · {today}{d.synthetic ? ' · demo data' : ''}</p>

      <section className="imp-band" aria-labelledby="imp-h">
        <div className="imp-band-top">
          <p className="band-live"><span className="live-dot" aria-hidden="true" />Since the community started</p>
          <button className="btn btn-small imp-print no-print" onClick={() => window.print()}>{OrgIcon.download}Download report</button>
        </div>
        <div className="band-hero">
          <strong id="imp-h"><CountUp value={d.co2_kg} /><small>kg CO₂</small></strong>
          <p>kept out of the air by <b>{nf(d.people)} people</b> sharing <b>{nf(d.rides)} rides</b> instead of driving alone.</p>
        </div>
        <ul className="equiv">
          <li><span className="equiv-icon" aria-hidden="true">{Icon.leaf}</span><strong>{nf(d.trees_year, 1)}</strong><span>trees’ work for a year</span></li>
          <li><span className="equiv-icon" aria-hidden="true">{Icon.ride}</span><strong>{nf(d.km_shared)} km</strong><span>not driven alone</span></li>
          <li><span className="equiv-icon" aria-hidden="true">{Icon.car}</span><strong>{nf(d.seats)}</strong><span>car trips avoided</span></li>
          <li><span className="equiv-icon" aria-hidden="true">{OrgIcon.pricing}</span><strong>{rupees(d.money_saved)}</strong><span>not spent on solo trips</span></li>
        </ul>
      </section>

      <div className="imp-grid">
        <section className="panel" aria-labelledby="growth-h">
          <div className="section-head">
            <h2 id="growth-h">CO₂ saved, day by day</h2>
            <button className="btn-link small no-print" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? 'Show chart' : 'Show as table'}</button>
          </div>
          {d.rides === 0 ? <p className="muted">No shared rides yet. This fills in as people ride together.</p> : table ? (
            <div className="table-scroll" style={{ maxHeight: 300 }}>
              <table className="data">
                <thead><tr><th scope="col">Day</th><th scope="col" className="r">CO₂ saved so far (kg)</th><th scope="col" className="r">Km not driven so far</th></tr></thead>
                <tbody>{d.series.map((s) => <tr key={s.day}><td>Day {s.day}</td><td className="r num">{nf(s.co2_kg, 1)}</td><td className="r num">{nf(s.km)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <GrowthChart series={d.series} />}
        </section>

        <section className="panel" aria-labelledby="where-h">
          <h2 id="where-h">Where it comes from</h2>
          {!d.routes.length ? <p className="muted small">Routes appear after the first shared rides.</p> : (
            <ol className="imp-routes">
              {d.routes.map((r) => (
                <li key={`${r.from}-${r.to}`}>
                  <div className="route-name"><strong>{r.from}</strong><span aria-hidden="true">→</span><strong>{r.to}</strong>
                    <span className="num small">{nf(r.co2_kg, 1)} kg</span></div>
                  <div className="route-bar" aria-hidden="true"><i className="joined" style={{ width: `${(r.km / topKm) * 100}%` }} /></div>
                  <span className="small muted">{count(r.rides, 'ride')} · {count(r.seats, 'seat')} · {nf(r.km)} km shared</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="panel how-counted" aria-labelledby="how-h">
        <h2 id="how-h">How we count</h2>
        <ul>
          <li>Every rider in a shared ride is one car trip that didn’t happen, for the distance they rode.</li>
          <li>CO₂: {d.assumptions.co2_kg_per_km} kg per km not driven (an average petrol car). Trees: one mature tree absorbs about {d.assumptions.tree_kg_per_year} kg a year.</li>
          <li>Money: ₹{d.assumptions.car_cost_per_km} per km, the car running cost set on the Pricing page (fuel and wear).</li>
          <li>These are estimates. Rides in the app use the route the driver confirmed; others use the distance from home to the destination.</li>
        </ul>
      </section>
    </div>
  );
}
