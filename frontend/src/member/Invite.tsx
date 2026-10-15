// Refer friends. Everyone has a personal referral link: whoever signs up through it joins your community and is
// credited to you, and so is anyone who signs up with an email you invited. You earn points when they join and
// more when they take their first shared ride; tiers count friends who actually rode. Underneath, the engine
// records a converted referral (the Refer step of the activation loop).
import { useState, type FormEvent } from 'react';
import { useInvites, useReferrals, useSendInvite, type Invite as InviteRow, type Referrals } from '../api/trips';
import { ErrorNote, Icon, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { useSession } from '../lib/session';

function inviteLink(code: string | null, email: string) {
  const q = new URLSearchParams({ email, ...(code ? { code } : {}) });
  return `${window.location.origin}/signup?${q}`;
}

function ShareBox({ invite, code, community, from }: { invite: InviteRow; code: string | null; community: string; from: string }) {
  const link = inviteLink(code, invite.email);
  const text = `${from} invited you to share rides on FellaRide (${community}). Sign up with ${invite.email}${code ? ` and join code ${code}` : ''}: ${link}`;
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }
  return (
    <div className="note note-ok stack" style={{ gap: 8 }} role="status">
      <span>Invite ready for <strong>{invite.name}</strong>. Send them this message:</span>
      <textarea readOnly value={text} rows={4} onFocus={(e) => e.currentTarget.select()} aria-label="Invite message"
        style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)', padding: 8, background: 'var(--paper)', color: 'var(--ink)', fontSize: 14 }} />
      <div className="btn-row">
        {'share' in navigator && <button className="btn btn-invite btn-small" onClick={() => navigator.share({ title: 'Join me on FellaRide', text }).catch(() => {})}>Share</button>}
        {window.isSecureContext && <button className="btn btn-quiet btn-small" onClick={copy}>{copied ? 'Copied' : 'Copy message'}</button>}
      </div>
    </div>
  );
}

function referralText(r: Referrals, from: string) {
  const link = `${window.location.origin}${r.link_path}`;
  return { link, text: `${from} invited you to share rides on FellaRide (${r.community}). Sign up with my link: ${link}` };
}

/** Your code and link, with one-tap sharing (WhatsApp, the phone's share sheet, or copy). */
function ReferralCard({ r }: { r: Referrals }) {
  const { session } = useSession();
  const { link, text } = referralText(r, session?.profile?.name?.split(' ')[0] ?? 'A friend');
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  async function copy(what: 'link' | 'code') {
    try { await navigator.clipboard.writeText(what === 'link' ? text : r.code); setCopied(what); } catch { setCopied(null); }
  }
  return (
    <section className="card stack referral-card" aria-labelledby="ref-h">
      <h2 id="ref-h" style={{ fontSize: 'var(--fs-h3)' }}>Your referral link</h2>
      <p className="small muted" style={{ marginTop: -8 }}>Anyone who signs up with it joins {r.community} and counts for you.</p>
      <div className="ref-code" aria-label={`Your referral code ${r.code.split('').join(' ')}`}>
        <span className="small muted">Your code</span>
        <strong className="num">{r.code}</strong>
      </div>
      <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Your referral link" className="ref-link" />
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <a className="btn btn-invite btn-small" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        {'share' in navigator && <button className="btn btn-quiet btn-small" onClick={() => navigator.share({ title: 'Join me on FellaRide', text, url: link }).catch(() => {})}>Share…</button>}
        {window.isSecureContext && <button className="btn btn-quiet btn-small" onClick={() => copy('link')}>{copied === 'link' ? 'Copied' : 'Copy link'}</button>}
        {window.isSecureContext && <button className="btn btn-quiet btn-small" onClick={() => copy('code')}>{copied === 'code' ? 'Copied' : 'Copy code'}</button>}
      </div>
    </section>
  );
}

/** Points, tier and how far it is to the next one. */
function Progress({ r }: { r: Referrals }) {
  const prevAt = [...r.tiers].reverse().find((t) => t.at <= r.rode)?.at ?? 0;
  const pct = r.tier.next_at ? Math.round(((r.rode - prevAt) / (r.tier.next_at - prevAt)) * 100) : 100;
  return (
    <section className="card stack" aria-labelledby="prog-h">
      <div className="section-head">
        <h3 id="prog-h">Your rewards</h3>
        <span className={`chip tier-${r.tier.name.toLowerCase()}`}>{Icon.trophy} {r.tier.name}</span>
      </div>
      <div className="ref-stats">
        <div><strong className="num">{r.joined}</strong><span className="small muted">{r.joined === 1 ? 'friend' : 'friends'} joined</span></div>
        <div><strong className="num">{r.rode}</strong><span className="small muted">took a first ride</span></div>
        <div><strong className="num">{r.points}</strong><span className="small muted">points</span></div>
      </div>
      {r.tier.next ? (
        <>
          <div className="ref-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Progress to ${r.tier.next}`}><i style={{ width: `${pct}%` }} /></div>
          <p className="small muted">{r.tier.next_at! - r.rode} more friend{r.tier.next_at! - r.rode === 1 ? '' : 's'} taking a first ride to reach <strong>{r.tier.next}</strong>.</p>
        </>
      ) : <p className="small">You’re at the top tier. Thank you for growing the community!</p>}
      <ol className="small ref-how">
        <li>Share your link or code.</li>
        <li>A friend signs up with it: <strong>+{r.points_per.joined} points</strong>.</li>
        <li>They take their first shared ride: <strong>+{r.points_per.first_ride} points</strong>.</li>
      </ol>
      <p className="small muted">Tiers: {r.tiers.filter((t) => t.at > 0).map((t) => `${t.name} at ${t.at}`).join(' · ')} friends who rode.</p>
    </section>
  );
}

function Friends({ r }: { r: Referrals }) {
  if (r.friends.length === 0) return <p className="small muted">Nobody has joined through you yet. Share your link with people who commute your way.</p>;
  return (
    <ul className="list-plain stagger">
      {r.friends.map((f, i) => (
        <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span><strong>{f.name}</strong><br /><span className="small muted">{f.source === 'link' ? 'Joined with your link' : 'Joined from your email invite'} · {new Date(f.joined_at).toLocaleDateString()}</span></span>
          <span className={`chip${f.stage === 'rode' ? ' chip-joined' : ''}`}>{f.stage === 'rode' ? 'First ride done' : 'Joined'}</span>
        </li>
      ))}
    </ul>
  );
}

function Leaderboard({ r, me }: { r: Referrals; me?: number }) {
  if (r.leaderboard.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="top-h">
      <h3 id="top-h">Top referrers in {r.community}</h3>
      <ol className="list-plain">
        {r.leaderboard.map((x, i) => (
          <li key={x.user_id} style={{ display: 'flex', justifyContent: 'space-between', fontWeight: x.user_id === me ? 700 : 400 }}>
            <span>{i + 1}. {x.name}{x.user_id === me ? ' (you)' : ''}</span>
            <span className="num">{x.joined} joined</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Invite() {
  const { session } = useSession();
  const invites = useInvites();
  const send = useSendInvite();
  const announce = useAnnounce();
  const [f, setF] = useState({ name: '', email: '' });
  const [last, setLast] = useState<InviteRow | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const inv = await send.mutateAsync({ name: f.name.trim(), email: f.email.trim() });
      setLast(inv);
      setF({ name: '', email: '' });
      announce(`Invite ready for ${inv.name}.`);
    } catch { /* shown below */ }
  }

  const data = invites.data;
  const refs = useReferrals();
  const joined = data?.invites.filter((i) => i.status === 'joined').length ?? 0;
  return (
    <>
      {refs.error && <ErrorNote error={refs.error} onRetry={() => refs.refetch()} />}
      {!refs.data ? (!refs.error && <Skeleton h={220} />) : (
        <>
          <ReferralCard r={refs.data} />
          <Progress r={refs.data} />
          <section aria-labelledby="friends-h" className="stack">
            <h3 id="friends-h" className="section-head">Friends you brought in</h3>
            <Friends r={refs.data} />
          </section>
          <Leaderboard r={refs.data} me={session?.user.id} />
        </>
      )}

      <section className="stack">
        <h2 style={{ fontSize: 'var(--fs-h3)' }}>Or invite someone by email</h2>
        <p className="muted small">They’re added to {data?.community ?? 'your community'} straight away. When they sign up with this email, it counts for you too.</p>
      </section>
      <form className="stack-lg" onSubmit={submit}>
        <label className="field">Their name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} maxLength={80} autoComplete="off" /></label>
        <label className="field">Their email<input type="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="off" /></label>
        <ErrorNote error={send.error} />
        <button className="btn btn-invite btn-block" disabled={send.isPending || f.name.trim().length < 2 || !f.email.includes('@')}>{send.isPending ? 'Inviting…' : 'Create invite'}</button>
      </form>
      {last && data && <ShareBox invite={last} code={data.join_code} community={data.community} from={session?.profile?.name ?? 'A friend'} />}

      <section aria-labelledby="sent-h">
        <div className="section-head">
          <h3 id="sent-h">Your email invites</h3>
          {joined > 0 && <span className="chip">{joined} joined</span>}
        </div>
        {invites.error && <ErrorNote error={invites.error} onRetry={() => invites.refetch()} />}
        {!data ? (!invites.error && <Skeleton h={80} />) : data.invites.length === 0 ? (
          <p className="small muted">No invites yet.</p>
        ) : (
          <ul className="list-plain stagger">
            {data.invites.map((i) => (
              <li key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span><strong>{i.name}</strong><br /><span className="small muted">{i.email}</span></span>
                <span className={`chip${i.status === 'joined' ? ' chip-joined' : ''}`}>{i.status === 'joined' ? 'Joined' : i.status === 'sent' ? 'Invited' : 'Expired'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
