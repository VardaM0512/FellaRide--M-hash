import { motion } from 'framer-motion';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createCommunity, demoLogin, login, useDemoAccounts, usePublicCommunities } from '../api/hooks';
import { signup, type Gender } from '../api/trips';
import { Avatar, ErrorNote, Icon, Logo, Skeleton } from '../components/ui';
import { STATE_LABEL } from '../lib/format';
import { GENDER_OPTIONS } from '../lib/tripFormat';
import { useSession } from '../lib/session';
import { ThemeToggle } from '../member/Settings';

function Shell({ title, back = '/welcome', children }: { title?: string; back?: string | null; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-top">
        {back && <Link to={back} className="icon-btn" aria-label="Back">{Icon.back}</Link>}
        {title && <h1 style={{ flex: 1 }}>{title}</h1>}
        <ThemeToggle />
      </div>
      {children}
    </main>
  );
}


// Commute threads drawing themselves across the hero, each with a car travelling along it.
const THREADS = [
  { d: 'M-20 190 C 80 190 140 90 250 80 S 400 40 460 24', color: '#F5A524', w: 4, delay: 0 },
  { d: 'M-20 150 C 90 160 150 120 250 118 S 380 92 460 70', color: '#34D399', w: 4, delay: 0.25 },
  { d: 'M-20 90 C 70 110 170 40 260 50 S 400 120 460 110', color: '#6B7280', w: 2.5, delay: 0.5 },
  { d: 'M30 230 C 120 180 220 190 300 150 S 420 130 460 140', color: '#A78BFA', w: 2.5, delay: 0.7 },
]

function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 440 320" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <defs>
        <linearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.3" stopColor="#0B0B0C" stopOpacity="0" />
          <stop offset="0.62" stopColor="#0B0B0C" stopOpacity="1" />
        </linearGradient>
      </defs>
      {THREADS.map((t, i) => (
        <g key={i}>
          <motion.path d={t.d} stroke={t.color} strokeWidth={t.w} fill="none" strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.6, delay: t.delay, ease: [0.22, 1, 0.36, 1] }} />
          <circle r={t.w + 2.5} fill="#fff">
            <animateMotion dur={`${6 + i * 1.5}s`} begin={`${1.2 + t.delay}s`} repeatCount="indefinite" path={t.d} />
          </circle>
        </g>
      ))}
      <rect width="440" height="320" fill="url(#hero-fade)" />
    </svg>
  );
}

export function Welcome() {
  return (
    <main className="auth welcome">
      <div className="auth-top brand"><Logo /><strong style={{ flex: 1 }}>FellaRide</strong><ThemeToggle /></div>
      <section className="auth-hero">
        <HeroArt />
        <h1>Share the ride.<br />Split the road.</h1>
        <p>Driving somewhere? Post your ride and people along your route can ask for a seat. Need a ride? See who’s going your way, with their rating, and ask.</p>
      </section>
      <div className="auth-actions">
        <div className="welcome-intro">
          <h2>Get moving together</h2>
          <p className="muted">Join your college, company or neighbourhood, find people on your route, and share the ride.</p>
        </div>
        <Link to="/signup" className="btn btn-primary btn-block">Create an account {Icon.arrow}</Link>
        <Link to="/signin" className="btn btn-quiet btn-block">Sign in</Link>
        <Link to="/demo" className="btn btn-ride btn-block">Try the demo community</Link>
        <Link to="/start" className="btn-link" style={{ justifySelf: 'center', marginTop: 6 }}>Organising a community? Start one</Link>
      </div>
    </main>
  );
}

export function SignIn() {
  const [params] = useSearchParams();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const s = await login(email, password);
      signIn(s);
      navigate(s.user.role === 'admin' ? '/dashboard' : '/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <Shell title="Sign in">
      <form onSubmit={submit} className="stack-lg" noValidate>
        <label className="field">Email or mobile number<input autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted" style={{ textAlign: 'center' }}>New here? <Link to="/signup" style={{ fontWeight: 700 }}>Create an account</Link></p>
      </form>
    </Shell>
  );
}

export function Signup() {
  const [params] = useSearchParams();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', gender: '' as Gender | '', email: params.get('email') || '', mobile: '', password: '', join_code: params.get('code') || '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.gender) return setError(new Error('Choose how you’d like your gender shown.'));
    if (f.password.length < 8) return setError(new Error('Use at least 8 characters for your password.'));
    setBusy(true); setError(null);
    try {
      const s = await signup({
        name: f.name.trim(), gender: f.gender, email: f.email.trim(), mobile: f.mobile.trim(), password: f.password,
        ...(f.join_code.trim() ? { join_code: f.join_code.trim() } : {}),
      });
      signIn(s);
      navigate('/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Shell title="Create your account">
      <form onSubmit={submit} className="stack-lg" noValidate>
        <label className="field">Email<input type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></label>
        <label className="field">Mobile number<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} required />
          <span className="hint">Shared only with people whose ride you’re in, so you can call each other.</span></label>
        <label className="field">Password<input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} required minLength={8} maxLength={72} />
          <span className="hint">At least 8 characters.</span></label>
        <label className="field">Your name<input autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={2} maxLength={80} />
          <span className="hint">Drivers and riders see your name, gender and rating before they accept you.</span></label>
        <div className="field"><span>Gender</span>
          <div className="segmented full wrap" role="radiogroup" aria-label="Gender">
            {GENDER_OPTIONS.map(([g, label]) => (
              <button key={g} type="button" role="radio" aria-checked={f.gender === g} aria-pressed={f.gender === g} onClick={() => set('gender', g)}>{label}</button>
            ))}
          </div>
        </div>
        <label className="field">Join code (optional)
          <input value={f.join_code} onChange={(e) => set('join_code', e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={16} placeholder="e.g. DEMO2026" />
          <span className="hint">From your college, company or society. Leave empty to join the main community.</span></label>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || !f.email || !f.mobile || !f.password || !f.name}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="small muted" style={{ textAlign: 'center' }}>Have an account? <Link to="/signin" style={{ fontWeight: 700 }}>Sign in</Link></p>
      </form>
    </Shell>
  );
}

export function DemoPicker() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const communities = usePublicCommunities();
  const demo = communities.data?.find((c) => c.synthetic);
  const [q, setQ] = useState('');
  const people = useDemoAccounts(demo?.id, q);
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  async function pick(id: number) {
    if (!demo) return;
    setBusyId(id); setError(null);
    try { signIn(await demoLogin(demo.id, id)); navigate('/', { replace: true }); } catch (err) { setError(err); } finally { setBusyId(null); }
  }
  return (
    <Shell title="Try the demo">
      <p className="muted">Sign in as any member of the synthetic demo community. Everyone here is made up. You’ll add a gender and a test mobile number the first time.</p>
      <Link to="/signin?email=admin@demo.fellaride.app" className="btn btn-quiet btn-block">Sign in as the organiser (dashboard)</Link>
      <div className="search">
        <label className="field"><span className="sr-only">Search people</span>
          <input type="search" placeholder="Search by name, e.g. Aarav" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <ErrorNote error={error || communities.error || people.error} />
      {!demo && !communities.isLoading && <p className="note note-info">No demo community on this server.</p>}
      {people.isLoading ? <Skeleton h={240} /> : (
        <ul className="list stagger">
          {(people.data || []).map((p) => (
            <li key={p.id}>
              <button className="row-btn" onClick={() => pick(p.id)} disabled={busyId !== null}>
                <Avatar name={p.name} driver={p.has_car} />
                <span><span className="who">{p.name}</span><br /><span className="small muted">{p.area}, {p.has_car ? 'drives' : 'rides'}. {STATE_LABEL[p.state]}</span></span>
                <span className="small muted">{busyId === p.id ? 'Signing in…' : '→'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

export function StartCommunity() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', kind: 'university', destination: 'Main gate', lat: '', lon: '', adminName: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  function locate() {
    navigator.geolocation?.getCurrentPosition((p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(5), lon: p.coords.longitude.toFixed(5) })),
      () => setError(new Error('Location permission was denied. Type the coordinates instead.')));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const lat = Number(f.lat), lon = Number(f.lon);
    if (!f.lat || !f.lon || Number.isNaN(lat) || Number.isNaN(lon)) return setError(new Error('Set the campus location first.'));
    setBusy(true); setError(null);
    try {
      const r = await createCommunity({
        name: f.name.trim(), kind: f.kind, center_lat: lat, center_lon: lon,
        destinations: [{ name: f.destination.trim() || 'Main gate', lat, lon }],
        admin: { name: f.adminName.trim(), email: f.email.trim(), password: f.password },
      });
      signIn(r.session);
      navigate('/dashboard', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <Shell title="Start a community">
      <form onSubmit={submit} className="stack-lg">
        <label className="field">Community name<input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} placeholder="e.g. Riverside Tech Park" /></label>
        <label className="field">Type
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="university">University</option><option value="corporate">Company</option><option value="residential">Residential</option>
            <option value="alumni">Alumni network</option><option value="professional">Professional group</option>
          </select>
        </label>
        <label className="field">Where everyone goes<input value={f.destination} onChange={(e) => set('destination', e.target.value)} maxLength={120} /></label>
        <div className="grid-2">
          <label className="field">Latitude<input inputMode="decimal" value={f.lat} onChange={(e) => set('lat', e.target.value)} /></label>
          <label className="field">Longitude<input inputMode="decimal" value={f.lon} onChange={(e) => set('lon', e.target.value)} /></label>
        </div>
        <button type="button" className="btn btn-quiet" onClick={locate}>{Icon.pin} Use where I am now</button>
        <label className="field">Your name<input value={f.adminName} onChange={(e) => set('adminName', e.target.value)} required autoComplete="name" /></label>
        <label className="field">Email<input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required autoComplete="email" /></label>
        <label className="field">Password<input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} required minLength={8} autoComplete="new-password" />
          <span className="hint">At least 8 characters.</span></label>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create community'}</button>
      </form>
    </Shell>
  );
}

