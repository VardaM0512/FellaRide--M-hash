// The phone app frame: top bar, scrolling content, bottom tabs (Home, Alerts, You).
// New alerts drop in as a banner, vibrate, and show as a phone notification when the app is in the background.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { shareLocation, useAlerts, type Alert } from '../api/trips';
import { Avatar, Icon, Logo } from '../components/ui';
import { ratingText } from '../lib/tripFormat';
import { useAnnounce } from '../lib/announce';
import { showSystemNotification } from '../lib/notify';
import { useSession } from '../lib/session';
import { ThemeToggle } from './Settings';

const TITLES: Record<string, string> = {
  '/': 'FellaRide', '/offer': 'Offer a ride', '/find': 'Find a ride', '/alerts': 'Alerts', '/me': 'You', '/invite': 'Invite',
  '/community': 'Community', '/settings': 'Settings',
};

/** Suggestions from the community's engine ("nudges") take you straight to the action they suggest. */
export const NUDGE_ACTION: Record<string, { to: string; label: string }> = {
  nudge_driver: { to: '/offer', label: 'Offer a ride' },
  nudge_rider: { to: '/find', label: 'Find a ride' },
  nudge_connector: { to: '/invite', label: 'Invite people' },
  nudge_generic: { to: '/', label: 'Plan a ride' },
  community: { to: '/community', label: 'Open the board' },
};

export const alertLink = (a: Alert) => (a.trip_id ? `/trip/${a.trip_id}` : NUDGE_ACTION[a.kind]?.to ?? '/alerts');

function useAlertBanner() {
  const alerts = useAlerts();
  const announce = useAnnounce();
  const seen = useRef<number | null>(null);
  const [banner, setBanner] = useState<Alert | null>(null);
  useEffect(() => {
    const items = alerts.data?.items;
    if (!items) return;
    const newest = Math.max(0, ...items.map((a) => a.id));
    if (seen.current === null) { seen.current = newest; return; }   // first load: don't replay history
    const fresh = items.filter((a) => a.id > (seen.current as number) && !a.read);
    seen.current = Math.max(seen.current, newest);
    if (!fresh.length) return;
    const top = fresh[0];
    setBanner(top);
    announce(`${top.title}. ${top.body}`);
    navigator.vibrate?.(120);
    if (document.hidden) showSystemNotification(top.title, top.body, alertLink(top), `fellaride-${top.id}`);
  }, [alerts.data, announce]);
  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 7000);
    return () => window.clearTimeout(t);
  }, [banner]);
  return { banner, dismiss: () => setBanner(null), unread: alerts.data?.unread ?? 0 };
}

/** If location is already allowed, keep "rides near you" alerts accurate without asking again. */
function useQuietLocation() {
  useEffect(() => {
    if (!navigator.permissions || !navigator.geolocation) return;
    navigator.permissions.query({ name: 'geolocation' }).then((p) => {
      if (p.state !== 'granted') return;
      navigator.geolocation.getCurrentPosition((pos) => shareLocation(+pos.coords.latitude.toFixed(5), +pos.coords.longitude.toFixed(5)).catch(() => {}));
    }).catch(() => {});
  }, []);
}

// Tabs sit side by side; moving between them slides sideways. Everything else (a ride, a form) rises from below.
const TAB_ORDER = ['/', '/community', '/alerts', '/me'];

export default function AppLayout() {
  const { session } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const { banner, dismiss, unread } = useAlertBanner();
  useQuietLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const prevTab = useRef(TAB_ORDER.indexOf(pathname));
  const tabIndex = TAB_ORDER.indexOf(pathname);
  const dir = tabIndex >= 0 && prevTab.current >= 0 ? Math.sign(tabIndex - prevTab.current) : 0;
  useEffect(() => { prevTab.current = tabIndex; }, [tabIndex]);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); setScrolled(false); }, [pathname]);

  const tabs = [
    { to: '/', label: 'Home', icon: Icon.today, end: true },
    { to: '/community', label: 'Community', icon: Icon.people },
    { to: '/alerts', label: 'Alerts', icon: Icon.bell, badge: unread },
    { to: '/me', label: 'You', icon: Icon.me },
  ];
  const activeTab = tabs.find((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)))?.to;
  const title = pathname.startsWith('/trip/') ? 'Your ride' : TITLES[pathname] || 'FellaRide';
  const slug = pathname === '/' ? 'home' : pathname.split('/')[1];
  const me = session?.profile;
  return (
    <div className="app">
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      {/* laptops and large tablets: a sidebar replaces the bottom tabs (CSS decides which one shows) */}
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="FellaRide home"><Logo /><strong>FellaRide</strong></Link>
        <p className="side-community small">{session?.tenant.name}{session?.tenant.synthetic && <span className="demo-dot"> · Demo</span>}</p>
        <nav aria-label="Main">
          <ul className="side-nav">
            {tabs.map((tab) => (
              <li key={tab.to}>
                <NavLink to={tab.to} end={tab.end}>
                  {activeTab === tab.to && <motion.span layoutId="side-indicator" className="side-indicator" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  <span className="side-icon">{tab.icon}</span><span>{tab.label}</span>
                  {!!tab.badge && <span className="side-badge">{tab.badge > 9 ? '9+' : tab.badge}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="side-actions">
          <Link to="/offer" className="btn btn-drive btn-block">{Icon.car} Offer a ride</Link>
          <Link to="/find" className="btn btn-quiet btn-block">{Icon.search} Find a ride</Link>
        </div>
        {me && (
          <Link to="/me" className="side-me">
            <Avatar name={me.name} />
            <span><strong>{me.name}</strong><br /><span className="small muted">{ratingText(me.rating)}</span></span>
          </Link>
        )}
      </aside>
      <header className={`appbar${scrolled ? ' scrolled' : ''}`}>
        <AnimatePresence initial={false}>
          {tabIndex < 0 && (
            <motion.button key="back" className="icon-btn" onClick={() => navigate(-1)} aria-label="Back"
              initial={{ opacity: 0, x: -8, width: 0 }} animate={{ opacity: 1, x: 0, width: 44 }} exit={{ opacity: 0, x: -8, width: 0 }}
              transition={{ duration: 0.2 }}>{Icon.back}</motion.button>
          )}
        </AnimatePresence>
        <AnimatePresence mode="wait" initial={false}>
          <motion.h1 key={title} className="title-wrap" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
            {title}<span className="sub">{session?.tenant.name}{session?.tenant.synthetic && <span className="demo-dot"> · Demo data</span>}</span>
          </motion.h1>
        </AnimatePresence>
        <ThemeToggle />
        <Link to="/alerts" className="icon-btn" aria-label={unread ? `Alerts, ${unread} unread` : 'Alerts'}>
          {Icon.bell}{unread > 0 && <span key={unread} className="badge">{unread > 9 ? '9+' : unread}</span>}
        </Link>
      </header>
      <main className="app-main" id="main" ref={mainRef} tabIndex={-1} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={pathname}
            className={`page stagger page-${slug}`}
            custom={dir}
            variants={{
              enter: (d: number) => (d ? { opacity: 0, x: d * 40 } : { opacity: 0, y: 18 }),
              center: { opacity: 1, x: 0, y: 0 },
              exit: (d: number) => (d ? { opacity: 0, x: d * -40 } : { opacity: 0 }),
            }}
            initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>
      <nav className="tabbar" aria-label="Main">
        <ul>
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink to={tab.to} end={tab.end}>
                <span className="tab-pill">
                  {activeTab === tab.to && <motion.span layoutId="tab-indicator" className="tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
                {!!tab.badge && <span key={tab.badge} className="badge" style={{ right: 'calc(50% - 30px)' }}>{tab.badge > 9 ? '9+' : tab.badge}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <AnimatePresence>
        {banner && (
          <motion.div key={banner.id} className="toast" role="status"
            initial={{ opacity: 0, y: -40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -30, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.6, bottom: 0.1 }}
            onDragEnd={(_, info) => { if (info.offset.y < -30) dismiss(); }}>
            <div>
              <strong>{banner.title}</strong>
              {banner.body && <p className="small" style={{ opacity: 0.8 }}>{banner.body}</p>}
            </div>
            <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
              {alertLink(banner) !== '/alerts' && (
                <button className="btn btn-primary btn-small" onClick={() => { dismiss(); navigate(alertLink(banner)); }}>{NUDGE_ACTION[banner.kind]?.label ?? 'Open'}</button>
              )}
              <button className="btn-link small" onClick={dismiss}>Dismiss</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
