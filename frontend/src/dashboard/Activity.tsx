// The organiser's live activity feed: milestones from the engine and the member app, newest first.
import { useActivity, type ActivityItem } from '../api/organiser';
import { Icon } from '../components/ui';
import { ErrorNote, Skeleton } from '../components/ui';
import { OrgIcon } from './orgIcons';

type Tone = 'blue' | 'brass' | 'ember' | 'green' | 'red' | 'grey';

const who = (e: ActivityItem) => e.member?.name || 'Someone';

/** One sentence, an icon and a colour per event type. */
const SAY: Record<string, (e: ActivityItem) => { text: string; icon: React.ReactNode; tone: Tone }> = {
  member_registered: (e) => ({ text: `${who(e)} joined${e.detail.via === 'invite' || e.detail.via === 'link' ? ' through a friend' : ''}`, icon: Icon.invite, tone: 'grey' }),
  first_ride: (e) => ({ text: `${who(e)} took their first shared ride`, icon: Icon.ride, tone: 'blue' }),
  repeat_ride: (e) => ({ text: `${who(e)} now rides regularly`, icon: Icon.flame, tone: 'blue' }),
  first_referral_converted: (e) => ({ text: `${who(e)} brought their first friend in`, icon: Icon.people, tone: 'brass' }),
  referral_joined: (e) => ({ text: `A friend of ${who(e)} joined`, icon: Icon.people, tone: 'brass' }),
  ride_completed: (e) => ({ text: `${who(e)} finished a shared ride`, icon: Icon.check, tone: 'green' }),
  ride_cancelled: (e) => ({ text: `${who(e)} cancelled a ride`, icon: Icon.x, tone: 'red' }),
  trip_posted: (e) => ({ text: `${who(e)} offered a ride`, icon: Icon.car, tone: 'ember' }),
  trip_unfilled: (e) => ({ text: `${who(e)}’s ride left with empty seats`, icon: Icon.seat, tone: 'grey' }),
  ride_rated: (e) => ({ text: `${who(e)} rated a ride${e.detail.rating ? ` ${e.detail.rating}★` : ''}`, icon: Icon.star, tone: 'brass' }),
  nudge_responded: (e) => ({ text: `${who(e)} said yes to a suggestion`, icon: OrgIcon.spark, tone: 'blue' }),
  expansion_action: (e) => ({ text: `Expansion engine acted${e.detail.area ? ` in ${e.detail.area}` : ''}`, icon: OrgIcon.expansion, tone: 'brass' }),
  corridor_proposed: (e) => ({ text: `A new route was proposed${e.detail.area ? ` from ${e.detail.area}` : ''}`, icon: OrgIcon.map, tone: 'brass' }),
};

export default function ActivityFeed({ limit = 60, onSelect }: { limit?: number; onSelect?: (memberId: number) => void }) {
  const q = useActivity();
  if (!q.data) return q.error ? <ErrorNote error={q.error} onRetry={() => q.refetch()} /> : <Skeleton h={320} />;
  const items = q.data.slice(0, limit);
  if (!items.length) return <p className="muted">Nothing yet. Sign-ups, rides and referrals show up here as they happen.</p>;
  let lastDay: number | null = null;
  return (
    <ol className="feed" aria-live="polite" aria-relevant="additions">
      {items.map((e) => {
        const s = (SAY[e.type] ?? ((x: ActivityItem) => ({ text: `${who(x)}: ${x.type.replace(/_/g, ' ')}`, icon: OrgIcon.spark, tone: 'grey' as Tone })))(e);
        const head = e.day !== lastDay ? <li className="feed-day" key={`d${e.day}-${e.id}`}>Day {e.day}</li> : null;
        lastDay = e.day;
        const body = (
          <>
            <span className={`feed-icon tone-${s.tone}`} aria-hidden="true">{s.icon}</span>
            <span className="feed-text">{s.text}</span>
            {e.source === 'app' && <span className="chip feed-src">App</span>}
          </>
        );
        return [head,
          <li key={e.id} className="feed-item">
            {onSelect && e.member ? <button type="button" className="feed-row" onClick={() => onSelect(e.member!.id)}>{body}</button> : <div className="feed-row">{body}</div>}
          </li>];
      })}
    </ol>
  );
}
