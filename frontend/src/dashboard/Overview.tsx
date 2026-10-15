// Organiser overview: today's band (the community, its day and the engine's controls), the numbers that matter
// with their weekly change, what needs attention, how people join, and what just happened.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClusters, useCommunity, useFunnel, useMetrics, useTimeseries } from '../api/hooks';
import { useOrgReferrals, useTripsOverview } from '../api/organiser';
import type { Kpis } from '../api/types';
import { CountUp, DemoTag, ErrorNote, Icon, Skeleton, Sparkline } from '../components/ui';
import { displayName, pct } from '../lib/format';
import ActivityFeed from './Activity';
import { OrgIcon } from './orgIcons';
import { DayControls, FunnelPanel, MemberSheet } from './Panels';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Hero() {
  const c = useCommunity().data;
  const k = useMetrics().data;
  const ts = useTimeseries().data || [];
  const week = ts.slice(-7);
  const peak = Math.max(1, ...week.map((d) => d.rides_completed_today));
  return (
    <section className="org-hero" aria-labelledby="hero-h">
      <div className="org-hero-main">
        <p className="band-live">
          <span className="live-dot" aria-hidden="true" />
          {c ? `Day ${c.current_day} · ${c.clock === 'manual' ? 'Simulated timeline' : 'Following the calendar'}` : 'Loading'}
          {c?.synthetic && <DemoTag show />}
        </p>
        <h2 id="hero-h">{greeting()}. <span>{c ? displayName(c.name) : ''}</span></h2>
        <div className="band-hero">
          <strong>{k ? <CountUp value={k.rides_completed} /> : '—'}<small>shared rides</small></strong>
          <p>completed in this community so far, <b>{k ? k.active_users : '—'} people</b> rode in the last 7 days.</p>
        </div>
        <div className="band-figs">
          <div className="band-fig"><strong>{k ? <CountUp value={k.registered} /> : '—'}<small>/ {k?.members_total ?? '—'}</small></strong><span>joined</span></div>
          <div className="band-fig"><strong>{k ? pct(k.match_rate) : '—'}</strong><span>requests matched</span></div>
          <div className="band-fig"><strong>{k ? pct(k.repeat_rate) : '—'}</strong><span>ride again</span></div>
        </div>
      </div>
      <div className="org-hero-side">
        <div className="hero-week" aria-label={`Rides per day, last ${week.length} days: ${week.map((d) => d.rides_completed_today).join(', ')}`} role="img">
          <p className="small">Rides per day</p>
          <ol>
            {week.map((d, i) => (
              <li key={d.day} className={i === week.length - 1 ? 'today' : ''}>
                <i style={{ height: `${Math.max(6, (d.rides_completed_today / peak) * 100)}%` }} />
                <span>{d.rides_completed_today}</span>
                <small>D{d.day}</small>
              </li>
            ))}
            {!week.length && <li className="muted small">No days closed yet</li>}
          </ol>
        </div>
        <DayControls onDark compact />
      </div>
    </section>
  );
}

type KpiDef = { key: keyof Kpis; label: string; kind: 'count' | 'pct' | 'dec' };
const KPIS: KpiDef[] = [
  { key: 'active_users', label: 'Rode this week', kind: 'count' },
  { key: 'rides_completed', label: 'Shared rides so far', kind: 'count' },
  { key: 'match_rate', label: 'Seat requests matched', kind: 'pct' },
  { key: 'repeat_rate', label: 'Riders who came back', kind: 'pct' },
  { key: 'nudge_response_rate_7d', label: 'Suggestions accepted', kind: 'pct' },
  { key: 'referral_conversion', label: 'Invites that joined', kind: 'pct' },
  { key: 'avg_network_connectivity', label: 'People each rider rode with', kind: 'dec' },
  { key: 'registered', label: 'Members joined', kind: 'count' },
];

function KpiTiles() {
  const k = useMetrics();
  const ts = useTimeseries().data || [];
  if (!k.data) return k.error ? <ErrorNote error={k.error} onRetry={() => k.refetch()} /> : <Skeleton h={220} />;
  return (
    <section aria-label="Key numbers" className="kpi-grid">
      {KPIS.map((d) => {
        const v = Number(k.data[d.key] ?? 0);
        const series = ts.map((r) => Number(r[d.key] ?? 0));
        const before = series.length > 7 ? series[series.length - 8] : series[0];
        const diff = before === undefined ? null : v - before;
        const shown = d.kind === 'pct' ? Math.round(v * 100) : v;
        const delta = diff === null || Math.abs(diff) < 1e-9 ? null
          : d.kind === 'pct' ? `${diff > 0 ? '+' : '−'}${Math.abs(Math.round(diff * 100))} pts` : `${diff > 0 ? '+' : '−'}${Math.abs(d.kind === 'dec' ? +diff.toFixed(1) : Math.round(diff))}`;
        return (
          <article key={d.key} className="kpi">
            <span className="kpi-label">{d.label}</span>
            <strong className="num"><CountUp value={shown} decimals={d.kind === 'dec' ? 1 : 0} />{d.kind === 'pct' && <small>%</small>}</strong>
            <div className="kpi-foot">
              {delta ? <span className={`delta ${diff! > 0 ? 'up' : 'down'}`}>{diff! > 0 ? '↑' : '↓'} {delta.replace(/^[+−]/, '')}<span className="sr-only"> in 7 days</span></span>
                : <span className="delta flat">No change</span>}
              <Sparkline values={series} width={84} height={26} label={series.length > 1 ? `Trend over ${series.length} days` : 'Not enough days yet'} />
            </div>
          </article>
        );
      })}
    </section>
  );
}

interface Todo { tone: 'red' | 'brass' | 'blue'; title: string; detail: string; to: string; action: string }

function Attention() {
  const ov = useTripsOverview().data;
  const funnel = useFunnel().data;
  const corridors = useClusters().data;
  const k = useMetrics().data;
  if (!ov || !funnel || !k) return <Skeleton h={180} />;
  const todo: Todo[] = [];
  const open = ov.reports.filter((r) => r.status === 'open');
  const high = open.filter((r) => r.severity === 'high').length;
  if (open.length) todo.push({ tone: high ? 'red' : 'brass', title: `${open.length} report${open.length === 1 ? '' : 's'} waiting for review`, detail: high ? `${high} marked high severity: look at these first.` : 'Mark them reviewed once you’ve handled them.', to: '/dashboard/rides', action: 'Review' });
  const joined = funnel.find((s) => s.step === 'registered')?.count ?? 0;
  const rode = funnel.find((s) => s.step === 'first_ride')?.count ?? 0;
  if (joined - rode > 0) todo.push({ tone: 'blue', title: `${joined - rode} members joined but haven’t shared a ride`, detail: 'A friendly note often gets the first ride going.', to: '/dashboard/announce?audience=new', action: 'Message them' });
  (corridors || []).filter((c) => c.riders >= Math.max(3, c.drivers * 3)).slice(0, 2).forEach((c) => todo.push({
    tone: 'brass', title: `${c.area} → ${c.destination} needs drivers`, detail: `${c.riders} riders but ${c.drivers} driver${c.drivers === 1 ? '' : 's'} around ${c.window}.`, to: '/dashboard/map', action: 'See the route',
  }));
  if (k.nudge_response_rate_7d > 0 && k.nudge_response_rate_7d < 0.2) todo.push({ tone: 'blue', title: 'Few suggestions get a yes this week', detail: `${pct(k.nudge_response_rate_7d)} accepted. See who the engine picks, and why.`, to: '/dashboard/engine', action: 'Open the engine' });
  return (
    <section className="panel" aria-labelledby="todo-h">
      <div className="section-head"><h2 id="todo-h">Needs your attention</h2>{todo.length > 0 && <span className="chip">{todo.length}</span>}</div>
      {todo.length === 0 ? (
        <p className="note note-ok">All clear. No open reports, and everyone who joined has shared a ride.</p>
      ) : (
        <ul className="todo">
          {todo.slice(0, 5).map((t) => (
            <li key={t.title} className={`todo-item tone-${t.tone}`}>
              <span className="todo-icon" aria-hidden="true">{t.tone === 'red' ? OrgIcon.alert : t.tone === 'brass' ? OrgIcon.target : OrgIcon.spark}</span>
              <span className="todo-text"><strong>{t.title}</strong><span className="small muted">{t.detail}</span></span>
              <Link to={t.to} className="btn btn-quiet btn-small">{t.action}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Routes() {
  const q = useClusters();
  const list = (q.data || []).slice(0, 5);
  const top = Math.max(1, ...list.map((c) => c.size));
  return (
    <section className="panel" aria-labelledby="routes-h">
      <div className="section-head"><h2 id="routes-h">Busiest routes</h2><Link to="/dashboard/map" className="btn-link small">Open map</Link></div>
      {!q.data ? <Skeleton h={160} /> : !list.length ? <p className="muted small">No busy routes yet. A route gets busy once 3 people have joined, with a driver and a rider.</p> : (
        <ul className="route-bars">
          {list.map((c) => (
            <li key={c.key}>
              <div className="route-name"><strong>{c.area}</strong><span aria-hidden="true">→</span><strong>{c.destination}</strong><span className="num small muted">{c.window}</span></div>
              <div className="route-bar" aria-hidden="true"><i className="joined" style={{ width: `${(c.registered / top) * 100}%` }} /><i className="rest" style={{ width: `${((c.size - c.registered) / top) * 100}%` }} /></div>
              <span className="small muted">{c.registered} of {c.size} joined · {c.drivers} drive · {c.riders} ride</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Referrals() {
  const q = useOrgReferrals();
  const r = q.data;
  return (
    <section className="panel" aria-labelledby="ref-h">
      <h2 id="ref-h">Word of mouth</h2>
      {!r ? (q.error ? <ErrorNote error={q.error} /> : <Skeleton h={120} />) : (
        <>
          <div className="mini-stats">
            <div><strong className="num">{r.joined}</strong><span>joined through a friend</span></div>
            <div><strong className="num">{pct(r.first_ride_rate)}</strong><span>of them rode</span></div>
          </div>
          {r.top.length ? (
            <ol className="leaders">
              {r.top.slice(0, 4).map((x, i) => <li key={x.user_id}><span className="num">{i + 1}</span><strong>{x.name}</strong><span className="small muted">{x.joined} joined</span></li>)}
            </ol>
          ) : <p className="small muted">No app referrals yet. Members share their link from Refer friends.</p>}
        </>
      )}
    </section>
  );
}

const SHORTCUTS = [
  { to: '/dashboard/announce', label: 'Send an announcement', icon: OrgIcon.announce },
  { to: '/dashboard/members', label: 'Find a member', icon: Icon.search },
  { to: '/dashboard/pricing', label: 'Change ride pricing', icon: OrgIcon.pricing },
  { to: '/dashboard/expansion', label: 'See where to grow', icon: OrgIcon.expansion },
];

export default function Overview() {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <>
      <Hero />
      <KpiTiles />
      <div className="ov-grid">
        <div className="ov-main">
          <Attention />
          <FunnelPanel />
          <div className="ov-pair">
            <Routes />
            <Referrals />
          </div>
        </div>
        <section className="panel ov-feed" aria-labelledby="feed-h">
          <div className="section-head"><h2 id="feed-h">Live activity</h2><span className="live-chip"><span className="live-dot" aria-hidden="true" />Live</span></div>
          <ActivityFeed onSelect={setSelected} />
        </section>
      </div>
      <nav className="shortcuts" aria-label="Shortcuts">
        {SHORTCUTS.map((s) => <Link key={s.to} to={s.to} className="shortcut"><span className="shortcut-icon">{s.icon}</span><span>{s.label}</span>{Icon.arrow}</Link>)}
      </nav>
      {selected !== null && <MemberSheet id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
