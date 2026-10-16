// The organiser's app frame: the same transit-line sidebar as the member app (each page a station), grouped into
// Community, Run it and Grow it; a top bar with the page and the community's day; bottom tabs on phones.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { useCommunity, useMembers } from '../api/hooks';
import { useTripsOverview } from '../api/organiser';
import { useRates } from '../api/trips';
import { Avatar, Logo } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { displayName } from '../lib/format';
import { rate } from '../lib/pricing';
import { useSession } from '../lib/session';
import { ThemeToggle } from '../member/Settings';
import { OrgIcon } from './orgIcons';

interface Station { to: string; label: string; icon: React.ReactNode; note?: string; badge?: number; end?: boolean }

const TITLES: Record<string, string> = {
  '/dashboard': 'Overview', '/dashboard/map': 'Live map', '/dashboard/members': 'Members', '/dashboard/rides': 'Rides & safety',
  '/dashboard/announce': 'Announcements', '/dashboard/pricing': 'Ride pricing', '/dashboard/engine': 'Activation engine',
  '/dashboard/expansion': 'Network expansion', '/dashboard/proof': 'Engine vs random', '/dashboard/settings': 'Community settings',
  '/dashboard/more': 'More',
};

/** Laptops: the sidebar folds to a rail (shared with the member app's choice on this device). */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('fr.sidebar') === 'rail'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('fr.sidebar', collapsed ? 'rail' : 'open'); } catch { /* not remembered */ } }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setCollapsed((c) => !c); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [collapsed, setCollapsed] as const;
}

export function useCopy() {
  const announce = useAnnounce();
  return async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); announce(`${what} copied.`); return true; } catch { announce(`Couldn’t copy. Select the ${what.toLowerCase()} and copy it.`); return false; }
  };
}

export function useStations() {
  const members = useMembers().data;
  const ov = useTripsOverview().data;
  const rates = useRates().data;
  const openReports = ov ? Object.values(ov.open_reports_by_category).reduce((a, b) => a + b, 0) : 0;
  const joined = members?.filter((m) => m.state !== 'discovered').length;
  const groups: { name: string; items: Station[] }[] = [
    { name: 'Community', items: [
      { to: '/dashboard', end: true, label: 'Overview', icon: OrgIcon.overview, note: 'Today at a glance' },
      { to: '/dashboard/map', label: 'Live map', icon: OrgIcon.map, note: 'Homes, routes and rides' },
      { to: '/dashboard/members', label: 'Members', icon: OrgIcon.members, note: joined !== undefined ? `${joined} joined of ${members!.length}` : 'Everyone on the roster' },
    ] },
    { name: 'Run it', items: [
      { to: '/dashboard/rides', label: 'Rides & safety', icon: OrgIcon.rides, note: openReports ? `${openReports} open report${openReports === 1 ? '' : 's'}` : 'No open reports', badge: openReports },
      { to: '/dashboard/announce', label: 'Announcements', icon: OrgIcon.announce, note: 'Message your members' },
      { to: '/dashboard/pricing', label: 'Pricing', icon: OrgIcon.pricing, note: rates ? `${rate(rates.suggested_per_km)} suggested` : 'Cost-sharing rates' },
    ] },
    { name: 'Grow it', items: [
      { to: '/dashboard/engine', label: 'Engine', icon: OrgIcon.engine, note: 'Nudges and the model' },
      { to: '/dashboard/expansion', label: 'Expansion', icon: OrgIcon.expansion, note: 'Where to grow next' },
      { to: '/dashboard/proof', label: 'Proof', icon: OrgIcon.proof, note: 'Engine vs random nudges' },
    ] },
  ];
  return { groups, settings: { to: '/dashboard/settings', label: 'Settings', icon: OrgIcon.settings, note: 'Name, join code, look' } as Station };
}

function StationLink({ s, current, collapsed }: { s: Station; current: boolean; collapsed: boolean }) {
  return (
    <NavLink to={s.to} end={s.end} className="station" data-tip={s.label} aria-label={collapsed ? s.label : undefined}>
      <span className="station-dot">
        {current && <motion.span layoutId="org-station" className="station-current" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
        <span className="station-icon">{s.icon}</span>
      </span>
      <span className="station-text"><strong>{s.label}</strong>{s.note && <span>{s.note}</span>}</span>
      {!!s.badge && <span className="side-badge">{s.badge > 9 ? '9+' : s.badge}</span>}
    </NavLink>
  );
}

export default function OrgLayout() {
  const { session, signOut } = useSession();
  const community = useCommunity().data;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const copy = useCopy();
  const [collapsed, setCollapsed] = useCollapsed();
  const mainRef = useRef<HTMLElement>(null);
  const { groups, settings } = useStations();
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [pathname]);

  const all = [...groups.flatMap((g) => g.items), settings];
  const current = all.filter((s) => (s.end ? pathname === s.to : pathname.startsWith(s.to))).sort((a, b) => b.to.length - a.to.length)[0]?.to;
  const name = displayName(community?.name ?? session?.tenant.name ?? '');
  const synthetic = community?.synthetic ?? session?.tenant.synthetic;
  const code = session?.tenant.join_code;
  const slug = pathname.split('/')[2] || 'overview';
  const tabs: Station[] = [all[0], all[1], all[2], all[3], { to: '/dashboard/more', label: 'More', icon: OrgIcon.more }];
  const tabCurrent = tabs.slice(0, 4).some((t) => t.to === current) ? current : '/dashboard/more';
  const out = () => { signOut(); navigate('/welcome'); };

  return (
    <div className={`app org${collapsed ? ' rail' : ''}`}>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      <aside className="sidebar" id="sidebar" aria-label="Sidebar">
        <div className="side-top">
          <Link to="/dashboard" className="brand" aria-label="FellaRide organiser home"><Logo size={34} /><strong>FellaRide</strong></Link>
          <button type="button" className="side-toggle" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-controls="sidebar"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-tip={collapsed ? 'Expand' : 'Collapse'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9.5 4v16" /><path d={collapsed ? 'M14 10l2 2-2 2' : 'M16 10l-2 2 2 2'} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="line-name"><span className="line-swatch" aria-hidden="true" /><span>{name}</span>{synthetic && <span className="line-tag">Demo</span>}</p>
        <nav aria-label="Organiser" className="org-nav">
          {groups.map((g) => (
            <div key={g.name} className="metro-group">
              <p className="metro-label">{g.name}</p>
              <ol className="metro">{g.items.map((s) => <li key={s.to}><StationLink s={s} current={current === s.to} collapsed={collapsed} /></li>)}</ol>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {code && (
            <button type="button" className="side-code" onClick={() => copy(code, 'Join code')} data-tip={`Join code ${code} · copy`}>
              <span className="side-code-text"><span>Join code</span><strong>{code}</strong></span>
              <span className="side-code-icon">{OrgIcon.copy}</span>
            </button>
          )}
          <ol className="metro solo"><li><StationLink s={settings} current={current === settings.to} collapsed={collapsed} /></li></ol>
          <div className="side-me">
            <Avatar name={session?.user.email.split('@')[0].replace(/[._-]/g, ' ') || 'Organiser'} />
            <span className="side-me-text"><strong>Organiser</strong><span>{session?.user.email}</span></span>
            <button type="button" className="side-out" onClick={out} aria-label="Sign out" data-tip="Sign out">{OrgIcon.out}</button>
          </div>
        </div>
      </aside>

      <header className="appbar">
        <h1 className="title-wrap">
          {TITLES[pathname] || 'Dashboard'}
          <span className="sub">{name}{synthetic && <span className="demo-dot"> · Demo data</span>}</span>
        </h1>
        {community && (
          <span className="day-pill" title={community.clock === 'manual' ? 'Simulated timeline: moves when you click Next day or Simulate.' : 'One community day per calendar day (India time).'}>
            <span className="day-dot" data-clock={community.clock} aria-hidden="true" />Day {community.current_day}
            <span className="day-clock">{community.clock === 'manual' ? 'Simulated' : 'Live'}</span>
          </span>
        )}
        <ThemeToggle />
        <button type="button" className="icon-btn org-out-phone" onClick={out} aria-label="Sign out">{OrgIcon.out}</button>
      </header>

      <main className="app-main" id="main" ref={mainRef} tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={pathname} className={`page org-page org-${slug}`}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="tabbar" aria-label="Organiser">
        <ul>
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.end} aria-current={tabCurrent === t.to ? 'page' : undefined}>
                <span className="tab-pill">
                  {tabCurrent === t.to && <motion.span layoutId="org-tab" className="tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  {t.icon}
                </span>
                <span>{t.label === 'Rides & safety' ? 'Rides' : t.label === 'Live map' ? 'Map' : t.label}</span>
                {!!t.badge && <span className="badge" style={{ right: 'calc(50% - 30px)' }}>{t.badge > 9 ? '9+' : t.badge}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
