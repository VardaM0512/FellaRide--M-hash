// Rides & safety: what's happening in the member app (rides, ratings, penalties) and the reports queue.
import { useState } from 'react';
import { useMetrics } from '../api/hooks';
import { useReviewReport, useTripsOverview } from '../api/organiser';
import { Avatar, CountUp, ErrorNote, Skeleton } from '../components/ui';
import { ago } from '../lib/format';

const CATEGORY: Record<string, string> = { safety: 'Safety', fraud: 'Money or identity', reliability: 'Reliability', conduct: 'Behaviour', other: 'Other' };
const SEVERITY: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export default function RidesSafety() {
  const ov = useTripsOverview();
  const review = useReviewReport();
  const src = useMetrics().data?.by_source;
  const [status, setStatus] = useState<'open' | 'reviewed' | 'all'>('open');
  const [cat, setCat] = useState<string | null>(null);
  const d = ov.data;
  if (!d) return ov.error ? <ErrorNote error={ov.error} onRetry={() => ov.refetch()} /> : <Skeleton h={420} />;
  const t = d.trips;
  const live = (t.open || 0) + (t.started || 0);
  const tiles = [
    { label: 'Rides live now', value: live, tone: 'blue' },
    { label: 'Completed', value: t.completed || 0, tone: 'green' },
    { label: 'Cancelled or expired', value: (t.cancelled || 0) + (t.expired || 0), tone: 'grey' },
    { label: 'Riders carried', value: d.riders_carried, tone: 'blue' },
    { label: 'Average rating', value: d.avg_rating ?? 0, dec: 1, none: d.avg_rating === null, tone: 'brass' },
    { label: 'Automatic penalties', value: d.penalties, tone: d.penalties ? 'red' : 'grey' },
  ];
  const reports = d.reports.filter((r) => (status === 'all' || r.status === status) && (!cat || r.category === cat));
  const openCount = d.reports.filter((r) => r.status === 'open').length;

  return (
    <>
      <section className="tile-row" aria-label="Rides in the member app">
        {tiles.map((x) => (
          <article key={x.label} className={`kpi tone-${x.tone}`}>
            <span className="kpi-label">{x.label}</span>
            <strong className="num">{x.none ? '—' : <CountUp value={x.value} decimals={x.dec ?? 0} />}{x.label === 'Average rating' && !x.none && <small>★</small>}</strong>
          </article>
        ))}
      </section>

      <div className="rs-grid">
        <section className="panel" aria-labelledby="rep-h">
          <div className="section-head"><h2 id="rep-h">Reports</h2>
            <div className="segmented" role="group" aria-label="Which reports">
              {(['open', 'reviewed', 'all'] as const).map((s) => <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'open' ? `Open (${openCount})` : s === 'reviewed' ? 'Reviewed' : 'All'}</button>)}
            </div>
          </div>
          <div className="reasons" role="group" aria-label="Category">
            {Object.keys(CATEGORY).map((c) => (
              <button key={c} className="chip chip-toggle" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                {CATEGORY[c]} · {d.open_reports_by_category[c] || 0} open
              </button>
            ))}
          </div>
          {reports.length === 0 ? (
            <p className={status === 'open' && !cat ? 'note note-ok' : 'muted'}>{status === 'open' && !cat ? 'No open reports. Nothing needs you right now.' : 'No reports match.'}</p>
          ) : (
            <ul className="reports">
              {reports.map((r) => (
                <li key={r.id} className={`report sev-${r.severity}${r.status === 'reviewed' ? ' done' : ''}`}>
                  <div className="report-top">
                    <span className={`sev-tag sev-${r.severity}`}>{SEVERITY[r.severity]}</span>
                    <span className="chip">{CATEGORY[r.category] || r.category}</span>
                    <span className="small muted">ride {r.trip_id} · {ago(r.created_at)}</span>
                  </div>
                  <div className="report-who">
                    <Avatar name={r.reported.name} />
                    <span><strong>{r.reported.name}</strong><span className="small muted">reported by {r.reporter.name}</span></span>
                  </div>
                  <p className="small">{r.reasons.join(' · ')}{r.note ? ` — “${r.note}”` : ''}</p>
                  {r.status === 'open'
                    ? <button className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }} disabled={review.isPending} onClick={() => review.mutate(r.id)}>Mark reviewed</button>
                    : <span className="small muted">Reviewed</span>}
                </li>
              ))}
            </ul>
          )}
          <ErrorNote error={review.error} />
        </section>

        <div className="stack-lg">
          <section className="panel" aria-labelledby="src-h">
            <h2 id="src-h">Where rides come from</h2>
            {src ? (
              <>
                <div className="split-bar" role="img" aria-label={`${src.app.rides_completed} completed rides from the app, ${src.engine.rides_completed} from the engine`}>
                  <i className="app" style={{ flex: Math.max(src.app.rides_completed, 0.0001) }} /><i className="engine" style={{ flex: Math.max(src.engine.rides_completed, 0.0001) }} />
                </div>
                <dl className="facts">
                  <dt><span className="dot app" />Member app</dt><dd>{src.app.rides_completed} completed · {src.app.seat_requests} seat requests</dd>
                  <dt><span className="dot engine" />Engine</dt><dd>{src.engine.rides_completed} completed · {src.engine.seat_requests} seat requests</dd>
                </dl>
                <p className="small muted">Every ride, from either side, moves the funnel, the map and the model.</p>
              </>
            ) : <Skeleton h={120} />}
          </section>
          <section className="panel" aria-labelledby="rules-h">
            <h2 id="rules-h">How safety works</h2>
            <ul className="rules">
              <li><strong>Boarding codes.</strong> Riders show the driver a 4-digit code before getting in.</li>
              <li><strong>Automatic penalties.</strong> A driver who sets off early and leaves an approved rider behind gets 1 star; cancelling after approving riders gets 2.</li>
              <li><strong>Reports.</strong> Riders and drivers pick reasons. Safety reports are high severity, money and reliability medium, the rest low.</li>
              <li><strong>Live tracking.</strong> Approved riders and the driver see each other on the map from 30 minutes before departure.</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
