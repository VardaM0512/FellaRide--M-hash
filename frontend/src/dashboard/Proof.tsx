// Smart engine vs random nudges on two identical synthetic communities (needs the admin key: local demo only).
import { Link } from 'react-router-dom';
import { useCompare } from '../api/hooks';
import type { CompareResult } from '../api/types';
import { ErrorNote } from '../components/ui';
import { pct } from '../lib/format';

function GrowthChart({ data }: { data: CompareResult }) {
  const W = 760, H = 300, L = 44, R = 90, T = 16, B = 34;
  const s = data.smart.timeseries, r = data.random.timeseries;
  const maxY = Math.max(...s.map((d) => d.active_users), ...r.map((d) => d.active_users), 1);
  const maxX = Math.max(s.length, r.length) - 1 || 1;
  const x = (i: number) => L + (i / maxX) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const line = (rows: typeof s) => rows.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.active_users).toFixed(1)}`).join(' ');
  const ticks = [0, Math.round(maxY / 2), maxY];
  const lastS = s[s.length - 1]?.active_users ?? 0, lastR = r[r.length - 1]?.active_users ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
      aria-label={`Active riders over ${maxX} days: the smart engine reached ${lastS}, random nudges reached ${lastR}.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--fog)">{t}</text>
        </g>
      ))}
      {[0, Math.round(maxX / 2), maxX].map((d) => <text key={d} x={x(d)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--fog)">Day {d}</text>)}
      <path d={line(r)} fill="none" stroke="var(--fog)" strokeWidth="2.5" strokeDasharray="6 5" />
      <path d={line(s)} fill="none" stroke="var(--peacock)" strokeWidth="3" />
      <text x={W - R + 8} y={y(lastS) + 4} fontSize="13" fontWeight="700" fill="var(--peacock)">Our engine</text>
      <text x={W - R + 8} y={y(lastR) + 4} fontSize="13" fill="var(--fog)">Random</text>
    </svg>
  );
}

export default function Proof() {
  const compare = useCompare();
  const d = compare.data;
  const lift = d?.lift.active_users;
  return (
    <div className="dash" style={{ maxWidth: 980 }}>
      <header className="dash-head">
        <h1 style={{ fontSize: 'var(--fs-h2)' }}>Does the engine beat random nudges?</h1>
        <span className="spacer" />
        <Link to="/dashboard" className="btn btn-quiet" style={{ textDecoration: 'none' }}>Back to dashboard</Link>
      </header>
      <section className="panel">
        <p>We grow two identical synthetic communities for 40 days. One gets our engine’s targeted nudges; the other gets the same number of generic nudges sent to random people.</p>
        {(
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => compare.mutate(40)} disabled={compare.isPending}>
              {compare.isPending ? 'Growing both communities… about 10 seconds' : d ? 'Run it again' : 'Run the comparison'}
            </button>
          </div>
        )}
        <ErrorNote error={compare.error} />
      </section>
      {d && (
        <>
          <section className="panel" aria-labelledby="lift-h" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 24 }}>
            <p className="proof-lift" style={{ color: 'var(--peacock)' }}>{lift ? `${lift.toFixed(1)}×` : '—'}</p>
            <div>
              <h2 id="lift-h">the active riders, same community, same number of nudges</h2>
              <p className="muted">{d.smart.kpis.active_users} people rode in the last week with our engine, against {d.random.kpis.active_users} with random nudges.</p>
            </div>
          </section>
          <section className="panel">
            <h2>Active riders, day by day</h2>
            <GrowthChart data={d} />
          </section>
          <section className="panel">
            <h2>Side by side after 40 days</h2>
            <table className="data">
              <thead><tr><th scope="col">Measure</th><th scope="col">Our engine</th><th scope="col">Random nudges</th><th scope="col">Difference</th></tr></thead>
              <tbody>
                {([
                  ['People who rode this week', 'active_users', String],
                  ['Shared rides completed', 'rides_completed', String],
                  ['People who joined', 'registered', String],
                  ['Seat requests that found a match', 'match_rate', pct],
                ] as const).map(([label, k, fmt]) => (
                  <tr key={k}>
                    <th scope="row" style={{ color: 'var(--ink)' }}>{label}</th>
                    <td>{fmt(d.smart.kpis[k] as number)}</td>
                    <td>{fmt(d.random.kpis[k] as number)}</td>
                    <td>{d.lift[k] ? `${d.lift[k]!.toFixed(1)}×` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
