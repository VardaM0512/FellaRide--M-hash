// The one animated moment: drag or play the day slider and the community braids together.
// Grey dots light up as people join, threads appear as rides happen, busy routes glow.
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Community, Corridor, Graph, Member, MemberState } from '../api/types';
import { Glyph, Icon } from '../components/ui';
import { STATE_LABEL } from '../lib/format';
import { makeProjection } from '../lib/geo';

const W = 900;
const H = 560;

const STAGE_COLOR: Record<MemberState, string> = {
  discovered: 'var(--line)',
  registered: 'var(--fog)',
  interacted: 'var(--ink)',
  first_ride: 'var(--peacock)',
  repeat: 'var(--peacock)',
  referrer: 'var(--jamun)',
};

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

export default function CommunityMap({ community, members, graph, corridors, onSelect }: {
  community: Community; members: Member[]; graph: Graph; corridors: Corridor[]; onSelect: (id: number) => void;
}) {
  const today = community.current_day;
  const [day, setDay] = useState(today);
  const [playing, setPlaying] = useState(false);
  const [asList, setAsList] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const reduce = useReducedMotion();
  const timer = useRef<number | null>(null);

  useEffect(() => setDay(today), [today]);

  // play: day 0 -> today, ~0.6 s per day (instant redraws when reduced motion is on)
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setDay((d) => {
        if (d >= today) { setPlaying(false); return today; }
        return d + 1;
      });
    }, reduce ? 250 : 600);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, today, reduce]);

  const destById = useMemo(() => new Map(community.destinations.map((d) => [d.id, d])), [community]);
  const project = useMemo(
    () => makeProjection([...members.map((m) => ({ lat: m.home.lat, lon: m.home.lon })), ...community.destinations], W, H, 36),
    [members, community],
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const visibleEdges = graph.edges.filter((e) => e.kind !== 'social' && e.since_day <= day);
  const joined = members.filter((m) => m.funnel.registered_day !== null && m.funnel.registered_day <= day);
  const rideCount = visibleEdges.filter((e) => e.kind === 'co_ride').length;
  const corridorOpacity = today ? Math.max(0.15, day / today) : 1;

  // A shared ride drawn as a thread: from one home, through the other (the pickup), on to their destination.
  // Overlapping rides along the same corridor thicken into ropes.
  function thread(aId: number, bId: number) {
    const a = memberById.get(aId), b = memberById.get(bId);
    if (!a || !b) return null;
    const [ax, ay] = project({ lat: a.home.lat, lon: a.home.lon });
    const [bx, by] = project({ lat: b.home.lat, lon: b.home.lon });
    const dest = destById.get(a.destination_id);
    if (!dest) return `M${ax.toFixed(1)},${ay.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)}`;
    const [tx, ty] = project(dest);
    // start from whichever home is further from the destination
    const far = Math.hypot(ax - tx, ay - ty) >= Math.hypot(bx - tx, by - ty);
    const [sx, sy, px, py] = far ? [ax, ay, bx, by] : [bx, by, ax, ay];
    const c1x = px + (tx - px) * 0.45, c1y = py;
    return `M${sx.toFixed(1)},${sy.toFixed(1)} L${px.toFixed(1)},${py.toFixed(1)} Q${c1x.toFixed(1)},${c1y.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
  }

  function straight(aId: number, bId: number) {
    const a = memberById.get(aId), b = memberById.get(bId);
    if (!a || !b) return null;
    const [ax, ay] = project({ lat: a.home.lat, lon: a.home.lon });
    const [bx, by] = project({ lat: b.home.lat, lon: b.home.lon });
    return `M${ax.toFixed(1)},${ay.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)}`;
  }

  const summary = `Day ${day} of ${today}: ${joined.length} of ${members.length} people joined, ${rideCount} pairs have shared a ride.`;

  return (
    <section className="panel map-panel" aria-labelledby="map-h">
      <div className="map-overlay">
        <h2 id="map-h" className="sr-only">Community map</h2>
        <span className="num" style={{ fontSize: 34, fontWeight: 600, lineHeight: 1 }}>Day {day}</span>
        <span className="small muted">{joined.length} joined, {rideCount} riding pairs</span>
      </div>

      {asList ? (
        <div className="table-scroll" style={{ padding: '72px 16px 8px' }}>
          <table className="data">
            <caption className="sr-only">Members who had joined by day {day}</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Area</th><th scope="col">Travels as</th><th scope="col">Stage on day {day}</th><th scope="col">Rides</th></tr></thead>
            <tbody>
              {joined.map((m) => (
                <tr key={m.id}>
                  <td><button className="btn-link" onClick={() => onSelect(m.id)}>{m.name}</button></td>
                  <td>{m.area}</td>
                  <td>{m.has_car ? 'Driver' : 'Rider'}{m.is_connector ? ', well connected' : ''}</td>
                  <td>{STATE_LABEL[stageOn(m, day)]}</td>
                  <td>{m.rides_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ margin: '18px 0 8px', fontSize: 16 }}>Busy routes today</h3>
          <table className="data">
            <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Around</th><th scope="col">Joined</th><th scope="col">Drivers</th><th scope="col">Riders</th></tr></thead>
            <tbody>{corridors.map((c) => <tr key={c.key}><td>{c.area}</td><td>{c.destination}</td><td>{c.window}</td><td>{c.registered} of {c.size}</td><td>{c.drivers}</td><td>{c.riders}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <svg className="map-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
            {/* busy routes as soft peacock halos */}
            {corridors.map((c) => {
              const [x, y] = project({ lat: c.lat, lon: c.lon });
              return <circle key={c.key} cx={x} cy={y} r={14 + c.size * 2.2} fill="var(--peacock)" opacity={0.1 * corridorOpacity} />;
            })}
            {/* threads */}
            {visibleEdges.map((e) => {
              const d = e.kind === 'referral' ? straight(e.source, e.target) : thread(e.source, e.target);
              if (!d) return null;
              const isRef = e.kind === 'referral';
              const fresh = e.since_day === day && day !== today && !reduce;
              return (
                <motion.path
                  key={`${e.kind}-${e.source}-${e.target}`}
                  d={d}
                  fill="none"
                  stroke={isRef ? 'var(--jamun)' : 'var(--peacock)'}
                  strokeWidth={isRef ? 1.5 : Math.min(3.5, 0.8 + e.weight * 0.5)}
                  strokeDasharray={isRef ? '4 4' : undefined}
                  strokeLinecap="round"
                  initial={fresh ? { pathLength: 0, opacity: 0 } : false}
                  animate={{ pathLength: 1, opacity: isRef ? 0.9 : 0.35 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              );
            })}
            {/* destinations */}
            {community.destinations.map((d) => {
              const [x, y] = project(d);
              return (
                <g key={d.id}>
                  <rect x={x - 9} y={y - 9} width="18" height="18" transform={`rotate(45 ${x} ${y})`} fill="var(--ink)" />
                  <text x={x} y={y + 26} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--ink)">{d.name}</text>
                </g>
              );
            })}
            {/* members: drivers squares, riders circles, connectors ringed */}
            {members.map((m) => {
              const [x, y] = project({ lat: m.home.lat, lon: m.home.lon });
              const stage = stageOn(m, day);
              const isJoined = stage !== 'discovered';
              const color = STAGE_COLOR[stage];
              const s = isJoined ? 9 : 6;
              const label = `${m.name}, ${m.has_car ? 'drives' : 'rides'}, ${STATE_LABEL[stage]}`;
              const common = {
                onMouseEnter: () => setHover({ x, y, text: label }),
                onClick: () => isJoined && onSelect(m.id),
                style: { cursor: isJoined ? 'pointer' : 'default' },
              };
              return (
                <g key={m.id} {...common}>
                  {m.is_connector && isJoined && <circle cx={x} cy={y} r={s} fill="none" stroke="var(--ink)" strokeWidth="1.5" />}
                  {m.has_car
                    ? <rect x={x - s / 2} y={y - s / 2} width={s} height={s} rx="1.5" fill={isJoined ? color : 'none'} stroke={isJoined ? 'none' : 'var(--fog)'} strokeOpacity={0.6} />
                    : <circle cx={x} cy={y} r={s / 2} fill={isJoined ? color : 'none'} stroke={isJoined ? 'none' : 'var(--fog)'} strokeOpacity={0.6} />}
                </g>
              );
            })}
          </svg>
          {hover && (
            <div className="tooltip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>{hover.text}</div>
          )}
        </div>
      )}

      <div className="slider-bar">
        <button className="icon-btn" onClick={() => { setPlaying(false); setDay((d) => Math.max(0, d - 1)); }} aria-label="Previous day">{Icon.prev}</button>
        <button className="icon-btn" onClick={() => { setPlaying(false); setDay((d) => Math.min(today, d + 1)); }} aria-label="Next day">{Icon.next}</button>
        <label htmlFor="day-slider" className="small muted">Day 0</label>
        <input
          id="day-slider" type="range" min={0} max={today} step={1} value={day}
          onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)); }}
          aria-valuetext={`Day ${day} of ${today}`}
        />
        <span className="small muted">Day {today}</span>
        <button className="btn btn-quiet" onClick={() => { if (day >= today) setDay(0); setPlaying((p) => !p); }} aria-pressed={playing}>
          {playing ? Icon.pause : Icon.play}{playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn btn-quiet" onClick={() => setAsList((v) => !v)} aria-pressed={asList}>{asList ? 'Show as map' : 'Show as list'}</button>
      </div>
      <div className="map-legend" aria-label="Map legend">
        <span><Glyph driver size={12} color="var(--fog)" /> Square: drives</span>
        <span><Glyph driver={false} size={12} color="var(--fog)" /> Circle: rides</span>
        <span><Glyph driver={false} connector size={12} color="var(--fog)" /> Ring: well connected</span>
        <span><Glyph driver={false} size={12} color="var(--fog)" /> Joined</span>
        <span><Glyph driver={false} size={12} color="var(--ink)" /> Getting started</span>
        <span><Glyph driver={false} size={12} color="var(--peacock)" /> Has ridden</span>
        <span><Glyph driver={false} size={12} color="var(--jamun)" /> Brought someone in</span>
        <span><svg width="26" height="8" aria-hidden="true"><path d="M1 4 H25" stroke="var(--peacock)" strokeWidth="3" /></svg> Rode together</span>
        <span><svg width="26" height="8" aria-hidden="true"><path d="M1 4 H25" stroke="var(--jamun)" strokeWidth="1.5" strokeDasharray="4 4" /></svg> Invited</span>
        <span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="7" fill="var(--peacock)" opacity="0.25" /></svg> Busy route</span>
        <span>Hollow dots haven’t joined yet</span>
      </div>
      {!playing && <p className="sr-only" aria-live="polite">{summary}</p>}
    </section>
  );
}
