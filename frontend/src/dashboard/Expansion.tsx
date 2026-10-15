// Network Expansion Engine, organiser view. Follows the engine's loop top to bottom:
// the network now -> why it isn't growing -> where it can grow (with forecasts) -> which communities to link
// -> what the engine did and whether it worked -> what it has learned.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import {
  useAutopilot, useDemoNeighbour, useExpansion, useProposeCorridor, useRunExpansion,
  type Area, type CommunityLink, type ExpansionAction, type ExpansionReport,
} from '../api/expansion';
import { ErrorNote, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { useSession } from '../lib/session';

const LOOP = ['Analyse', 'Detect', 'Predict', 'Act', 'Measure', 'Learn'];
const TREND = { rising: '↑ rising', falling: '↓ falling', steady: '→ steady' };

function AreaMap({ areas, selected, onSelect }: { areas: Area[]; selected: string | null; onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: false });
    m.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g || !areas.length) return;
    g.clearLayers();
    const top = Math.max(...areas.map((a) => a.score), 1);
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--peacock').trim() || '#1767C2';
    areas.forEach((a, i) => {
      const on = a.id === selected;
      const c = L.circle([a.lat, a.lon], {
        radius: 500 + (a.score / top) * 1300, color: ink, weight: on ? 3 : 1.5, fillColor: ink, fillOpacity: on ? 0.32 : 0.14,
      }).addTo(g);
      c.bindTooltip(`${i + 1}. ${a.label}`, { permanent: true, direction: 'center', className: 'area-label' });
      c.on('click', () => onSelect(a.id));
    });
    m.fitBounds(L.latLngBounds(areas.map((a) => [a.lat, a.lon] as [number, number])), { padding: [60, 60], maxZoom: 14 });
  }, [areas, selected, onSelect]);
  return <div ref={el} className="leaflet-box" style={{ height: 420 }} role="application" aria-label="Map of expansion areas" />;
}

function AreaCard({ a, rank, on, onSelect }: { a: Area; rank: number; on: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`area-card${on ? ' on' : ''}`} onClick={onSelect} aria-pressed={on}>
      <span className="area-rank num">{rank}</span>
      <span className="area-body">
        <strong>{a.label}</strong>
        <span className="small muted">
          {a.joined} joined ({a.drivers} drive, {a.riders} ride)
          {a.potential != null ? ` · ${a.potential} not joined yet` : ''}
        </span>
        <span className="gap-chips">{a.gaps.map((g) => <span key={g.code} className="chip">{g.text}</span>)}</span>
      </span>
      <span className="area-forecast">
        <span className="num">{a.forecast.unmet_next_7}</span>
        <span className="small muted">unmet trips next week</span>
        <span className="small">{TREND[a.forecast.trend]}</span>
      </span>
    </button>
  );
}

function Links({ links, synthetic }: { links: CommunityLink[]; synthetic: boolean }) {
  const propose = useProposeCorridor();
  const neighbour = useDemoNeighbour();
  const announce = useAnnounce();
  if (!links.length) {
    return (
      <div className="stack">
        <p className="muted">No other community overlaps with yours yet. Links appear when another community has people in your neighbourhoods heading the same way.</p>
        {synthetic && (
          <button className="btn btn-quiet" style={{ justifySelf: 'start' }} disabled={neighbour.isPending}
            onClick={() => neighbour.mutate(undefined, { onSuccess: (r) => announce(`${r.name} added.`) })}>
            {neighbour.isPending ? 'Adding… about 10 seconds' : 'Add the neighbouring demo community'}
          </button>
        )}
        <ErrorNote error={neighbour.error} />
      </div>
    );
  }
  return (
    <div className="stack-lg">
      {links.map((l) => (
        <div key={l.community_id} className="stack">
          <div className="section-head">
            <h3 style={{ fontSize: 16 }}>{l.community}</h3>
            {l.corridors_unlocked > 0 && <span className="chip">{l.corridors_unlocked} corridor{l.corridors_unlocked === 1 ? '' : 's'} unlocked together</span>}
          </div>
          <p className="small">{l.recommendation}</p>
          {l.shared_corridors.length > 0 && (
            <div className="table-scroll" style={{ maxHeight: 'none' }}>
              <table className="data">
                <thead><tr><th scope="col">Area</th><th scope="col">Yours</th><th scope="col">Theirs</th><th scope="col">Together</th><th scope="col" /></tr></thead>
                <tbody>
                  {l.shared_corridors.map((c) => (
                    <tr key={c.id}>
                      <th scope="row" style={{ color: 'var(--ink)', fontWeight: 500 }}>{c.area}<br /><span className="small muted" style={{ fontWeight: 400 }}>heading {c.heading}</span></th>
                      <td>{c.members_here}</td>
                      <td>{c.members_there}</td>
                      <td>{c.drivers_together} drive · {c.riders_together} ride {c.viable_together && <span className="chip chip-joined">viable only together</span>}</td>
                      <td>
                        <button className="btn btn-quiet btn-small" disabled={propose.isPending}
                          onClick={() => propose.mutate({ communityId: l.community_id, corridor: c.id }, { onSuccess: () => announce(`Shared corridor proposed in ${c.area}.`) })}>
                          Propose
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <ErrorNote error={propose.error} />
    </div>
  );
}

function outcomeText(a: ExpansionAction) {
  if (a.status === 'proposed') return <span className="small muted">Proposed to both organisers</span>;
  if (a.status === 'active') return <span className="small muted">Measuring… judged on day {a.day + 2}</span>;
  const o = a.outcome;
  const parts = [`${o.responded}/${o.sent} responded`];
  if (o.joined_delta) parts.push(`${o.joined_delta > 0 ? '+' : ''}${o.joined_delta} joined`);
  if (o.rides_delta) parts.push(`${o.rides_delta > 0 ? '+' : ''}${o.rides_delta} rides`);
  return <span className="small"><span className={`result ${o.success ? 'ok' : 'no'}`}>{o.success ? 'Worked' : 'No effect'}</span> {parts.join(' · ')}</span>;
}

function Learning({ r }: { r: ExpansionReport }) {
  const rows = Object.entries(r.effectiveness);
  return (
    <div className="stack">
      {rows.map(([k, s]) => (
        <div key={k} className="learn-row">
          <span>{s.label}</span>
          <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round(s.rate * 100)}%` }} /></span>
          <span className="num small" style={{ textAlign: 'right' }}>{Math.round(s.rate * 100)}%</span>
          <span className="small muted">{s.trials ? `${s.successes} of ${s.trials} worked` : 'not tried yet'}</span>
        </div>
      ))}
      <p className="small muted">Expected success of each action, learned from outcomes (a Beta posterior). Less-tried actions get a small exploration bonus when the engine chooses.</p>
    </div>
  );
}

export default function Expansion() {
  const { session } = useSession();
  const q = useExpansion();
  const run = useRunExpansion();
  const autopilot = useAutopilot();
  const announce = useAnnounce();
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const synthetic = !!session?.tenant.synthetic;
  const r = q.data;
  const busy = run.isPending || autopilot.isPending;

  function say(m: string) { setNote(m); announce(m); }

  return (
    <>
      <div className="page-actions">
        <p className="small muted">Finds where the network can grow, acts through the normal nudges, then checks whether it worked{r ? ` · day ${r.day}` : ''}.</p>
        <span className="spacer" />
        {synthetic && (
          <button className="btn btn-quiet btn-small" disabled={busy}
            onClick={() => autopilot.mutate(5, { onSuccess: (x) => say(`Simulated 5 days on autopilot: ${x.actions_taken} actions taken. Now day ${x.current_day}.`) })}>
            {autopilot.isPending ? 'Simulating…' : 'Autopilot 5 days'}
          </button>
        )}
        <button className="btn btn-primary btn-small" disabled={busy}
          onClick={() => run.mutate(3, { onSuccess: (x) => say(x.actions.length ? `Took ${x.actions.length} action${x.actions.length === 1 ? '' : 's'}${x.evaluated ? `, judged ${x.evaluated} earlier` : ''}.` : 'Nothing new to do today: every area already has an action running.') })}>
          {run.isPending ? 'Running…' : 'Run engine'}
        </button>
      </div>

      {note && <p className="note note-ok" role="status">{note}</p>}
      <ErrorNote error={q.error || run.error || autopilot.error} />

      <section className="panel" aria-label="How the engine works">
        <ol className="loop">
          {LOOP.map((s, i) => <li key={s}><span className="num">{i + 1}</span>{s}</li>)}
        </ol>
        {r ? (
          <div className="kpi-row">
            <div><strong className="num">{r.network.members_joined}</strong><span className="small muted">members joined</span></div>
            <div><strong className="num">{r.network.roster_not_joined ?? '<3'}</strong><span className="small muted">on the roster, not joined</span></div>
            <div><strong className="num">{r.network.zones_active}</strong><span className="small muted">neighbourhood zones active</span></div>
            <div><strong className="num">{r.network.expansion_areas}</strong><span className="small muted">areas with room to grow</span></div>
          </div>
        ) : <Skeleton h={64} />}
      </section>

      {!r ? <Skeleton h={420} /> : (
        <>
          <div className="dash-2">
            <section className="panel" aria-labelledby="diag-h">
              <h2 id="diag-h">Why growth is slowing</h2>
              {r.diagnosis.length === 0 ? <p className="muted">No bottlenecks found. The community is growing evenly.</p> : (
                <ul className="list-plain">
                  {r.diagnosis.map((f) => (
                    <li key={f.code}>
                      <div className="section-head" style={{ marginBottom: 0 }}><strong>{f.title}</strong>
                        <span className="sev" aria-label={`Severity ${Math.round(f.severity * 100)}%`}><i style={{ width: `${Math.round(f.severity * 100)}%` }} /></span></div>
                      <span className="small muted">{f.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="panel" aria-labelledby="next-h">
              <h2 id="next-h">What the engine will do next</h2>
              {r.next_actions.length === 0 ? <p className="muted">Nothing new today: every area already has an action running.</p> : (
                <ol className="list-plain">
                  {r.next_actions.map((a, i) => (
                    <li key={`${i}-${a.kind}`}>
                      <strong>{a.label} in {a.area}</strong>
                      <span className="small muted">{a.why} · expected value {a.value.toFixed(2)}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="small muted">Run the engine to take these actions. It nudges joined members in each area through the normal nudge system, at most 5 per action, respecting each person’s cooldown.</p>
            </section>
          </div>

          <section className="panel" aria-labelledby="areas-h">
            <div className="section-head"><h2 id="areas-h">Where to grow</h2><span className="small muted">Ranked by forecast unmet demand, untapped neighbours, empty seats and lapsed riders</span></div>
            {r.areas.length === 0 ? <p className="muted">No area stands out yet. Areas appear as people join and ask for rides.</p> : (
              <div className="areas-grid">
                <AreaMap areas={r.areas} selected={selected} onSelect={setSelected} />
                <div className="stack" style={{ gap: 8 }}>
                  {r.areas.map((a, i) => <AreaCard key={a.id} a={a} rank={i + 1} on={selected === a.id} onSelect={() => setSelected(a.id)} />)}
                </div>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="links-h">
            <div className="section-head"><h2 id="links-h">Communities to connect</h2><span className="small muted">Same neighbourhood, same direction of travel</span></div>
            <Links links={r.cross_community} synthetic={synthetic} />
          </section>

          <div className="dash-21">
            <section className="panel" aria-labelledby="log-h">
              <h2 id="log-h">Actions and results</h2>
              {r.actions.length === 0 ? <p className="muted">No actions yet. Run the engine to start.</p> : (
                <div className="table-scroll">
                  <table className="data">
                    <thead><tr><th scope="col">Day</th><th scope="col">Action</th><th scope="col">Why</th><th scope="col">Reached</th><th scope="col">Result</th></tr></thead>
                    <tbody>
                      {r.actions.map((a) => (
                        <tr key={a.id}>
                          <td className="num">{a.day}</td>
                          <td><strong style={{ fontWeight: 600 }}>{a.label}</strong><br /><span className="small muted">{a.area}</span></td>
                          <td className="small">{a.reason}</td>
                          <td>{a.targeted || '—'}</td>
                          <td>{outcomeText(a)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="panel" aria-labelledby="learn-h">
              <h2 id="learn-h">What works here</h2>
              <Learning r={r} />
            </section>
          </div>

          <p className="small muted" style={{ maxWidth: 820 }}>{r.privacy}</p>
        </>
      )}
    </>
  );
}
