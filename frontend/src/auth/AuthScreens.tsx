import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { createCommunity, demoLogin, forgotPassword, login, resetPassword, useDemoAccounts, usePublicCommunities } from '../api/hooks';
import { lookupReferral, signup, type Gender, type Place, type ReferralLookup } from '../api/trips';
import MapView from '../components/MapView';
import PlaceField from '../components/PlaceField';
import { nameOf } from '../lib/places';
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


/** A titled, numbered group of fields, so long forms read as a few short steps. */
function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  const id = `sec-${n}-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="form-section" aria-labelledby={id}>
      <header className="form-section-head">
        <span className="step-dot" aria-hidden="true">{n}</span>
        <span><h2 id={id}>{title}</h2>{hint && <p className="small muted">{hint}</p>}</span>
      </header>
      {children}
    </section>
  );
}

/** Password input with a show/hide button (helps on phones and for people who mistype). */
function PasswordField({ label, value, onChange, autoComplete, hint }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">{label}
      <span className="pw-wrap">
        <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete}
          required minLength={autoComplete === 'new-password' ? 8 : undefined} maxLength={72} />
        <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-pressed={show}
          aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
      </span>
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

// Brand moment: scattered members appear, their separate commutes converge into one shared
// route, and the ride arrives. It plays once; afterwards only a faint light travels the shared route.
// Pure SVG + CSS (see "hero art" in app.css), so the app's Reduce motion setting shows the final frame.
const MERGE = 'M250 104 C 292 98 330 82 372 64';
const MEMBERS = [
  { x: 34, y: 46, d: 'M34 46 C 110 46 170 100 250 104' },
  { x: 140, y: 22, d: 'M140 22 C 180 34 205 96 250 104' },
  { x: 22, y: 118, d: 'M22 118 C 100 120 170 106 250 104' },
  { x: 152, y: 156, d: 'M152 156 C 192 146 218 110 250 104' },
  { x: 64, y: 182, d: 'M64 182 C 132 180 182 114 250 104' },
];

function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 440 320" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      <defs>
        <linearGradient id="hero-fade" x1="0" y1="0" x2="0" y2="1">
          <stop className="fade-stop" offset="0.52" stopColor="#101418" stopOpacity="0" />
          <stop className="fade-stop" offset="0.82" stopColor="#101418" stopOpacity="1" />
        </linearGradient>
        <radialGradient id="hero-glow" cx="0.5" cy="0.5" r="0.5">
          <stop className="glow-stop" offset="0" stopColor="#C9973A" stopOpacity="0.35" />
          <stop className="glow-stop" offset="1" stopColor="#C9973A" stopOpacity="0" />
        </radialGradient>
      </defs>
      {MEMBERS.map((m, i) => (
        <g key={i} style={{ ['--i' as string]: i }}>
          <path className="ha-route" d={m.d} pathLength={1} />
          <circle className="ha-member" cx={m.x} cy={m.y} r={3} />
        </g>
      ))}
      <path className="ha-shared" d={MERGE} pathLength={1} />
      <path className="ha-light" d={MERGE} pathLength={1} />
      <circle className="ha-glow" cx={372} cy={64} r={34} fill="url(#hero-glow)" />
      <circle className="ha-dest-ring" cx={372} cy={64} r={7} />
      <circle className="ha-dest" cx={372} cy={64} r={3} />
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
        <p className="hero-eyebrow">Many commutes · One community</p>
        <h1>Ride with Confidence.</h1>
        <p className="hero-tagline">Connect with familiar faces</p>
        <p>Driving somewhere? Post your ride and people along your route can ask for a seat. Need a ride? See who’s going your way, with their rating, and ask.</p>
      </section>
      <div className="auth-actions">
        <div className="welcome-intro">
          <h2>Because familiar feels better</h2>
          <p className="muted">Join your college, company or neighbourhood, find people on your route, and share the ride.</p>
        </div>
        <Link to="/signup" className="btn btn-primary btn-block">Create an account {Icon.arrow}</Link>
        <Link to="/signin" className="btn btn-quiet btn-block">Sign in</Link>
        <Link to="/demo" className="btn btn-accent btn-block">Try the demo community</Link>
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
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <p className="small" style={{ marginTop: -8, textAlign: 'right' }}>
          <Link to={`/forgot-password${email.includes('@') ? `?email=${encodeURIComponent(email)}` : ''}`} style={{ fontWeight: 600 }}>Forgot password?</Link>
        </p>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted" style={{ textAlign: 'center' }}>New here? <Link to="/signup" style={{ fontWeight: 700 }}>Create an account</Link></p>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { setSent((await forgotPassword(email.trim())).message); } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <Shell title="Forgot password" back="/signin">
      {sent ? (
        <div className="stack-lg">
          <p className="note note-ok" role="status">{sent}</p>
          <p className="small muted">Didn’t get it? Check your spam folder, or try again in a minute.</p>
          <button className="btn btn-quiet btn-block" onClick={() => setSent(null)}>Send it again</button>
          <Link to="/signin" className="btn btn-primary btn-block">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="stack-lg" noValidate>
          <p className="muted">Enter the email you signed up with. We’ll send you a link to set a new password.</p>
          <label className="field">Email<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <ErrorNote error={error} />
          <button className="btn btn-primary btn-block" disabled={busy || !email.includes('@')}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError(new Error('Use at least 8 characters for your password.'));
    if (password !== again) return setError(new Error('The two passwords don’t match.'));
    setBusy(true); setError(null);
    try {
      const s = await resetPassword(token, password);
      signIn(s);
      navigate(s.user.role === 'admin' ? '/dashboard' : '/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  if (!token) {
    return (
      <Shell title="Set a new password" back="/signin">
        <p className="note note-info">This page needs the link from your reset email. <Link to="/forgot-password">Ask for a new link</Link>.</p>
      </Shell>
    );
  }
  return (
    <Shell title="Set a new password" back="/signin">
      <form onSubmit={submit} className="stack-lg" noValidate>
        <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
        <PasswordField label="Type it again" value={again} onChange={setAgain} autoComplete="new-password" />
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || !password || !again}>{busy ? 'Saving…' : 'Save and sign in'}</button>
        <p className="small muted" style={{ textAlign: 'center' }}>Link expired? <Link to="/forgot-password" style={{ fontWeight: 700 }}>Send a new one</Link></p>
      </form>
    </Shell>
  );
}

export function Signup() {
  const [params] = useSearchParams();
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', gender: '' as Gender | '', email: params.get('email') || '', mobile: '', password: '',
    join_code: params.get('code') || '', referral_code: (params.get('ref') || '').toUpperCase() });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [inviter, setInviter] = useState<ReferralLookup | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // a referral code (from a friend's link, or typed): show whose it is, so people know where they'll land
  useEffect(() => {
    const code = f.referral_code.trim();
    if (code.length < 5) { setInviter(null); return; }
    const t = window.setTimeout(() => { lookupReferral(code).then(setInviter).catch(() => setInviter(null)); }, 400);
    return () => window.clearTimeout(t);
  }, [f.referral_code]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.gender) return setError(new Error('Choose how you’d like your gender shown.'));
    if (f.password.length < 8) return setError(new Error('Use at least 8 characters for your password.'));
    setBusy(true); setError(null);
    try {
      const s = await signup({
        name: f.name.trim(), gender: f.gender, email: f.email.trim(), mobile: f.mobile.trim(), password: f.password,
        ...(f.join_code.trim() ? { join_code: f.join_code.trim() } : {}),
        ...(f.referral_code.trim() ? { referral_code: f.referral_code.trim() } : {}),
      });
      signIn(s);
      navigate('/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Shell title="Create your account">
      <form onSubmit={submit} className="stack-lg" noValidate>
        {inviter && (
          <p className="note note-ok" role="status">
            <strong>{inviter.referrer}</strong> invited you to share rides in <strong>{inviter.community}</strong>. You’ll join their community.
          </p>
        )}
        <Section n={1} title="Your account" hint="Sign in later with your email or mobile number.">
          <label className="field">Email<input type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} required placeholder="you@example.com" /></label>
          <label className="field">Mobile number<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" value={f.mobile} onChange={(e) => set('mobile', e.target.value)} required />
            <span className="hint">Shared only with people whose ride you’re in, so you can call each other.</span></label>
          <PasswordField label="Password" value={f.password} onChange={(v) => set('password', v)} autoComplete="new-password" hint="At least 8 characters." />
        </Section>
        <Section n={2} title="About you" hint="Drivers and riders see this, with your rating, before they accept you.">
          <label className="field">Your name<input autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={2} maxLength={80} placeholder="e.g. Priya Mehta" /></label>
          <div className="field" role="radiogroup" aria-labelledby="gender-l"><span id="gender-l">Gender</span>
            <div className="choice-chips">
              {GENDER_OPTIONS.map(([g, label]) => (
                <button key={g} type="button" role="radio" aria-checked={f.gender === g} className="choice" onClick={() => set('gender', g)}>{label}</button>
              ))}
            </div>
          </div>
        </Section>
        <Section n={3} title="Your community" hint={inviter ? `Optional. Leave it empty to join ${inviter.referrer}’s community.` : 'Optional. Leave it empty to join the main community.'}>
          <label className="field">Join code
            <input value={f.join_code} onChange={(e) => set('join_code', e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={16} placeholder="e.g. DEMO2026" className="code-input" />
            <span className="hint">From your college, company or society.</span></label>
          <label className="field">Referral code
            <input value={f.referral_code} onChange={(e) => set('referral_code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={12} placeholder="Optional, from a friend" className="code-input" />
            <span className="hint">{inviter ? `Code from ${inviter.referrer} ✓` : 'If a friend invited you, their code credits them.'}</span></label>
        </Section>
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

const KINDS: [string, string][] = [['university', 'University'], ['corporate', 'Company'], ['residential', 'Neighbourhood'], ['alumni', 'Alumni'], ['professional', 'Professional group']];

export function StartCommunity() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', kind: 'university', destination: 'Main gate', adminName: '', email: '', password: '' });
  const [place, setPlace] = useState<Place | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function tapMap(pt: { lat: number; lon: number }) {
    setPlace({ ...pt, name: await nameOf(pt.lat, pt.lon) });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!place) return setError(new Error('Set where everyone goes: search for it, use your location, or tap the map.'));
    if (f.password.length < 8) return setError(new Error('Use at least 8 characters for your password.'));
    setBusy(true); setError(null);
    try {
      const r = await createCommunity({
        name: f.name.trim(), kind: f.kind, center_lat: place.lat, center_lon: place.lon,
        destinations: [{ name: f.destination.trim() || 'Main gate', lat: place.lat, lon: place.lon }],
        admin: { name: f.adminName.trim(), email: f.email.trim(), password: f.password },
      });
      signIn(r.session);
      navigate('/dashboard', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  const ready = f.name.trim() && place && f.adminName.trim() && f.email.includes('@') && f.password.length >= 8;
  return (
    <Shell title="Start a community">
      <p className="muted">Set up carpooling for your college, company or neighbourhood. You’ll get a join code to share with members.</p>
      <form onSubmit={submit} className="stack-lg" noValidate>
        <Section n={1} title="Your community">
          <label className="field">Community name<input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} placeholder="e.g. Riverside Tech Park" /></label>
          <div className="field" role="radiogroup" aria-labelledby="kind-l"><span id="kind-l">Type</span>
            <div className="choice-chips">
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" role="radio" aria-checked={f.kind === k} className="choice" onClick={() => set('kind', k)}>{label}</button>
              ))}
            </div>
          </div>
        </Section>
        <Section n={2} title="Where everyone goes" hint="The campus, office or gate most rides end at.">
          <label className="field">Name of the place<input value={f.destination} onChange={(e) => set('destination', e.target.value)} maxLength={120} placeholder="e.g. Main gate" /></label>
          <PlaceField label="Location" value={place} onChange={setPlace} active onActivate={() => {}} placeholder="Search an address or landmark" />
          <MapView label="Map. Tap to set where everyone goes." points={place ? [{ ...place, kind: 'to', label: f.destination || 'Destination' }] : []}
            onPick={tapMap} height={200} />
          {place && <p className="picked">{Icon.pin}<span><strong>{f.destination || 'Destination'}</strong><br /><span className="small muted">{place.name}</span></span></p>}
        </Section>
        <Section n={3} title="Your organiser account" hint="You’ll use this to sign in to the dashboard.">
          <label className="field">Your name<input value={f.adminName} onChange={(e) => set('adminName', e.target.value)} required autoComplete="name" placeholder="e.g. Asha Rao" /></label>
          <label className="field">Email<input type="email" inputMode="email" value={f.email} onChange={(e) => set('email', e.target.value)} required autoComplete="email" placeholder="you@example.com" /></label>
          <PasswordField label="Password" value={f.password} onChange={(v) => set('password', v)} autoComplete="new-password" hint="At least 8 characters." />
        </Section>
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" disabled={busy || !ready}>{busy ? 'Creating…' : <>Create community {Icon.arrow}</>}</button>
      </form>
    </Shell>
  );
}

