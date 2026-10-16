// The community on a real street map. Play or drag the day and it braids together: dots light up as people
// join, threads appear along the roads as people ride together, busy routes glow. Drivers are squares, riders
// circles, well-connected people ringed; colour shows how far along someone is. A list view carries the same data.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useClusters, useCommunity, useGraph, useMembers } from '../api/hooks';
import type { Community, Corridor, Graph, Member, MemberState } from '../api/types';
import { ErrorNote, Glyph, Icon, Skeleton } from '../components/ui';
import { STATE_LABEL } from '../lib/format';
import { usePrefs } from '../lib/prefs';
import { OrgIcon } from './orgIcons';
import { MemberSheet } from './Panels';

const STAGES: MemberState[] = ['discovered', 'registered', 'interacted', 'first_ride', 'repeat', 'referrer'];
const STAGE_VAR: Record<MemberState, string> = {
  discovered: 'var(--line)', registered: 'var(--fog)', interacted: 'var(--ink)', first_ride: 'var(--peacock)', repeat: 'var(--peacock)', referrer: 'var(--lime)',
};
type Role = 'all' | 'drivers' | 'riders';

/** A member's stage as it was on a given day, from their funnel day-stamps. */
export function stageOn(m: Member, day: number): MemberState {
  const f = m.funnel;
  const by = (d: number | null) => d !== null && d <= day;
  if (by(f.referrer_day)) return 'referrer';
  if (by(f.repeat_day)) return 'repeat';
  if (by(f.first_ride_day)) return 'first_ride';
  if (by(f.interacted_day)) return 'interacted';
  if (by(f.registered_day)) return 'registered';
  return 'discovered';
}
type Layers = { rides: boolean; invites: boolean; routes: boolean; unjoined: boolean };

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A text-only element for Leaflet labels and tooltips (names are never parsed as HTML). */
function textEl(tag: string, cls: string, text: string) {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

/** A shared ride as a thread: from the farther home, through the other (the pickup), curving on to the destination. */
function thread(a: Member, b: Member, dest?: { lat: number; lon: number }): [number, number][] {
  const A: [number, number] = [a.home.lat, a.home.lon], B: [number, number] = [b.home.lat, b.home.lon];
  if (!dest) return [A, B];
  const T: [number, number] = [dest.lat, dest.lon];
  const far = Math.hypot(A[0] - T[0], A[1] - T[1]) >= Math.hypot(B[0] - T[0], B[1] - T[1]);
  const [S, P] = far ? [A, B] : [B, A];
  const C: [number, number] = [P[0], P[1] + (T[1] - P[1]) * 0.45];
  const pts: [number, number][] = [S, P];
  for (let i = 1; i <= 12; i++) {
    const t = i / 12, u = 1 - t;
    pts.push([u * u * P[0] + 2 * u * t * C[0] + t * t * T[0], u * u * P[1] + 2 * u * t * C[1] + t * t * T[1]]);
  }
  return pts;
}

function MapCanvas({ community, members, graph, corridors, day, today, layers, role, selected, onSelect, flyTo }: {
  community: Community; members: Member[]; graph: Graph; corridors: Corridor[]; day: number; today: number; layers: Layers; role: Role;
  selected: number | null; onSelect: (id: number) => void; flyTo: { lat: number; lon: number; zoom: number; n: number } | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const groups = useRef<Record<'routes' | 'edges' | 'refs' | 'dests' | 'members', L.LayerGroup> | null>(null);
  const markers = useRef(new Map<number, { mk: L.Marker; m: Member }>());
  const edges = useRef<{ line: L.Polyline; since: number; kind: string; weight: number }[]>([]);
  const fitted = useRef(false);
  const select = useRef(onSelect);
  select.current = onSelect;
  const { theme } = usePrefs();

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, scrollWheelZoom: true, zoomSnap: 0.25 });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    groups.current = {
      routes: L.layerGroup().addTo(m), edges: L.layerGroup().addTo(m), refs: L.layerGroup().addTo(m),
      dests: L.layerGroup().addTo(m), members: L.layerGroup().addTo(m),
    };
    map.current = m;
    fitted.current = false;   // a new map (StrictMode mounts twice) has no view yet
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  // build every layer when the data (or the theme's colours) change
  useEffect(() => {
    const m = map.current, g = groups.current;
    if (!m || !g) return;
    Object.values(g).forEach((x) => x.clearLayers());
    markers.current.clear();
    edges.current = [];
    const blue = cssVar('--peacock') || '#1A66BD', brass = cssVar('--lime') || '#C9973A';
    const byId = new Map(members.map((x) => [x.id, x]));
    const dests = new Map(community.destinations.map((d) => [d.id, d]));

    corridors.forEach((c) => {
      const circle = L.circle([c.lat, c.lon], { radius: 260 + c.size * 40, color: blue, weight: 1, opacity: 0.5, fillColor: blue, fillOpacity: 0.1, interactive: true });
      circle.bindTooltip(textEl('span', '', `${c.area} → ${c.destination} around ${c.window} · ${c.registered} of ${c.size} joined (${c.drivers} drive, ${c.riders} ride)`), { sticky: true });
      circle.addTo(g.routes);
    });

    const canvas = L.canvas({ padding: 0.4 });
    graph.edges.forEach((e) => {
      if (e.kind === 'social') return;
      const a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b) return;
      const isRef = e.kind === 'referral';
      const line = L.polyline(isRef ? [[a.home.lat, a.home.lon], [b.home.lat, b.home.lon]] : thread(a, b, dests.get(a.destination_id)), {
        renderer: canvas, color: isRef ? brass : blue, weight: isRef ? 1.5 : Math.min(4, 1 + e.weight * 0.6), opacity: 0,
        dashArray: isRef ? '4 5' : undefined, lineCap: 'round', lineJoin: 'round', interactive: false,
      });
      line.addTo(isRef ? g.refs : g.edges);
      edges.current.push({ line, since: e.since_day, kind: e.kind, weight: e.weight });
    });

    community.destinations.forEach((d) => {
      const html = document.createElement('span');
      html.className = 'dest-mk';
      html.append(document.createElement('i'), textEl('b', '', d.name));
      L.marker([d.lat, d.lon], { icon: L.divIcon({ html, className: 'dest-wrap', iconSize: [20, 20], iconAnchor: [10, 10] }), keyboard: false, zIndexOffset: 500 })
        .addTo(g.dests);
    });

    members.forEach((x) => {
      const html = document.createElement('span');
      html.className = 'mm';
      const mk = L.marker([x.home.lat, x.home.lon], {
        icon: L.divIcon({ html, className: `mm-wrap${x.has_car ? ' drv' : ''}${x.is_connector ? ' con' : ''}`, iconSize: [16, 16], iconAnchor: [8, 8] }),
        keyboard: false, riseOnHover: true, title: '',
      });
      mk.bindTooltip(textEl('span', '', `${x.name} · ${x.has_car ? 'drives' : 'rides'} from ${x.area}`), { direction: 'top', offset: [0, -6] });
      mk.on('click', () => { if (stageOn(x, Number(mk.getElement()?.dataset.day ?? today)) !== 'discovered') select.current(x.id); });
      mk.addTo(g.members);
      markers.current.set(x.id, { mk, m: x });
    });

    const pts = [...members.map((x) => [x.home.lat, x.home.lon] as [number, number]), ...community.destinations.map((d) => [d.lat, d.lon] as [number, number])];
    if (pts.length && !fitted.current) {   // once: later polls keep where the organiser has zoomed to
      fitted.current = true;
      m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community, members, graph, corridors, theme]);

  // the day and the filters: restyle what's already there (no rebuild, so playing stays smooth)
  useEffect(() => {
    const m = map.current, g = groups.current;
    if (!m || !g) return;
    markers.current.forEach(({ mk, m: x }) => {
      const e = mk.getElement();
      if (!e) return;
      const stage = stageOn(x, day);
      const hiddenRole = (role === 'drivers' && !x.has_car) || (role === 'riders' && x.has_car);
      const hiddenStage = stage === 'discovered' && !layers.unjoined;
      e.dataset.stage = stage;
      e.dataset.day = String(day);
      e.classList.toggle('off', hiddenRole || hiddenStage);
      e.classList.toggle('fresh', day !== today && x.funnel.registered_day === day);
      e.classList.toggle('sel', x.id === selected);
    });
    edges.current.forEach(({ line, since, kind, weight }) => {
      const show = since <= day && (kind === 'referral' ? layers.invites : layers.rides);
      line.setStyle({ opacity: show ? (kind === 'referral' ? 0.85 : Math.min(0.75, 0.3 + weight * 0.08)) : 0 });
    });
    const toggle = (grp: L.LayerGroup, on: boolean) => { if (on && !m.hasLayer(grp)) grp.addTo(m); if (!on && m.hasLayer(grp)) m.removeLayer(grp); };
    toggle(g.routes, layers.routes);
  }, [day, today, layers, role, selected, community, members, graph, corridors, theme]);

  useEffect(() => { if (flyTo && map.current) map.current.flyTo([flyTo.lat, flyTo.lon], flyTo.zoom, { duration: 0.8 }); }, [flyTo]);

  return <div ref={el} className="livemap-canvas" role="application" aria-label="Community map. Use Show as list for the same information as a table." />;
}

export default function LiveMap() {
  const community = useCommunity();
  const members = useMembers();
  const graph = useGraph();
  const clusters = useClusters();
  const c = community.data;
  const today = c?.current_day ?? 0;
  const [day, setDay] = useState(today);
  const [playing, setPlaying] = useState(false);
  const [asList, setAsList] = useState(false);
  const [layers, setLayers] = useState<Layers>({ rides: true, invites: true, routes: true, unjoined: true });
  const [role, setRole] = useState<Role>('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; zoom: number; n: number } | null>(null);
  const { motionReduced } = usePrefs();
  const timer = useRef<number | null>(null);

  useEffect(() => setDay(today), [today]);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => setDay((d) => { if (d >= today) { setPlaying(false); return today; } return d + 1; }), motionReduced ? 250 : 650);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, today, motionReduced]);

  const list = members.data || [];
  const counts = useMemo(() => {
    const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<MemberState, number>;
    list.forEach((m) => { out[stageOn(m, day)] += 1; });
    return out;
  }, [list, day]);
  const edgesNow = (graph.data?.edges || []).filter((e) => e.kind === 'co_ride' && e.since_day <= day).length;

  const error = community.error || members.error || graph.error;
  if (error) return <ErrorNote error={error} onRetry={() => { community.refetch(); members.refetch(); graph.refetch(); }} />;
  if (!c || !members.data || !graph.data) return <Skeleton h={560} />;
  const joined = list.length - counts.discovered;

  function find(e: FormEvent) {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    const hit = q ? list.find((m) => m.name.toLowerCase() === q) || list.find((m) => m.name.toLowerCase().includes(q)) : undefined;
    setMiss(!hit);
    if (!hit) return;
    setFlyTo({ lat: hit.home.lat, lon: hit.home.lon, zoom: 15, n: Date.now() });
    if (stageOn(hit, day) !== 'discovered') setSelected(hit.id);
  }
  const flip = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <>
      <div className="livemap">
        <section className="livemap-stage panel" aria-labelledby="lm-h">
          <h2 id="lm-h" className="sr-only">Community map</h2>
          {asList ? (
            <div className="table-scroll livemap-list">
              <table className="data">
                <caption className="sr-only">Members who had joined by day {day}</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Area</th><th scope="col">Travels as</th><th scope="col">Stage on day {day}</th><th scope="col">Rides</th></tr></thead>
                <tbody>
                  {list.filter((m) => stageOn(m, day) !== 'discovered').map((m) => (
                    <tr key={m.id}>
                      <td><button className="btn-link" onClick={() => setSelected(m.id)}>{m.name}</button></td>
                      <td>{m.area}</td>
                      <td>{m.has_car ? 'Driver' : 'Rider'}{m.is_connector ? ', well connected' : ''}</td>
                      <td>{STATE_LABEL[stageOn(m, day)]}</td>
                      <td>{m.rides_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <MapCanvas community={c} members={list} graph={graph.data} corridors={clusters.data || []} day={day} today={today}
              layers={layers} role={role} selected={selected} onSelect={setSelected} flyTo={flyTo} />
          )}

          <div className="lm-day glass">
            <span className="num lm-day-n">Day {day}</span>
            <span className="small">{joined} joined · {edgesNow} riding pairs</span>
          </div>

          <form className="lm-search glass" onSubmit={find} role="search">
            <label className="sr-only" htmlFor="lm-q">Find a member</label>
            <span aria-hidden="true">{Icon.search}</span>
            <input id="lm-q" list="lm-names" value={query} onChange={(e) => { setQuery(e.target.value); setMiss(false); }} placeholder="Find a member" autoComplete="off" />
            <datalist id="lm-names">{list.slice(0, 400).map((m) => <option key={m.id} value={m.name} />)}</datalist>
            {miss && <span className="small" role="status">No one by that name</span>}
          </form>

          <div className="lm-bar glass">
            <button className="icon-btn" onClick={() => { setPlaying(false); setDay((d) => Math.max(0, d - 1)); }} aria-label="Previous day">{Icon.prev}</button>
            <button className="lm-play" onClick={() => { if (day >= today) setDay(0); setPlaying((p) => !p); }} aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play the community from day 0'}>
              {playing ? Icon.pause : Icon.play}
            </button>
            <button className="icon-btn" onClick={() => { setPlaying(false); setDay((d) => Math.min(today, d + 1)); }} aria-label="Next day">{Icon.next}</button>
            <input type="range" min={0} max={today} step={1} value={day} aria-label="Day" aria-valuetext={`Day ${day} of ${today}`}
              onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)); }} style={{ ['--p' as string]: `${today ? (day / today) * 100 : 100}%` }} />
            <span className="small num">{day}/{today}</span>
            <button className="btn btn-quiet btn-small" onClick={() => setAsList((v) => !v)} aria-pressed={asList}>{asList ? 'Show map' : 'Show as list'}</button>
          </div>
        </section>

        <aside className="livemap-side">
          <section className="panel" aria-labelledby="lm-layers-h">
            <h2 id="lm-layers-h"><span className="h-icon">{OrgIcon.layers}</span>Show on the map</h2>
            <div className="segmented full" role="group" aria-label="Who to show">
              {(['all', 'drivers', 'riders'] as Role[]).map((r) => <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{r === 'all' ? 'Everyone' : r === 'drivers' ? 'Drivers' : 'Riders'}</button>)}
            </div>
            <div className="layer-list">
              {([['rides', 'Shared rides', 'Threads along the way to work or class'], ['invites', 'Invites', 'Who brought whom in'],
                ['routes', 'Busy routes', 'Where many people make the same trip'], ['unjoined', 'Not joined yet', 'People on the roster who haven’t signed up']] as const).map(([k, label, hint]) => (
                <label key={k} className="layer-row">
                  <input type="checkbox" checked={layers[k]} onChange={() => flip(k)} />
                  <span className={`layer-swatch sw-${k}`} aria-hidden="true" />
                  <span><strong>{label}</strong><span className="small muted">{hint}</span></span>
                </label>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="lm-stage-h">
            <h2 id="lm-stage-h">On day {day}</h2>
            <ul className="stage-legend">
              {STAGES.map((s) => (
                <li key={s}>
                  <Glyph driver={false} size={12} color={STAGE_VAR[s]} />
                  <span>{STATE_LABEL[s]}</span>
                  <span className="num">{counts[s]}</span>
                  <i aria-hidden="true"><b style={{ width: `${list.length ? (counts[s] / list.length) * 100 : 0}%`, background: STAGE_VAR[s] }} /></i>
                </li>
              ))}
            </ul>
            <p className="small muted legend-shapes"><Glyph driver size={11} color="var(--fog)" /> drives <Glyph driver={false} size={11} color="var(--fog)" /> rides <Glyph driver={false} connector size={11} color="var(--fog)" /> well connected</p>
          </section>

          <section className="panel" aria-labelledby="lm-routes-h">
            <h2 id="lm-routes-h">Busy routes</h2>
            {!(clusters.data || []).length ? <p className="small muted">None yet.</p> : (
              <ul className="route-picks">
                {(clusters.data || []).slice(0, 6).map((r) => (
                  <li key={r.key}>
                    <button type="button" onClick={() => { setLayers((l) => ({ ...l, routes: true })); setFlyTo({ lat: r.lat, lon: r.lon, zoom: 14, n: Date.now() }); }}>
                      <strong>{r.area} → {r.destination}</strong>
                      <span className="small muted">around {r.window} · {r.registered}/{r.size} joined · {r.drivers} drive</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      {!playing && <p className="sr-only" aria-live="polite">Day {day} of {today}: {joined} of {list.length} people joined, {edgesNow} pairs have shared a ride.</p>}
      {selected !== null && <MemberSheet id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
