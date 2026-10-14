// Organiser view of the member app: rides, ratings, reports (by category) and a broadcast notification.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { request } from '../api/client';
import { useMetrics } from '../api/hooks';
import type { TripsOverview } from '../api/trips';
import { ErrorNote, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { useMe } from '../lib/session';

const CATEGORY: Record<string, string> = { safety: 'Safety', fraud: 'Money or identity', reliability: 'Reliability', conduct: 'Behaviour', other: 'Other' };
const SEVERITY_CLASS = { high: 'note-error', medium: 'note-info', low: '' } as const;

function Broadcast() {
  const { tenantId } = useMe();
  const announce = useAnnounce();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => request<{ sent: number }>(`/tenants/${tenantId}/broadcast`, { method: 'POST', body: { title, body } }),
    onSuccess: (r) => { announce(`Sent to ${r.sent} members.`); setTitle(''); setBody(''); },
  });
  function submit(e: FormEvent) { e.preventDefault(); if (title.trim()) send.mutate(); }
  return (
    <form className="stack" onSubmit={submit}>
      <h3 style={{ fontSize: 16 }}>Send a notification to every member</h3>
      <label className="field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Main gate closed on Friday" /></label>
      <label className="field">Message (optional)<textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={400} /></label>
      <ErrorNote error={send.error} />
      {send.isSuccess && <p className="note note-ok">Sent to {send.data.sent} members.</p>}
      <button className="btn btn-primary" disabled={!title.trim() || send.isPending}>{send.isPending ? 'Sending…' : 'Send notification'}</button>
    </form>
  );
}

export default function MemberAppPanel() {
  const { tenantId } = useMe();
  const qc = useQueryClient();
  const ov = useQuery({ queryKey: ['trips-overview', tenantId], queryFn: () => request<TripsOverview>(`/tenants/${tenantId}/trips-overview`), refetchInterval: 15_000 });
  const review = useMutation({
    mutationFn: (id: number) => request(`/tenants/${tenantId}/reports/${id}/review`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips-overview'] }),
  });
  const d = ov.data;
  const t = d?.trips || {};
  const src = useMetrics().data?.by_source;
  return (
    <section className="panel" aria-labelledby="mapp-h">
      <h2 id="mapp-h">Member app: rides and reports</h2>
      {!d ? (ov.error ? <ErrorNote error={ov.error} onRetry={() => ov.refetch()} /> : <Skeleton h={160} />) : (
        <div className="dash-row" style={{ gap: 20 }}>
          <div className="stack">
            <p>{(t.open || 0) + (t.started || 0)} rides live now · {t.completed || 0} completed · {t.cancelled || 0} cancelled</p>
            <p>{d.riders_carried} {d.riders_carried === 1 ? 'rider' : 'riders'} carried · average rating {d.avg_rating ?? 'none yet'}</p>
            <p>{d.penalties} automatic penalties (left early or cancelled after approving)</p>
            {src && (
              <p className="note note-info">
                In the engine’s numbers: {src.app.rides_completed} of {src.app.rides_completed + src.engine.rides_completed} completed rides
                and {src.app.seat_requests} of {src.app.seat_requests + src.engine.seat_requests} seat requests came from the app.
                Every app ride moves the funnel, graph and model.
              </p>
            )}
            <div className="reasons">
              {Object.keys(CATEGORY).map((c) => <span key={c} className="chip">{CATEGORY[c]}: {d.open_reports_by_category[c] || 0} open</span>)}
            </div>
          </div>
          <div className="stack" style={{ gridColumn: 'span 1' }}>
            <h3 style={{ fontSize: 16 }}>Latest reports</h3>
            {d.reports.length === 0 && <p className="small muted">No reports yet.</p>}
            <ul className="list-plain" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {d.reports.map((r) => (
                <li key={r.id}>
                  <p><span className={`note ${SEVERITY_CLASS[r.severity]}`} style={{ padding: '2px 8px' }}>{CATEGORY[r.category]}</span>{' '}
                    <strong>{r.reported.name}</strong> <span className="small muted">reported by {r.reporter.name} · ride {r.trip_id}</span></p>
                  <p className="small">{r.reasons.join(' · ')}{r.note ? ` — “${r.note}”` : ''}</p>
                  {r.status === 'open'
                    ? <button className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }} disabled={review.isPending} onClick={() => review.mutate(r.id)}>Mark reviewed</button>
                    : <span className="small muted">Reviewed</span>}
                </li>
              ))}
            </ul>
          </div>
          <Broadcast />
        </div>
      )}
    </section>
  );
}
