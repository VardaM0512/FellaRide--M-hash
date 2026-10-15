// Every notification: rides near you, seat requests, approvals, boarding, driver updates, chat, ratings, broadcasts.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAlerts, useMarkAlertsRead, type Alert } from '../api/trips';
import { ErrorNote, Icon, Skeleton } from '../components/ui';
import { ago } from '../lib/format';
import { NUDGE_ACTION, alertLink } from './AppLayout';

const TONE: Record<string, string> = {
  approved: 'k-matched', boarded: 'k-matched', started: 'k-ride_started', trip_nearby: 'k-seat_wanted', seat_request: 'k-seat_wanted',
  driver_update: 'k-nudge', broadcast: 'k-nudge', rate: 'k-rate_ride', declined: 'k-no_match', cancelled: 'k-ride_cancelled',
  missed: 'k-ride_cancelled', penalty: 'k-ride_cancelled', nudge_driver: 'k-nudge', nudge_rider: 'k-matched',
  nudge_connector: 'k-rate_ride', nudge_generic: 'k-nudge',
};

export default function AlertsScreen() {
  const alerts = useAlerts();
  const markRead = useMarkAlertsRead();
  const unread = alerts.data?.unread ?? 0;
  // opening the screen reads everything (after a moment, so the unread dots are seen first)
  useEffect(() => {
    if (!unread) return;
    const t = window.setTimeout(() => markRead.mutate(null), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  if (alerts.error) return <ErrorNote error={alerts.error} onRetry={() => alerts.refetch()} />;
  if (!alerts.data) return <div className="stack"><Skeleton h={84} /><Skeleton h={84} /><Skeleton h={84} /></div>;
  if (!alerts.data.items.length) return (
    <div className="empty">
      <span className="empty-icon">{Icon.bell}</span>
      <strong style={{ color: 'var(--ink)', fontSize: 18 }}>You’re all caught up</strong>
      <p className="small">You’ll hear here when a ride passes near you, when someone wants a seat, and when your seat is approved.</p>
    </div>
  );
  return (
    <div className="list stagger">
      {alerts.data.items.map((a: Alert) => (
        <Link key={a.id} to={alertLink(a)} className={`inbox-item${a.read ? '' : ' unread'}`} style={{ textDecoration: 'none' }}>
          <span className={`inbox-icon ${TONE[a.kind] || ''}`} aria-hidden="true">{a.kind === 'rate' ? Icon.star : a.kind.includes('seat') || a.kind === 'trip_nearby' ? Icon.car : Icon.bell}</span>
          <span>
            <span className="title">{!a.read && <span className="unread-dot" aria-label="Unread" />}{a.title}</span><br />
            {a.body && <span className="small muted">{a.body}<br /></span>}
            <span className="small muted">{ago(a.created_at)}</span>
            {NUDGE_ACTION[a.kind] && <><br /><span className="btn btn-ride btn-small" style={{ marginTop: 8 }}>{NUDGE_ACTION[a.kind].label} →</span></>}
          </span>
        </Link>
      ))}
    </div>
  );
}
