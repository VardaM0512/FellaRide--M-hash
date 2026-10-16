import { useState } from 'react';
import {
  useCloseDay, useClusters, useFunnel, useInterventions, useMatchRides, useMember, useMemberMap, useMemberProfiles,
  useModel, usePlanNudges, useRecommendations, useSimulate,
} from '../api/hooks';
import type { Community, FeatureName, MemberProfile, Role } from '../api/types';
import { Avatar, ErrorNote, Glyph, Sheet, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { FEATURE_LABEL, FUNNEL_LABEL, ROLE_LABEL, STATE_LABEL, pct } from '../lib/format';

// ---------- funnel ----------
export function FunnelPanel() {
  const funnel = useFunnel();
  if (!funnel.data) return <section className="panel">{funnel.error ? <ErrorNote error={funnel.error} /> : <Skeleton h={200} />}</section>;
  const max = Math.max(...funnel.data.map((s) => s.count), 1);
  const reg = funnel.data.find((s) => s.step === 'registered')?.count ?? 0;
  const ridden = funnel.data.find((s) => s.step === 'first_ride')?.count ?? 0;
  return (
    <section className="panel" aria-labelledby="funnel-h">
      <h2 id="funnel-h">How people join</h2>
      <p className="small muted">{ridden} of the {reg} people who joined have taken a shared ride.</p>
      <div className="funnel">
        {funnel.data.map((s, i) => (
          <div key={s.step}>
            {i > 0 && s.conversion_from_previous !== null && (
              <p className="funnel-conv">{pct(s.conversion_from_previous)} moved on</p>
            )}
            <div className={`funnel-step${i === 0 ? ' first' : ''}`}>
              <span>{FUNNEL_LABEL[s.step] || s.step}</span>
              <div className="funnel-bar" aria-hidden="true"><span style={{ width: `${(s.count / max) * 100}%` }} /></div>
              <span className="num" style={{ textAlign: 'right' }}>{s.count}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- today's nudges, and why ----------
export function NudgesPanel({ day }: { day: number }) {
  const ivs = useInterventions(day);
  const list = (ivs.data || []).filter((i) => i.strategy === 'smart').slice(0, 14);
  const profiles = useMemberProfiles(list.map((i) => i.member_id));
  const { map } = useMemberMap();
  const byId = new Map(profiles.map((p) => [p.data?.id, p.data]));
  return (
    <section className="panel" aria-labelledby="nudges-h">
      <h2 id="nudges-h">Today’s nudges, and why</h2>
      {ivs.isLoading ? <Skeleton h={160} /> : ivs.error ? <ErrorNote error={ivs.error} />
        : list.length === 0 ? <p className="muted">No nudges planned for day {day} yet. Use Plan today’s nudges to run the engine.</p>
          : (
            <ul className="list-plain" style={{ maxHeight: 560, overflowY: 'auto' }} tabIndex={0} aria-label="Planned nudges">
              {list.map((iv) => {
                const p = byId.get(iv.member_id);
                const who = map.get(iv.member_id)?.name || `Member ${iv.member_id}`;
                const role: Role = iv.kind === 'driver' ? 'driver' : iv.kind === 'connector' ? 'connector' : 'rider';
                const reasons: string[] = [];
                if (p) {
                  reasons.push(`${pct(p.scores[role])} likely to say yes`);
                  if (p.corridor.hot) reasons.push(`busy route from ${p.corridor.area}`);
                  else if (p.corridor.registered > 1) reasons.push(`${p.corridor.registered} joined on their route`);
                  if (p.features.past_response > 0.5) reasons.push('said yes before');
                }
                if (iv.suggested_member_id) reasons.push(`named driver: ${map.get(iv.suggested_member_id)?.name || 'available'}`);
                if (iv.kind === 'connector') reasons.push('well connected, asked to invite neighbours');
                const status = iv.status === 'responded' ? 'Said yes' : iv.status === 'ignored' ? 'Not today' : 'Waiting';
                return (
                  <li key={iv.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{who}</strong>
                      <span className={`chip${iv.status === 'responded' ? ' note-ok' : ''}`}>{status}</span>
                    </div>
                    <p className="small">{iv.message}</p>
                    <div className="reasons">{reasons.map((r) => <span key={r} className="chip">{r}</span>)}</div>
                  </li>
                );
              })}
            </ul>
          )}
    </section>
  );
}

// ---------- busiest corridors ----------
export function CorridorsPanel() {
  const clusters = useClusters();
  return (
    <section className="panel" aria-labelledby="corr-h">
      <h2 id="corr-h">Busiest commute routes</h2>
      {clusters.isLoading ? <Skeleton h={160} /> : clusters.error ? <ErrorNote error={clusters.error} />
        : (clusters.data || []).length === 0 ? <p className="muted">No busy routes yet. A route gets busy once 3 people have joined, with at least one driver and one rider.</p>
          : (
            <ul className="list-plain">
              {(clusters.data || []).slice(0, 8).map((c) => (
                <li key={c.key}>
                  <strong>{c.area} to {c.destination}, around <span className="num">{c.window}</span></strong>
                  <span className="small muted">{c.registered} of {c.size} joined: {c.drivers} driving, {c.riders} riding</span>
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}

// ---------- what predicts a yes ----------
const ROLES: Role[] = ['rider', 'driver', 'referrer', 'connector'];
export function ModelPanel() {
  const model = useModel();
  const [role, setRole] = useState<Role>('rider');
  if (!model.data) return <section className="panel">{model.error ? <ErrorNote error={model.error} /> : <Skeleton h={200} />}</section>;
  const w = model.data[role];
  const entries = (Object.keys(FEATURE_LABEL) as Exclude<FeatureName, 'bias'>[]).map((f) => [f, w.weights[f]] as const).sort((a, b) => b[1] - a[1]);
  const maxAbs = Math.max(...entries.map(([, v]) => Math.abs(v)), 0.01);
  const top = entries[0];
  return (
    <section className="panel" aria-labelledby="model-h">
      <h2 id="model-h">What predicts a yes</h2>
      <div className="segmented" role="group" aria-label="Which behaviour">
        {ROLES.map((r) => <button key={r} aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>)}
      </div>
      <p className="small muted">
        {w.updates ? `Learned from ${w.updates} outcomes in this community.` : 'Using the trained starting point; no outcomes learned here yet.'} Strongest signal: {FEATURE_LABEL[top[0]].toLowerCase()}.
      </p>
      <div className="weights">
        {entries.map(([f, v]) => {
          const width = (Math.abs(v) / maxAbs) * 50;
          return (
            <div className="weight" key={f}>
              <span>{FEATURE_LABEL[f]}</span>
              <div className="weight-track" aria-hidden="true">
                <span className={`weight-bar ${v >= 0 ? 'pos' : 'neg'}`} style={v >= 0 ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }} />
              </div>
              <span className="num small" style={{ textAlign: 'right' }}>{v >= 0 ? '+' : '−'}{Math.abs(v).toFixed(2)}</span>
            </div>
          );
        })}
      </div>
      <p className="small muted">Bars to the right make a yes more likely; to the left, less likely.</p>
    </section>
  );
}

// ---------- the community's clock ----------
type Clock = Community['clock'];

/** Says how the day moves, so a simulated timeline that only moves on Next day / Simulate doesn't look frozen. */
export function ClockTag({ clock }: { clock: Clock }) {
  if (!clock) return null;
  return clock === 'manual'
    ? <span className="chip" title="This community's day moves only when you click Next day or Simulate, not with the calendar.">Simulated timeline · moves on Next day / Simulate</span>
    : <span className="chip" title="One community day per calendar day (India time).">Follows the calendar</span>;
}

// ---------- day controls (plan, match, next day, simulate) ----------
/** The engine's daily loop as buttons. `onDark` styles them for the overview's dark band. */
export function DayControls({ onDark = false, compact = false }: { onDark?: boolean; compact?: boolean }) {
  const plan = usePlanNudges();
  const match = useMatchRides();
  const close = useCloseDay();
  const simulate = useSimulate();
  const announce = useAnnounce();
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<string>) => {
    try { const text = await fn(); setNote(text); announce(text); } catch (e) { const t = e instanceof Error ? e.message : 'Failed'; setNote(null); announce(t); }
  };
  const busy = plan.isPending || match.isPending || close.isPending || simulate.isPending;
  const error = plan.error || match.error || close.error || simulate.error;
  return (
    <div className={`day-controls${onDark ? ' on-dark' : ''}${compact ? ' compact' : ''}`}>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const r = await plan.mutateAsync(14); return `Planned ${r.count} nudges for day ${r.day}.`; })}>{plan.isPending ? 'Planning…' : 'Plan today’s nudges'}</button>
        <button className="btn btn-quiet" disabled={busy} onClick={() => run(async () => { const r = await match.mutateAsync(); return r.matched ? `Matched ${r.matched} rider${r.matched === 1 ? '' : 's'} to drivers.` : 'Nothing new to match. Riders are matched automatically as soon as seats are offered.'; })}>{match.isPending ? 'Matching…' : 'Match rides'}</button>
        <button className="btn btn-quiet" disabled={busy} onClick={() => run(async () => { const k = await close.mutateAsync(); return `Closed day ${k.closed_day}. Now day ${k.current_day}; unmatched requests expired.`; })}>{close.isPending ? 'Closing…' : 'Next day'}</button>
        <button className="btn btn-quiet" disabled={busy} onClick={() => run(async () => { await simulate.mutateAsync(7); return 'Simulated 7 more days through the real engine.'; })}>{simulate.isPending ? 'Simulating…' : 'Simulate 7 days'}</button>
      </div>
      {note && <p className="note note-ok" role="status">{note}</p>}
      <ErrorNote error={error} />
    </div>
  );
}

export function OperatorPanel({ clock }: { clock?: Clock }) {
  return (
    <section className="panel" aria-labelledby="op-h">
      <div className="section-head"><h2 id="op-h">Run the day</h2>{clock && <ClockTag clock={clock} />}</div>
      {clock === 'manual' && <p className="small muted">This timeline is simulated: nothing moves on its own. Next day closes the current day; Simulate replays more days through the engine.</p>}
      {clock === 'calendar' && <p className="small muted">The day moves with the calendar on its own. Next day closes today early and moves ahead of the calendar, which then waits until the date catches up.</p>}
      <ol className="loop-steps">
        <li><strong>Plan</strong><span>The engine picks who to nudge today and why.</span></li>
        <li><strong>Match</strong><span>Riders asking for seats are paired with drivers on their route.</span></li>
        <li><strong>Next day</strong><span>Unmatched requests expire; the day’s numbers are saved.</span></li>
      </ol>
      <DayControls />
    </section>
  );
}

// ---------- member profile side sheet ----------
const JOURNEY: { key: keyof MemberProfile['funnel']; label: string }[] = [
  { key: 'registered_day', label: 'Joined' },
  { key: 'interacted_day', label: 'Got started' },
  { key: 'first_ride_day', label: 'First shared ride' },
  { key: 'repeat_day', label: 'Rides regularly' },
  { key: 'referrer_day', label: 'Brought someone in' },
];

export function MemberSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const m = useMember(id);
  const recs = useRecommendations(m.data && m.data.state !== 'discovered' ? id : null);
  const d = m.data;
  return (
    <Sheet title={d?.name || 'Member'} onClose={onClose} side>
      {!d ? (m.error ? <ErrorNote error={m.error} /> : <Skeleton h={240} />) : (
        <>
          <div className="ms-head">
            <Avatar name={d.name} driver={d.has_car} />
            <div>
              <span className={`stage-pill st-${d.state}`}>{STATE_LABEL[d.state]}</span>
              <p className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <Glyph driver={d.has_car} connector={d.is_connector} size={11} />
                {d.has_car ? `Drives, ${d.seats} seats` : 'Rides'}{d.is_connector ? ' · well connected' : ''}{d.rating?.average ? ` · ★ ${d.rating.average.toFixed(1)}` : ''}
              </p>
            </div>
          </div>
          <ol className="journey" aria-label="Their journey">
            {JOURNEY.map((j) => {
              const day = d.funnel[j.key];
              return <li key={j.key} className={day !== null ? 'done' : ''}><i aria-hidden="true" /><span>{j.label}</span><span className="num small">{day !== null ? `Day ${day}` : 'Not yet'}</span></li>;
            })}
          </ol>
          <dl className="facts">
            <dt>Commute</dt><dd>{d.area} to {d.destination}, <span className="num">{d.depart_time}</span></dd>
            <dt>Route</dt><dd>{d.corridor.hot ? 'Busy route' : 'Quiet route'}, {d.corridor.registered} of {d.corridor.size} joined</dd>
            <dt>Shared rides</dt><dd>{d.rides_count} with {d.ride_partners} {d.ride_partners === 1 ? 'person' : 'people'}</dd>
            <dt>Knows</dt><dd>{d.social_ties} people here</dd>
            <dt>Suggestions</dt><dd>{d.nudges_responded} yes of {d.nudges_received}</dd>
          </dl>
          <h3 style={{ fontSize: 16 }}>How likely they are to…</h3>
          <div className="weights">
            {(['driver', 'rider', 'referrer', 'connector'] as Role[]).map((r) => (
              <div className="weight" key={r} style={{ gridTemplateColumns: '130px 1fr 44px' }}>
                <span>{ROLE_LABEL[r]}</span>
                <div className="funnel-bar" aria-hidden="true"><span style={{ width: `${d.scores[r] * 100}%` }} /></div>
                <span className="num small" style={{ textAlign: 'right' }}>{pct(d.scores[r])}</span>
              </div>
            ))}
          </div>
          {recs.data && recs.data.partners.length > 0 && (
            <>
              <h3 style={{ fontSize: 16 }}>Best {recs.data.looking_for === 'drivers' ? 'drivers' : 'riders'} for them</h3>
              <ul className="partners">
                {recs.data.partners.slice(0, 3).map((p) => (
                  <li key={p.member.id}>
                    <Avatar name={p.member.name} driver={p.member.has_car} />
                    <span><strong>{p.member.name}</strong><span className="small muted">{p.member.area} · {Math.round(p.match.route_overlap * 100)}% same route · {p.match.time_gap_min} min apart</span></span>
                    <span className="num match-score">{Math.round(p.match.score * 100)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
