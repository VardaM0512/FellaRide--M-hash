import { useState } from 'react';
import {
  useCloseDay, useClusters, useFunnel, useInterventions, useMatchRides, useMember, useMemberMap, useMemberProfiles,
  useMetrics, useModel, usePlanNudges, useSimulate, useTimeseries,
} from '../api/hooks';
import type { DailySnapshot, FeatureName, Kpis, Role } from '../api/types';
import { ErrorNote, Glyph, Sheet, Skeleton, Sparkline } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { FEATURE_LABEL, FUNNEL_LABEL, ROLE_LABEL, STATE_LABEL, pct } from '../lib/format';

// ---------- numbers as sentences ----------
type Stat = { key: keyof Kpis; sentence: (k: Kpis) => string; fmt: (v: number) => string };
const STATS: Stat[] = [
  { key: 'active_users', sentence: (k) => `${k.active_users} people rode this week`, fmt: String },
  { key: 'match_rate', sentence: (k) => `${pct(k.match_rate)} of seat requests found a match`, fmt: pct },
  { key: 'rides_completed', sentence: (k) => `${k.rides_completed} shared rides completed so far`, fmt: String },
  { key: 'repeat_rate', sentence: (k) => `${pct(k.repeat_rate)} of riders came back for another ride`, fmt: pct },
  { key: 'avg_network_connectivity', sentence: (k) => `Each active rider has shared rides with ${k.avg_network_connectivity.toFixed(1)} people`, fmt: (v) => v.toFixed(1) },
  { key: 'nudge_response_rate_7d', sentence: (k) => `${pct(k.nudge_response_rate_7d)} of suggestions got a yes this week`, fmt: pct },
  { key: 'referral_conversion', sentence: (k) => `${pct(k.referral_conversion)} of invites turned into members`, fmt: pct },
  { key: 'registered', sentence: (k) => `${k.registered} of ${k.members_total} people have joined`, fmt: String },
];

export function Numbers() {
  const metrics = useMetrics();
  const ts = useTimeseries();
  if (!metrics.data) return <section className="panel">{metrics.error ? <ErrorNote error={metrics.error} onRetry={() => metrics.refetch()} /> : <Skeleton h={260} />}</section>;
  const series = (key: keyof Kpis) => (ts.data || []).map((r: DailySnapshot) => Number(r[key]));
  return (
    <section className="panel" aria-labelledby="numbers-h">
      <h2 id="numbers-h">This week</h2>
      <div>
        {STATS.map((s) => {
          const values = series(s.key);
          const first = values[0], last = values[values.length - 1];
          const label = values.length > 1 ? `Went from ${s.fmt(first)} on day 0 to ${s.fmt(last)} on day ${values.length - 1}` : 'Not enough days yet';
          return (
            <div className="stat" key={s.key}>
              <p>{s.sentence(metrics.data)}</p>
              <Sparkline values={values} label={label} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

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

// ---------- operator panel (demo controls) ----------
export function OperatorPanel() {
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
    <section className="panel" aria-labelledby="op-h">
      <h2 id="op-h">Run the demo</h2>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const r = await plan.mutateAsync(14); return `Planned ${r.count} nudges for day ${r.day}.`; })}>Plan today’s nudges</button>
        <button className="btn btn-ride" disabled={busy} onClick={() => run(async () => { const r = await match.mutateAsync(); return r.matched ? `Matched ${r.matched} rider${r.matched === 1 ? '' : 's'} to drivers.` : 'Nothing new to match. Riders are matched automatically as soon as seats are offered.'; })}>Match rides</button>
        <>
          <button className="btn btn-quiet" disabled={busy} onClick={() => run(async () => { const k = await close.mutateAsync(); return `Closed day ${k.closed_day}. Now day ${k.current_day}; unmatched requests expired.`; })}>Next day</button>
          <button className="btn btn-quiet" disabled={busy} onClick={() => run(async () => { await simulate.mutateAsync(7); return 'Simulated 7 more days through the real engine.'; })}>{simulate.isPending ? 'Simulating…' : 'Simulate 7 days'}</button>
        </>
      </div>
      {note && <div className="note note-ok">{note}</div>}
      <ErrorNote error={error} />
    </section>
  );
}

// ---------- member profile side sheet ----------
export function MemberSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const m = useMember(id);
  return (
    <Sheet title={m.data?.name || 'Member'} onClose={onClose} side>
      {!m.data ? (m.error ? <ErrorNote error={m.error} /> : <Skeleton h={240} />) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Glyph driver={m.data.has_car} connector={m.data.is_connector} />
            <span>{m.data.has_car ? `Drives, ${m.data.seats} seats` : 'Rides'}{m.data.is_connector ? ', well connected' : ''}</span>
          </div>
          <dl className="facts">
            <dt>Stage</dt><dd>{STATE_LABEL[m.data.state]}</dd>
            <dt>Commute</dt><dd>{m.data.area} to {m.data.destination}, <span className="num">{m.data.depart_time}</span></dd>
            <dt>Route</dt><dd>{m.data.corridor.hot ? 'Busy route' : 'Quiet route'}, {m.data.corridor.registered} of {m.data.corridor.size} joined</dd>
            <dt>Shared rides</dt><dd>{m.data.rides_count} with {m.data.ride_partners} people</dd>
            <dt>Knows</dt><dd>{m.data.social_ties} people here</dd>
            <dt>Suggestions</dt><dd>{m.data.nudges_responded} yes of {m.data.nudges_received}</dd>
          </dl>
          <h3 style={{ fontSize: 16 }}>Likelihood</h3>
          <div className="weights">
            {(['driver', 'rider', 'referrer', 'connector'] as Role[]).map((r) => (
              <div className="weight" key={r} style={{ gridTemplateColumns: '130px 1fr 44px' }}>
                <span>{ROLE_LABEL[r]}</span>
                <div className="funnel-bar" aria-hidden="true"><span style={{ width: `${m.data!.scores[r] * 100}%` }} /></div>
                <span className="num small" style={{ textAlign: 'right' }}>{pct(m.data!.scores[r])}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
