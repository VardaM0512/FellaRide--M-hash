// Live rides: every ride on the road right now, as a control room. Cars glide along real roads on a dark map,
// each trailing a blue-to-brass comet; the road ahead flows; pickups and arrivals burst on the map and land in a
// running feed; a live band counts riders on board and the CO2 these rides are saving as they go.
// Real communities show member-app rides that have set off or leave soon (at the driver's live position when they
// share it). A demo community replays its latest rides on a loop, clearly marked simulated.
import { AnimatePresence, motion } from 'framer-motion';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useCommunity } from '../api/hooks';
import { useLive, type LiveRide } from '../api/organiser';
import { Avatar, CountUp, ErrorNote, Skeleton } from '../components/ui';
import { firstName } from '../lib/format';
import { haversineKm, roadThrough } from '../lib/places';
import { usePrefs } from '../lib/prefs';
import { OrgIcon } from './orgIcons';

const CO2_KG_PER_KM = 0.12;      // the same estimate as the Impact page (backend social.CO2_KG_PER_KM)
const TRAIL = 0.16;              // how much of the route the comet trail covers
const TRAIL_STEPS = 9;
const TOUR_MS = 9000;
// the comet's colours, tail to head: Fella Blue into brass (the dark-theme steps, which glow on the dark map)
const TAIL: [number, number, number] = [106, 168, 240];
const HEAD: [number, number, number] = [217, 170, 78];
const mix = (t: number) => `rgb(${TAIL.map((c, i) => Math.round(c + (HEAD[i] - c) * t)).join(',')})`;

interface Geo { coords: [number, number][]; cum: number[]; total: number; at: number[] }

function prepare(coords: [number, number][], at: number[]): Geo {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineKm({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] }));
  }
  return { coords, cum, total: cum[cum.length - 1] || 1, at };
}

/** The point a fraction p (0 to 1) of the way along, the bearing there (degrees from north), and the road from p0 to p. */
function along(g: Geo, p: number, p0 = 0) {
  const pointAt = (q: number) => {
    const d = Math.max(0, Math.min(1, q)) * g.total;
    let i = 1;
    while (i < g.cum.length - 1 && g.cum[i] < d) i++;
    const a = g.coords[i - 1], b = g.coords[i] ?? a;
    const t = Math.max(0, Math.min(1, (d - g.cum[i - 1]) / (g.cum[i] - g.cum[i - 1] || 1)));
    return { i, pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number], a, b };
  };
  const end = pointAt(p), start = pointAt(p0);
  const heading = (Math.atan2((end.b[1] - end.a[1]) * Math.cos((end.a[0] * Math.PI) / 180), end.b[0] - end.a[0]) * 180) / Math.PI;
  return { pos: end.pos, heading, path: [start.pos, ...g.coords.slice(start.i, end.i), end.pos] as [number, number][] };
}

/** How far along a recorded route each pickup is (the nearest point of the route to it). */
function stopsOnPath(path: [number, number][], ride: LiveRide): number[] {
  const g = prepare(path, []);
  const frac = (lat: number, lon: number) => {
    let best = 0, bd = Infinity;
    path.forEach(([a, b], i) => { const dd = (a - lat) ** 2 + (b - lon) ** 2; if (dd < bd) { bd = dd; best = i; } });
    return g.cum[best] / g.total;
  };
  return [0, ...ride.riders.map((r) => frac(r.lat, r.lon)), 1];
}

interface State { p: number; pos: [number, number]; heading: number; boarded: boolean[]; text: string; eta: number | null; arrived: boolean; kmWithRiders: number }

function stateOf(r: LiveRide, g: Geo, now: number): State {
  const start = Date.parse(r.started_at);
  const p = r.status === 'leaving' ? 0 : Math.max(0, Math.min(1, (now - start) / 1000 / r.duration_s));
  const a = along(g, p);
  const pos: [number, number] = r.live ? [r.live.lat, r.live.lon] : a.pos;
  const boarded = r.riders.map((x, i) => x.on_board || (r.status === 'on_the_way' && p >= (g.at[i + 1] ?? 1) - 1e-6));
  const next = boarded.indexOf(false);
  // km each rider has ridden so far (from their pickup to here): what turns into CO2 saved
  const kmWithRiders = r.riders.reduce((km, _x, i) => km + (boarded[i] ? Math.max(0, p - (g.at[i + 1] ?? 1)) * g.total : 0), 0);
  let text: string;
  if (r.status === 'leaving') {
    const mins = Math.round((start - now) / 60000);
    text = mins > 0 ? `Leaves ${r.from.name} in ${mins} min` : `Leaving ${r.from.name} now`;
  } else if (p >= 1) text = `Arrived at ${r.to.name}`;
  else if (next >= 0) text = `Picking up ${firstName(r.riders[next].name)}`;
  else text = `${boarded.length} on board · heading to ${r.to.name}`;
  return { p, pos, heading: a.heading, boarded, text, arrived: p >= 1, kmWithRiders,
    eta: r.status === 'on_the_way' && p < 1 ? Math.max(1, Math.ceil(((1 - p) * r.duration_s) / 60)) : null };
}

function carHtml(selected: boolean) {
  return `<span class="lr-car${selected ? ' sel' : ''}"><span class="lr-car-halo"></span><span class="lr-car-arrow"></span><span class="lr-car-body"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V11l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3"/></svg></span></span>`;
}

interface Happening { id: number; text: string; tone: 'pickup' | 'arrive' }

export default function LiveRides() {
  const q = useLive();
  const community = useCommunity().data;
  const { motionReduced } = usePrefs();
  const board = q.data;
  const [geos, setGeos] = useState<Map<string, Geo>>(new Map());
  const [now, setNow] = useState(Date.now());
  const [sel, setSel] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [tour, setTour] = useState(false);
  const [feed, setFeed] = useState<Happening[]>([]);
  const skew = useRef(0);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fx = useRef<L.LayerGroup | null>(null);
  const parts = useRef(new Map<string, { car: L.Marker; trail: L.Polyline[]; glow: L.Polyline; pickups: L.Marker[] }>());
  const prev = useRef(new Map<string, { boarded: boolean[]; arrived: boolean }>());
  const fitted = useRef(false);
  const eventId = useRef(0);

  useEffect(() => { if (board) skew.current = Date.parse(board.server_now) - Date.now(); }, [board]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now() + skew.current), 1000); return () => window.clearInterval(t); }, []);

  // road geometry: recorded routes straight away; replayed rides ask the router once each, one at a time
  const rides = useMemo(() => board?.rides ?? [], [board]);
  const key = rides.map((r) => r.id).join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const r of rides) {
        if (cancelled || geos.has(r.id)) continue;
        const g = r.path && r.path.length > 1 ? prepare(r.path, stopsOnPath(r.path, r))
          : await roadThrough(r.waypoints ?? [[r.from.lat, r.from.lon], [r.to.lat, r.to.lon]]).then((x) => prepare(x.coords, x.at));
        if (cancelled) return;
        setGeos((m) => new Map(m).set(r.id, g));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // the map, once (always the dark basemap here: the trails glow on it)
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, zoomSnap: 0.25 });
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    m.setView([community?.center.lat ?? 12.9716, community?.center.lon ?? 77.5946], 13);
    layer.current = L.layerGroup().addTo(m);
    fx.current = L.layerGroup().addTo(m);
    m.on('dragstart', () => { setFollow(false); setTour(false); });
    map.current = m;
    fitted.current = false;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const states = useMemo(() => new Map(rides.filter((r) => geos.has(r.id)).map((r) => [r.id, stateOf(r, geos.get(r.id)!, now)])), [rides, geos, now]);

  // draw each ride when its road arrives
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    parts.current.clear();
    const dests = new Map<string, LiveRide['to']>();
    rides.forEach((r) => {
      const geo = geos.get(r.id);
      if (!geo) return;
      dests.set(`${r.to.lat},${r.to.lon}`, r.to);
      // the road ahead: a faint line with dashes flowing towards the destination
      L.polyline(geo.coords, { color: '#9FC4F2', weight: 2, opacity: 0.22, interactive: false }).addTo(g);
      L.polyline(geo.coords, { color: '#9FC4F2', weight: 2, opacity: 0.55, dashArray: '2 14', lineCap: 'round', className: 'lr-flow', interactive: false }).addTo(g);
      const glow = L.polyline([], { color: mix(1), weight: 12, opacity: 0.35, lineCap: 'round', className: 'lr-glow', interactive: false }).addTo(g);
      const trail = Array.from({ length: TRAIL_STEPS }, (_, k) => L.polyline([], {
        color: mix(k / (TRAIL_STEPS - 1)), weight: 2 + (k / (TRAIL_STEPS - 1)) * 3.5, opacity: 0.25 + (k / (TRAIL_STEPS - 1)) * 0.75,
        lineCap: 'round', lineJoin: 'round', interactive: false,
      }).addTo(g));
      const pickups = r.riders.map((x) => {
        const mk = L.marker([x.lat, x.lon], { icon: L.divIcon({ className: 'lr-pin-wrap', html: '<span class="lr-pin"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), keyboard: false }).addTo(g);
        const t = document.createElement('span');
        t.textContent = `${x.name} is waiting`;
        mk.bindTooltip(t, { direction: 'top', offset: [0, -8] });
        return mk;
      });
      const car = L.marker(geo.coords[0], { icon: L.divIcon({ className: 'lr-car-wrap', html: carHtml(false), iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 1000, keyboard: false }).addTo(g);
      const tip = document.createElement('span');
      tip.textContent = `${r.driver.name} → ${r.to.name}`;
      car.bindTooltip(tip, { direction: 'top', offset: [0, -18] });
      car.on('click', () => { setSel(r.id); setFollow(true); setTour(false); });
      parts.current.set(r.id, { car, trail, glow, pickups });
    });
    dests.forEach((d) => {
      const html = document.createElement('span');
      html.className = 'lr-dest';
      html.innerHTML = '<i class="lr-dest-ring"></i><i class="lr-dest-ring two"></i><i class="lr-dest-core"></i>';
      const label = document.createElement('b');
      label.textContent = d.name;
      html.append(label);
      L.marker([d.lat, d.lon], { icon: L.divIcon({ html, className: 'lr-dest-wrap', iconSize: [24, 24], iconAnchor: [12, 12] }), keyboard: false, zIndexOffset: 500 }).addTo(g);
    });
    const pts = rides.filter((r) => geos.has(r.id)).flatMap((r) => [[r.from.lat, r.from.lon], [r.to.lat, r.to.lon], ...r.riders.map((x) => [x.lat, x.lon])] as [number, number][]);
    if (pts.length > 2 && !fitted.current && geos.size >= Math.min(rides.length, 3)) {
      fitted.current = true;
      m.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, geos]);

  // a burst of light on the map, and a line in the running feed
  function happen(at: [number, number], tone: Happening['tone'], text: string) {
    if (fx.current && !motionReduced) {
      const b = L.marker(at, { icon: L.divIcon({ className: 'lr-burst-wrap', html: `<span class="lr-burst ${tone}"><i></i><i></i><b>${tone === 'pickup' ? '+1' : '✓'}</b></span>`, iconSize: [80, 80], iconAnchor: [40, 40] }), interactive: false, keyboard: false }).addTo(fx.current);
      window.setTimeout(() => fx.current?.removeLayer(b), 1600);
    }
    const id = ++eventId.current;
    setFeed((f) => [{ id, text, tone }, ...f].slice(0, 4));
  }

  // every second: move the cars, draw the comets, catch pickups and arrivals
  useEffect(() => {
    states.forEach((s, id) => {
      const part = parts.current.get(id), r = rides.find((x) => x.id === id), geo = geos.get(id);
      if (!part || !r || !geo) return;
      part.car.setLatLng(s.pos);
      const e = part.car.getElement()?.querySelector<HTMLElement>('.lr-car');   // restyle in place: the halo keeps pulsing
      e?.style.setProperty('--h', `${s.heading}deg`);
      e?.classList.toggle('sel', id === sel);
      e?.classList.toggle('done', s.arrived);
      const from = Math.max(0, s.p - TRAIL);
      part.trail.forEach((line, k) => line.setLatLngs(r.status === 'leaving' ? [] : along(geo, from + ((s.p - from) * (k + 1)) / TRAIL_STEPS, from + ((s.p - from) * k) / TRAIL_STEPS).path));
      part.glow.setLatLngs(r.status === 'leaving' ? [] : along(geo, s.p, Math.max(0, s.p - TRAIL / 2)).path);
      part.pickups.forEach((pin, i) => pin.getElement()?.classList.toggle('gone', s.boarded[i]));

      const before = prev.current.get(id);
      if (before) {
        s.boarded.forEach((b, i) => { if (b && !before.boarded[i] && !r.riders[i].on_board) happen([r.riders[i].lat, r.riders[i].lon], 'pickup', `${firstName(r.driver.name)} picked up ${firstName(r.riders[i].name)}`); });
        if (s.arrived && !before.arrived) happen([r.to.lat, r.to.lon], 'arrive', `${firstName(r.driver.name)} arrived at ${r.to.name} with ${s.boarded.filter(Boolean).length}`);
      }
      prev.current.set(id, { boarded: s.boarded, arrived: s.arrived });
    });
    const s = sel ? states.get(sel) : null;
    if (follow && s && map.current) map.current.panTo(s.pos, { animate: true, duration: 1, easeLinearity: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states, sel, follow]);

  // auto tour: follow each car in turn (for presenting)
  useEffect(() => {
    if (!tour) return;
    const ids = rides.filter((r) => r.status === 'on_the_way').map((r) => r.id);
    if (!ids.length) return;
    const go = (i: number) => { const id = ids[i % ids.length]; setSel(id); setFollow(true); const s = states.get(id); if (s && map.current) map.current.flyTo(s.pos, 15.5, { duration: 1.2 }); };
    let i = Math.max(0, ids.indexOf(sel ?? '') + 1);
    go(i);
    const t = window.setInterval(() => go(++i), TOUR_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour, key]);

  function focus(id: string) {
    setTour(false);
    setSel(id);
    setFollow(true);
    const s = states.get(id);
    if (s && map.current) map.current.flyTo(s.pos, 15.5, { duration: 1 });
  }
  function overview() {
    setTour(false); setFollow(false); setSel(null);
    const pts = rides.flatMap((r) => [[r.from.lat, r.from.lon], [r.to.lat, r.to.lon]] as [number, number][]);
    if (pts.length > 1 && map.current) map.current.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15, duration: 1 });
  }

  if (q.error) return <ErrorNote error={q.error} onRetry={() => q.refetch()} />;
  const all = [...states.values()];
  const moving = rides.filter((r) => r.status === 'on_the_way' && !states.get(r.id)?.arrived).length;
  const aboard = all.reduce((n, s) => n + (s.arrived ? 0 : s.boarded.filter(Boolean).length), 0);
  const km = all.reduce((n, s) => n + s.kmWithRiders, 0);
  const seatsFree = rides.reduce((n, r) => n + Math.max(0, r.seats_total - r.riders.length), 0);

  return (
    <div className="lr">
      <section className="lr-band" aria-label="Right now">
        <div className="lr-band-title">
          <span className="lr-live"><span className="lr-live-dot" aria-hidden="true" />Live</span>
          <h2>{board?.simulated ? 'Simulated replay' : 'Rides on the road'}</h2>
          <p>{board?.simulated
            ? `Nobody in a demo community is really driving, so this replays the engine’s latest rides (from day ${board.source_day} on) on a ${Math.round(board.loop_s / 60)}-minute loop. Real communities see members’ actual rides here.`
            : 'Member-app rides that have set off, or leave in the next 30 minutes.'}</p>
        </div>
        <div className="lr-stats">
          <div><strong className="num"><CountUp value={moving} /></strong><span>on the road</span></div>
          <div><strong className="num"><CountUp value={aboard} /></strong><span>riders on board</span></div>
          <div><strong className="num"><CountUp value={km} decimals={1} /><small>km</small></strong><span>shared so far</span></div>
          <div className="co2"><strong className="num"><CountUp value={km * CO2_KG_PER_KM} decimals={2} /><small>kg</small></strong><span>CO₂ saved by these rides</span></div>
        </div>
      </section>

      <div className="livemap">
        <section className="livemap-stage panel lr-stage" aria-labelledby="lr-h">
          <h2 id="lr-h" className="sr-only">Map of rides on the road</h2>
          <div ref={el} className="livemap-canvas lr-canvas" role="application" aria-label="Map of rides on the road. The list beside it has the same rides." />
          <div className="lr-vignette" aria-hidden="true" />
          <div className="lr-controls">
            <button type="button" className={`lr-btn${tour ? ' on' : ''}`} onClick={() => setTour((t) => !t)} aria-pressed={tour}>
              <span className="lr-btn-dot" aria-hidden="true" />{tour ? 'Touring…' : 'Auto tour'}
            </button>
            <button type="button" className="lr-btn" onClick={overview}>{OrgIcon.overview}Show all</button>
          </div>
          <ol className="lr-feed" aria-live="polite">
            <AnimatePresence initial={false}>
              {feed.map((f) => (
                <motion.li key={f.id} className={`lr-event ${f.tone}`} layout
                  initial={{ opacity: 0, x: -24, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -12 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
                  <span className="lr-event-dot" aria-hidden="true" />{f.text}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
          {board && rides.length === 0 && (
            <div className="lr-empty">
              <strong>No rides on the road right now</strong>
              <span className="small">Rides that have set off, or leave in the next 30 minutes, show up here as they happen.</span>
            </div>
          )}
        </section>

        <aside className="livemap-side">
          <section className="panel lr-list-panel" aria-labelledby="lr-list-h">
            <div className="section-head"><h2 id="lr-list-h">On the road</h2><span className="small muted">{seatsFree} empty seat{seatsFree === 1 ? '' : 's'}</span></div>
            {!board ? <Skeleton h={300} /> : rides.length === 0 ? <p className="small muted">Nothing yet.</p> : (
              <ul className="lr-list">
                {rides.map((r, idx) => {
                  const s = states.get(r.id);
                  return (
                    <motion.li key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(idx, 8) * 0.05 }}>
                      <button type="button" className={`lr-ride${sel === r.id ? ' on' : ''}${s?.arrived ? ' arrived' : ''}`} onClick={() => focus(r.id)} aria-pressed={sel === r.id}>
                        <div className="lr-top">
                          <Avatar name={r.driver.name} driver />
                          <span className="lr-who"><strong>{r.driver.name}</strong><span className="small muted">{r.from.name} → {r.to.name}</span></span>
                          <span className={`lr-tag k-${r.kind}`}>{r.kind === 'simulated' ? 'Simulated' : r.live ? 'Live GPS' : r.status === 'leaving' ? 'Soon' : 'Estimated'}</span>
                        </div>
                        <div className="lr-status-row">
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.p key={s?.text ?? 'wait'} className="lr-status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                              {s ? s.text : 'Finding the road…'}
                            </motion.p>
                          </AnimatePresence>
                          {s?.eta ? <span className="lr-eta num">{s.eta} min</span> : null}
                        </div>
                        <span className="lr-progress" aria-hidden="true"><i style={{ width: `${(s?.p ?? 0) * 100}%` }} /></span>
                        {r.riders.length > 0 && (
                          <span className="lr-riders">
                            {r.riders.map((x, i) => (
                              <motion.span key={x.name + i} className={`lr-rider${s?.boarded[i] ? ' in' : ''}`}
                                animate={s?.boarded[i] ? { scale: [1, 1.18, 1] } : { scale: 1 }} transition={{ duration: 0.45 }}>
                                {firstName(x.name)}
                              </motion.span>
                            ))}
                            <span className="small muted">{r.riders.length}/{r.seats_total} seats</span>
                          </span>
                        )}
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
