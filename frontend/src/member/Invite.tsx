// Invite someone by email. They join as a "discovered" member of your community; when they sign up with that
// email the invite converts and you're credited as a referrer (the Refer step of the activation loop).
import { useState, type FormEvent } from 'react';
import { useInvites, useSendInvite, type Invite as InviteRow } from '../api/trips';
import { ErrorNote, Skeleton } from '../components/ui';
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
  const joined = data?.invites.filter((i) => i.status === 'joined').length ?? 0;
  return (
    <>
      <section className="stack">
        <h2 style={{ fontSize: 'var(--fs-h3)' }}>Invite people who commute your way</h2>
        <p className="muted small">They’re added to {data?.community ?? 'your community'} straight away. When they sign up with this email, the invite counts for you.</p>
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
          <h3 id="sent-h">Your invites</h3>
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
