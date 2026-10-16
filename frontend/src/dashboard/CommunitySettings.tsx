// Community settings: the community's name, how people join, how the dashboard looks, and the organiser account.
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCommunity } from '../api/hooks';
import { useRenameCommunity } from '../api/organiser';
import { ErrorNote, Skeleton } from '../components/ui';
import { displayName } from '../lib/format';
import { usePrefs, type ThemePref } from '../lib/prefs';
import { useSession } from '../lib/session';
import { useCopy } from './OrgLayout';
import { OrgIcon } from './orgIcons';

const KIND: Record<string, string> = { university: 'University or college', corporate: 'Workplace', residential: 'Neighbourhood', alumni: 'Alumni network', professional: 'Professional group', public: 'Open community' };

export default function CommunitySettings() {
  const c = useCommunity().data;
  const rename = useRenameCommunity();
  const { session, signOut } = useSession();
  const { prefs, set } = usePrefs();
  const navigate = useNavigate();
  const copy = useCopy();
  const [name, setName] = useState('');
  useEffect(() => { if (c) setName(c.name); }, [c?.name]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return <Skeleton h={400} />;
  const code = session?.tenant.join_code;
  const link = code ? `${window.location.origin}/signup?code=${encodeURIComponent(code)}` : '';
  const message = `Join ${displayName(c.name)} on FellaRide to share rides to ${c.destinations.map((d) => d.name).join(', ')}. Sign up here: ${link}${code ? ` (join code ${code})` : ''}`;
  const trimmed = name.trim();
  function submit(e: FormEvent) { e.preventDefault(); if (trimmed.length >= 2 && trimmed !== c!.name) rename.mutate(trimmed); }

  return (
    <div className="settings-grid">
      <section className="panel" aria-labelledby="prof-h">
        <h2 id="prof-h">Community</h2>
        <form className="stack" onSubmit={submit}>
          <label className="field">Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} minLength={2} required />
            <span className="hint">Members see this at the top of their app.{c.synthetic ? ' This is a demo community: “(demo)” keeps it labelled wherever the name is shown.' : ''}</span>
          </label>
          <ErrorNote error={rename.error} />
          {rename.isSuccess && trimmed === c.name && <p className="note note-ok" role="status">Saved. Members see the new name from now on.</p>}
          <button className="btn btn-primary" style={{ justifySelf: 'start' }} disabled={rename.isPending || trimmed.length < 2 || trimmed === c.name}>{rename.isPending ? 'Saving…' : 'Save name'}</button>
        </form>
        <dl className="facts">
          <dt>Kind</dt><dd>{KIND[c.kind] || c.kind}</dd>
          <dt>Day</dt><dd>Day {c.current_day} · {c.clock === 'manual' ? 'simulated timeline' : 'follows the calendar'}</dd>
          <dt>Data</dt><dd>{c.synthetic ? 'Synthetic members, no real people' : 'Real members'}</dd>
        </dl>
        <h3 style={{ fontSize: 16 }}>Destinations</h3>
        <ul className="dest-list">{c.destinations.map((d) => <li key={d.id}><span className="dest-dot" aria-hidden="true" />{d.name}<span className="small muted num">{d.lat.toFixed(3)}, {d.lon.toFixed(3)}</span></li>)}</ul>
      </section>

      <div className="stack-lg">
        <section className="panel" aria-labelledby="inv-h">
          <h2 id="inv-h">Invite people</h2>
          {code ? (
            <>
              <div className="code-card">
                <span className="small">Join code</span>
                <strong className="join-code">{code}</strong>
                <button className="btn btn-light btn-small" onClick={() => copy(code, 'Join code')}>{OrgIcon.copy}Copy</button>
              </div>
              <div className="btn-row">
                <button className="btn btn-quiet btn-small" onClick={() => copy(link, 'Sign-up link')}>Copy sign-up link</button>
                <button className="btn btn-quiet btn-small" onClick={() => copy(message, 'Invite message')}>Copy invite message</button>
                <a className="btn btn-quiet btn-small" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              </div>
              <p className="small muted">The link opens sign-up with the code filled in, so people land in this community.</p>
            </>
          ) : <p className="muted">This community has no join code.</p>}
        </section>

        <section className="panel" aria-labelledby="look-h">
          <h2 id="look-h">Appearance</h2>
          <div className="segmented full" role="radiogroup" aria-label="Theme">
            {([['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']] as [ThemePref, string][]).map(([t, l]) => (
              <button key={t} role="radio" aria-checked={prefs.theme === t} aria-pressed={prefs.theme === t} onClick={() => set('theme', t)}>{l}</button>
            ))}
          </div>
          <label className="check-row"><input type="checkbox" checked={prefs.reduceMotion} onChange={(e) => set('reduceMotion', e.target.checked)} /><span>Reduce motion (the map replay and counters jump instead of animating)</span></label>
        </section>

        <section className="panel" aria-labelledby="acct-h">
          <h2 id="acct-h">Your account</h2>
          <p>Signed in as <strong>{session?.user.email}</strong>, the organiser of {displayName(c.name)}.</p>
          <button className="btn btn-quiet" style={{ justifySelf: 'start' }} onClick={() => { signOut(); navigate('/welcome'); }}>{OrgIcon.out}Sign out</button>
        </section>
      </div>
    </div>
  );
}
