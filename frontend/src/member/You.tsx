// You: profile (name, gender, mobile), your rating, phone notifications, nearby-ride alerts, past rides, account.
// ProfileForm is also the one-time setup for demo accounts, which start without a gender or mobile.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteAccount } from '../api/hooks';
import { saveProfile, shareLocation, useMyTrips, useReferrals, type Gender } from '../api/trips';
import { useImpact, type Badge } from '../api/community';
import { Avatar, CountUp, ErrorNote, Icon, Skeleton } from '../components/ui';
import { notificationsSupported } from '../lib/notify';
import { currentPosition } from '../lib/places';
import { useSession } from '../lib/session';
import { GENDER_LABEL, GENDER_OPTIONS, carText, ratingText } from '../lib/tripFormat';
import { TripRow } from './Home';

export function ProfileForm({ onSaved, submitLabel = 'Save' }: { onSaved?: () => void; submitLabel?: string }) {
  const { session, signIn } = useSession();
  const p = session?.profile;
  const [f, setF] = useState({ name: p?.name || session?.member?.name || '', gender: (p?.gender || '') as Gender | '', mobile: p?.mobile || '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.gender) return setError(new Error('Choose how you’d like your gender shown.'));
    setBusy(true); setError(null);
    try {
      const profile = await saveProfile({ name: f.name.trim(), gender: f.gender, mobile: f.mobile.trim() });
      if (session) signIn({ ...session, profile });
      onSaved?.();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <label className="field">Your name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required minLength={2} maxLength={80} /></label>
      <div className="field"><span>Gender</span>
        <div className="segmented full wrap" role="radiogroup" aria-label="Gender">
          {GENDER_OPTIONS.map(([g, label]) => (
            <button key={g} type="button" role="radio" aria-checked={f.gender === g} aria-pressed={f.gender === g} onClick={() => setF({ ...f, gender: g })}>{label}</button>
          ))}
        </div>
      </div>
      <label className="field">Mobile number<input type="tel" inputMode="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} placeholder="+91 98765 43210" required />
        <span className="hint">Only people in the same ride see it, so you can call each other.</span></label>
      <ErrorNote error={error} />
      <button className="btn btn-primary btn-block" disabled={busy || !f.name || !f.mobile}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

export function ProfileSetup() {
  const navigate = useNavigate();
  return (
    <main className="auth">
      <h1 style={{ fontSize: 30 }}>One more step</h1>
      <p className="muted">Drivers and riders see your name, gender and rating before they accept you.</p>
      <ProfileForm submitLabel="Continue" onSaved={() => navigate('/', { replace: true })} />
    </main>
  );
}

function PhoneAlerts() {
  const [perm, setPerm] = useState(notificationsSupported() ? Notification.permission : 'unsupported');
  if (perm === 'unsupported') return <p className="small muted">This browser can’t show phone notifications here (they need https or localhost). Alerts still appear in the app.</p>;
  if (perm === 'granted') return <p className="small muted">Phone notifications are on. You’ll get one for seat requests, approvals, driver updates and rides near you, even with the app in the background.</p>;
  if (perm === 'denied') return <p className="small muted">Notifications are blocked in your browser settings. Alerts still appear in the app.</p>;
  return <button className="btn btn-quiet btn-block" onClick={async () => setPerm(await Notification.requestPermission())}>{Icon.bell} Turn on phone notifications</button>;
}

function NearbyAlerts() {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [err, setErr] = useState('');
  async function share() {
    setState('busy'); setErr('');
    try { const p = await currentPosition(); await shareLocation(p.lat, p.lon); setState('done'); } catch (e) { setErr((e as Error).message); setState('idle'); }
  }
  return (
    <>
      <p className="small muted">When someone posts a ride passing near your last known location, you get an alert. Your location updates when you search or post a ride, or here.</p>
      <button className="btn btn-quiet btn-block" onClick={share} disabled={state === 'busy'}>{Icon.pin} {state === 'done' ? 'Location updated' : state === 'busy' ? 'Finding you…' : 'Update my location now'}</button>
      {err && <p className="small field-error" role="alert">{err}</p>}
    </>
  );
}


function BadgeTile({ b }: { b: Badge }) {
  return (
    <li className={`badge-tile${b.earned ? ' earned' : ''}`}>
      <span className="badge-art" aria-hidden="true">{Icon.check}</span>
      <strong>{b.label}</strong>
      <span className="small muted">{b.desc}</span>
      {b.earned
        ? <span className="small badge-state">Earned</span>
        : <span className="mini-bar" role="progressbar" aria-label={`${b.label} progress`} aria-valuemin={0} aria-valuemax={b.need} aria-valuenow={b.have}
            aria-valuetext={`${b.have} of ${b.need}`}><i style={{ width: `${Math.round(b.progress * 100)}%` }} /></span>}
    </li>
  );
}

function Impact() {
  const impact = useImpact();
  if (impact.error) return <ErrorNote error={impact.error} onRetry={() => impact.refetch()} />;
  if (!impact.data) return <Skeleton h={260} />;
  const d = impact.data;
  const earned = d.badges.filter((b) => b.earned).length;
  const stats = [
    { v: d.rides, l: d.rides === 1 ? 'ride shared' : 'rides shared' },
    { v: d.people_met, l: d.people_met === 1 ? 'person met' : 'people met' },
    { v: d.km, l: 'km shared' },
    { v: d.co2_kg, l: 'kg CO₂ saved', dec: 1 },
  ];
  return (
    <>
      <section className="impact" aria-labelledby="impact-h">
        <div className="impact-top">
          <h2 id="impact-h">Your impact</h2>
          {d.streak_weeks > 0 && <span className="chip">{d.streak_weeks}-week streak</span>}
        </div>
        <ul className="impact-grid">
          {stats.map((s) => <li key={s.l}><strong className="num"><CountUp value={s.v} decimals={s.dec ?? 0} /></strong><span>{s.l}</span></li>)}
        </ul>
        {d.rank && <p className="small">#{d.rank} in your community for rides shared. <Link to="/community" className="btn-link" style={{ color: 'inherit' }}>See the leaderboard</Link></p>}
      </section>
      <section aria-labelledby="badges-h">
        <div className="section-head"><h3 id="badges-h">Badges</h3><span className="chip">{earned} of {d.badges.length}</span></div>
        <ul className="badge-grid">{d.badges.map((b) => <BadgeTile key={b.code} b={b} />)}</ul>
      </section>
    </>
  );
}

/** Delete account: asks for the password, then cancels open rides, removes personal details and signs out. */
function DeleteAccount() {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!window.confirm('Delete your account for good? This can’t be undone.')) return;
    setBusy(true); setError(null);
    try {
      await deleteAccount(password);
      signOut();
      navigate('/welcome', { replace: true });
    } catch (err) { setError(err); setBusy(false); }
  }
  if (!open) return <button className="btn-link small" style={{ alignSelf: 'center', color: 'var(--chilli)' }} onClick={() => setOpen(true)}>Delete my account</button>;
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="del-h" noValidate>
      <h3 id="del-h">Delete your account</h3>
      <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
        <li>Rides you’re driving are cancelled, and your seat requests are withdrawn. Everyone involved is told.</li>
        <li>Your name, email, mobile number, car and location are removed. Past rides and ratings stay for the other people in them, shown as “Deleted user”.</li>
        <li>You can sign up again later with the same email or mobile number.</li>
      </ul>
      <label className="field">Your password, to confirm
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      <ErrorNote error={error} />
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" onClick={() => { setOpen(false); setPassword(''); setError(null); }}>Keep my account</button>
        <button className="btn btn-danger" disabled={busy || !password}>{busy ? 'Deleting…' : 'Delete account'}</button>
      </div>
    </form>
  );
}

/** Your referral tier and points, linking to the Invite page. */
function ReferralLink() {
  const r = useReferrals().data;
  return (
    <Link to="/invite" className="btn btn-invite btn-block">
      {Icon.invite} Refer friends{r ? ` · ${r.tier.name} · ${r.points} points` : ' and earn points'}
    </Link>
  );
}

export default function You() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const mine = useMyTrips();
  const [editing, setEditing] = useState(false);
  const p = session?.profile;
  return (
    <>
      <section className="card" aria-labelledby="me-h">
        <div className="profile-head">
          <Avatar name={p?.name || '?'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="me-h" style={{ fontSize: 24 }}>{p?.name}</h2>
            {p && <span className="rating-pill">{ratingText(p.rating)}</span>}
          </div>
          {!editing && <button className="btn btn-quiet btn-small" onClick={() => setEditing(true)}>Edit</button>}
        </div>
        {editing ? <ProfileForm onSaved={() => setEditing(false)} /> : p && (
          <dl className="facts">
            <dt>Gender</dt><dd>{GENDER_LABEL[p.gender]}</dd>
            <dt>Mobile</dt><dd>{p.mobile}</dd>
            {p.car && <><dt>Car</dt><dd>{carText(p.car)}</dd></>}
            <dt>Rating</dt><dd>{ratingText(p.rating)}</dd>
            <dt>Community</dt><dd>{session?.tenant.name}</dd>
          </dl>
        )}
        <p className="small muted">Your rating is the average of your last 20 ratings, with recent rides counting most. Leaving before your posted time without an approved rider, or cancelling after approving someone, lowers it automatically.</p>
      </section>

      <Impact />

      <Link to="/settings" className="role-card">
        <span className="role-icon" style={{ background: 'var(--mist-2)', color: 'var(--ink)' }}>{Icon.settings}</span>
        <span><strong>Display & accessibility</strong><br /><span className="small">Dark mode, text size, motion and contrast</span></span>
      </Link>

      <ReferralLink />

      <section className="card" aria-labelledby="alerts-h"><h3 id="alerts-h">Notifications</h3><PhoneAlerts /><NearbyAlerts /></section>

      {mine.data && mine.data.history.length > 0 && (
        <section aria-labelledby="hist-h">
          <h3 id="hist-h" className="section-head">Past rides</h3>
          <div className="list">{mine.data.history.map((t) => <TripRow key={t.id} trip={t} note={t.to_rate ? `${t.to_rate} to rate` : undefined} />)}</div>
        </section>
      )}

      <section className="stack" aria-label="Account">
        <p className="small muted">Signed in as {session?.user.email.startsWith('demo-member-') ? `${p?.name} (demo account)` : session?.user.email}</p>
        {session?.tenant.synthetic && <button className="btn btn-quiet btn-block" onClick={() => { signOut(); navigate('/demo'); }}>Switch demo person</button>}
        <button className="btn btn-danger btn-block" onClick={() => { signOut(); navigate('/welcome'); }}>Sign out</button>
        {/* demo people have no password of their own, so there's nothing to delete */}
        {!session?.user.email.startsWith('demo-member-') && <DeleteAccount />}
      </section>
    </>
  );
}
