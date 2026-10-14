import { useEffect, useMemo } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useCommunity, useMembers } from '../api/hooks';
import type { Member, MemberState } from '../api/types';
import { DemoTag, ErrorNote, Icon, Skeleton } from '../components/ui';
import { STATE_LABEL } from '../lib/format';
import { useIdentity } from '../lib/identity';

const PICKER_ORDER: MemberState[] = ['interacted', 'first_ride', 'repeat', 'referrer', 'registered'];
const DEFAULT_NAME = 'Aarav L.'; // the brief's demo persona

/** Demo-only "Viewing as" picker. Login will replace this component; screens only read useIdentity(). */
function ViewingAs() {
  const { memberId, setMemberId } = useIdentity();
  const community = useCommunity();
  const members = useMembers(undefined, true);
  const groups = useMemo(() => {
    const out = new Map<MemberState, Member[]>();
    for (const s of PICKER_ORDER) out.set(s, []);
    for (const m of members.data || []) out.get(m.state)?.push(m);
    return out;
  }, [members.data]);

  // pick a sensible default, and recover if the stored id no longer exists
  useEffect(() => {
    const list = members.data;
    if (!list?.length) return;
    const valid = list.some((m) => m.id === memberId && m.state !== 'discovered');
    if (!valid) {
      const fallback = list.find((m) => m.name === DEFAULT_NAME && m.state !== 'discovered') || list.find((m) => m.state === 'interacted') || list.find((m) => m.state !== 'discovered');
      if (fallback) setMemberId(fallback.id);
    }
  }, [members.data, memberId, setMemberId]);

  return (
    <div className="viewing">
      <label htmlFor="viewing-as">Viewing as</label>
      {members.isLoading ? <Skeleton h={44} /> : (
        <select id="viewing-as" value={memberId ?? ''} onChange={(e) => setMemberId(Number(e.target.value))}>
          {PICKER_ORDER.map((s) => (groups.get(s)?.length ? (
            <optgroup key={s} label={STATE_LABEL[s]}>
              {groups.get(s)!.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.area}{m.has_car ? ', drives' : ''})</option>)}
            </optgroup>
          ) : null))}
        </select>
      )}
      <div className="viewing-meta">
        <span><DemoTag show={!!community.data?.synthetic} /></span>
        <Link to="/dashboard" className="small muted" style={{ whiteSpace: 'nowrap' }}>Dashboard</Link>
      </div>
    </div>
  );
}

export default function MemberLayout() {
  const community = useCommunity();
  const tabs = [
    { to: '/', label: 'Today', icon: Icon.today, end: true },
    { to: '/ride', label: 'Ride', icon: Icon.ride },
    { to: '/invite', label: 'Invite', icon: Icon.invite },
    { to: '/me', label: 'Me', icon: Icon.me },
  ];
  return (
    <div className="member-shell">
      <ViewingAs />
      <main className="member-main" id="main">
        {community.error ? <ErrorNote error={community.error} onRetry={() => community.refetch()} /> : <Outlet />}
      </main>
      <nav className="tabbar" aria-label="Member app">
        <ul>
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink to={tab.to} end={tab.end}>{tab.icon}<span>{tab.label}</span></NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
