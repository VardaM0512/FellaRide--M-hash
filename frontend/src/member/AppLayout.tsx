// The phone app frame: top bar, scrolling content, bottom tabs (Home, Alerts, You).
// New alerts drop in as a banner, vibrate, and show as a phone notification when the app is in the background.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import { resendVerification, shareLocation, useAlerts, verifyEmail, type Alert } from '../api/trips';
import { Avatar, ErrorNote, Icon, Logo } from '../components/ui';
import { ratingText } from '../lib/tripFormat';
import { useAnnounce } from '../lib/announce';
import { showSystemNotification } from '../lib/notify';
import { useSession } from '../lib/session';
import { ThemeToggle } from './Settings';

const TITLES: Record<string, string> = {
  '/': 'FellaRide', '/offer': 'Offer a ride', '/find': 'Find a ride', '/alerts': 'Alerts', '/me': 'You', '/invite': 'Refer friends',
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

/** New accounts confirm their email with the 6-digit code from the sign-up email before posting or booking a ride
 *  (only while the server can send email). Shown on every screen until it's done. */
function VerifyEmailBanner() {
  const { session, signIn } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  if (!session || session.user.email_verified !== false || !session.user.email_verification_required) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNote('');
    try { signIn({ ...(await verifyEmail(code)), token: session!.token }); } catch (err) { setError(err); } finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError(null); setNote('');
    try { setNote((await resendVerification()).message ?? 'We’ve sent a new code.'); } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <form className="note note-info stack" onSubmit={submit} aria-labelledby="verify-h">
      <strong id="verify-h">Confirm your email to start riding</strong>
      <span className="small">Enter the 6-digit code we sent to {session.user.email}. Until then you can look around, but not post or book a ride.</span>
      <div className="btn-row">
        <label className="field" style={{ flex: 1 }}><span className="sr-only">Code</span>
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="123456"
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button className="btn btn-primary btn-small" disabled={busy || code.length !== 6}>Confirm</button>
        <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={resend}>Send a new code</button>
      </div>
      {note && <span className="small" role="status">{note}</span>}
      <ErrorNote error={error} />
    </form>
  );
}

// Tabs sit side by side; moving between them slides sideways. Everything else (a ride, a form) rises from below.
const TAB_ORDER = ['/', '/community', '/alerts', '/me'];
const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘\\' : 'Ctrl+\\';

/** Laptops: the sidebar folds down to a rail of stations. Remembered on this device; Cmd/Ctrl + \\ toggles it. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('fr.sidebar') === 'rail'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('fr.sidebar', collapsed ? 'rail' : 'open'); } catch { /* not remembered */ } }, [collapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setCollapsed((c) => !c); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [collapsed, setCollapsed] as const;
}

export default function AppLayout() {
  const { session } = useSession();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const { banner, dismiss, unread } = useAlertBanner();
  useQuietLocation();
  const [collapsed, setCollapsed] = useCollapsed();
  const mainRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const prevTab = useRef(TAB_ORDER.indexOf(pathname));
  const tabIndex = TAB_ORDER.indexOf(pathname);
  const dir = tabIndex >= 0 && prevTab.current >= 0 ? Math.sign(tabIndex - prevTab.current) : 0;
  useEffect(() => { prevTab.current = tabIndex; }, [tabIndex]);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); setScrolled(false); }, [pathname]);

  const tabs = [
    { to: '/', label: 'Home', icon: Icon.today, end: true, note: 'Departures and your week' },
    { to: '/community', label: 'Community', icon: Icon.people, note: 'Board, challenge, leaders' },
    { to: '/alerts', label: 'Alerts', icon: Icon.bell, badge: unread, note: unread ? `${unread} new` : 'All caught up' },
    { to: '/me', label: 'You', icon: Icon.me, note: 'Your pass and impact' },
  ];
  const activeTab = tabs.find((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)))?.to;
  const title = pathname.startsWith('/trip/') ? 'Your ride' : TITLES[pathname] || 'FellaRide';
  const slug = pathname === '/' ? 'home' : pathname.split('/')[1];
  const me = session?.profile;
  return (
    <div className={`app${collapsed ? ' rail' : ''}`}>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      {/* laptops and large tablets: a sidebar replaces the bottom tabs (CSS decides which one shows) */}
      <aside className="sidebar" id="sidebar" aria-label="Sidebar">
        <div className="side-top">
          <Link to="/" className="brand" aria-label="FellaRide home"><Logo size={34} /><strong>FellaRide</strong></Link>
          <button type="button" className="side-toggle" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-controls="sidebar"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} data-tip={`${collapsed ? 'Expand' : 'Collapse'} · ${SHORTCUT}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9.5 4v16" /><path d={collapsed ? 'M14 10l2 2-2 2' : 'M16 10l-2 2 2 2'} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="line-name"><span className="line-swatch" aria-hidden="true" /><span>{session?.tenant.name.replace(/\s*\(demo\)$/i, '')}</span>
          {session?.tenant.synthetic && <span className="line-tag">Demo</span>}</p>
        <nav aria-label="Main">
          <ol className="metro">
            {tabs.map((tab) => (
              <li key={tab.to}>
                <NavLink to={tab.to} end={tab.end} className="station" data-tip={tab.label} aria-label={collapsed ? tab.label : undefined}>
                  <span className="station-dot">
                    {activeTab === tab.to && <motion.span layoutId="station-current" className="station-current" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span className="station-icon">{tab.icon}</span>
                  </span>
                  <span className="station-text"><strong>{tab.label}</strong><span>{tab.note}</span></span>
                  {!!tab.badge && <span className="side-badge">{tab.badge > 9 ? '9+' : tab.badge}</span>}
                </NavLink>
              </li>
            ))}
          </ol>
        </nav>
        <div className="side-go">
          <Link to="/find" className="go-ride" data-tip="Find a ride" aria-label="Find a ride">{Icon.search}<span>Find</span></Link>
          <Link to="/offer" className="go-drive" data-tip="Offer a ride" aria-label="Offer a ride">{Icon.car}<span>Offer</span></Link>
        </div>
        {me && (
          <Link to="/me" className="side-me" data-tip={me.name}>
            <Avatar name={me.name} />
            <span className="side-me-text"><strong>{me.name}</strong><span>{ratingText(me.rating)}</span></span>
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
        <VerifyEmailBanner />
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
