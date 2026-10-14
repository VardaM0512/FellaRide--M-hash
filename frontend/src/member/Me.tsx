// The member's own journey as a path with dated stops. Reached stops are filled; the next one is
// outlined with what unlocks it.
import { useMember } from '../api/hooks';
import type { Funnel, MemberProfile } from '../api/types';
import { ErrorNote, Glyph, Icon, Skeleton } from '../components/ui';
import { STATE_LABEL } from '../lib/format';
import { useIdentity } from '../lib/identity';

const STOPS: { key: keyof Funnel; label: string; unlock: (m: MemberProfile) => string }[] = [
  { key: 'registered_day', label: 'Joined', unlock: () => 'Sign up to your community.' },
  { key: 'interacted_day', label: 'Getting started', unlock: () => 'Say yes to a suggestion, or offer or ask for a seat.' },
  { key: 'first_ride_day', label: 'First ride', unlock: (m) => (m.has_car ? 'Offer your seats and drive someone once.' : 'Ask for a seat and take one ride.') },
  { key: 'repeat_day', label: 'Riding regularly', unlock: () => 'Ride once more to reach Riding regularly.' },
  { key: 'referrer_day', label: 'Brought someone in', unlock: () => 'Invite someone from the Invite tab. It counts when they join.' },
];

export default function Me() {
  const { memberId } = useIdentity();
  const me = useMember(memberId);
  if (!me.data) return me.error ? <ErrorNote error={me.error} onRetry={() => me.refetch()} /> : <Skeleton h={300} />;
  const m = me.data;
  const nextIndex = STOPS.findIndex((s) => m.funnel[s.key] === null);
  return (
    <>
      <section style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Glyph driver={m.has_car} connector={m.is_connector} size={18} />
          <h1 style={{ fontSize: 'var(--fs-h2)' }}>{m.name}</h1>
        </div>
        <p className="muted">{m.area} to {m.destination}, leaving <span className="num">{m.depart_time}</span>. {m.has_car ? `Drives, ${m.seats} free seats.` : 'Rides with others.'}</p>
        <p className="muted">{m.rides_count === 0 ? 'No shared rides yet.' : `${m.rides_count} shared ride${m.rides_count === 1 ? '' : 's'} so far.`} Now: {STATE_LABEL[m.state]}.</p>
      </section>
      <section aria-labelledby="journey-h">
        <h2 id="journey-h" style={{ fontSize: 'var(--fs-h3)', marginBottom: 16 }}>Your journey</h2>
        <ol className="journey">
          {STOPS.map((s, i) => {
            const day = m.funnel[s.key];
            const done = day !== null;
            const next = i === nextIndex;
            return (
              <li key={s.key} className={done ? 'done' : next ? 'next' : ''}>
                <span className="stop" aria-hidden="true">{done ? Icon.check : null}</span>
                <div>
                  <p style={{ fontWeight: 700 }}>{s.label}</p>
                  <p className="small muted">
                    {done ? `Day ${day} of the community` : next ? s.unlock(m) : 'Later'}
                  </p>
                  <span className="sr-only">{done ? 'Reached.' : next ? 'Next step.' : 'Not reached yet.'}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}
