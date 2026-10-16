// Announcements: write a notification, choose who gets it, see it as members will, and what was sent before.
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBroadcasts, useSendBroadcast, type Audience } from '../api/organiser';
import { ErrorNote, Logo, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { ago, displayName } from '../lib/format';
import { useSession } from '../lib/session';

const AUDIENCE: Record<Audience, { label: string; hint: string }> = {
  all: { label: 'Everyone', hint: 'Every member with the app' },
  drivers: { label: 'Drivers', hint: 'Members with a car saved' },
  riders: { label: 'Riders', hint: 'Members without a car' },
  new: { label: 'Not ridden yet', hint: 'Joined, but no shared ride so far' },
};

const TEMPLATES: { label: string; title: string; body: string; audience?: Audience }[] = [
  { label: 'First ride nudge', audience: 'new', title: 'Your first shared ride is waiting', body: 'People on your route are offering seats this week. Open Find a ride and ask for one: it takes a minute.' },
  { label: 'Drivers wanted', audience: 'drivers', title: 'Riders on your route need a seat', body: 'Offering a ride today helps a neighbour and covers your fuel. Post it from Offer a ride.' },
  { label: 'Road update', title: 'Main gate closed on Friday', body: 'Use the side gate for pickups and drops. Drivers, please update your route.' },
  { label: 'Thank you', title: 'Thank you for sharing rides', body: 'This week our community shared more rides than ever. Keep it going, and bring a friend along.' },
];

export default function Announce() {
  const [params] = useSearchParams();
  const initial = (params.get('audience') as Audience) in AUDIENCE ? (params.get('audience') as Audience) : 'all';
  const [audience, setAudience] = useState<Audience>(initial);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirm, setConfirm] = useState(false);
  const log = useBroadcasts();
  const send = useSendBroadcast();
  const announce = useAnnounce();
  const { session } = useSession();
  const reach = log.data?.audiences[audience];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!confirm) { setConfirm(true); return; }
    send.mutate({ title: title.trim(), body: body.trim(), audience }, {
      onSuccess: (r) => { announce(`Sent to ${r.sent} ${r.sent === 1 ? 'member' : 'members'}.`); setTitle(''); setBody(''); setConfirm(false); },
      onError: () => setConfirm(false),
    });
  }

  return (
    <div className="announce-grid">
      <section className="panel" aria-labelledby="compose-h">
        <h2 id="compose-h">New announcement</h2>
        <form className="stack" onSubmit={submit}>
          <div className="field" role="radiogroup" aria-labelledby="aud-l">
            <span id="aud-l">Who gets it</span>
            <div className="audience-pick">
              {(Object.keys(AUDIENCE) as Audience[]).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={audience === a} className="audience" onClick={() => { setAudience(a); setConfirm(false); }}>
                  <strong>{AUDIENCE[a].label}</strong>
                  <span className="small">{AUDIENCE[a].hint}</span>
                  <span className="num aud-n">{log.data ? log.data.audiences[a] : '…'}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="field"><span>Start from a template</span>
            <div className="reasons">
              {TEMPLATES.map((t) => (
                <button key={t.label} type="button" className="chip chip-toggle" onClick={() => { setTitle(t.title); setBody(t.body); if (t.audience) setAudience(t.audience); setConfirm(false); }}>{t.label}</button>
              ))}
            </div>
          </div>
          <label className="field">Title<input value={title} onChange={(e) => { setTitle(e.target.value); setConfirm(false); }} maxLength={120} placeholder="e.g. Main gate closed on Friday" required />
            <span className="hint">{title.length}/120</span></label>
          <label className="field">Message (optional)<textarea value={body} onChange={(e) => { setBody(e.target.value); setConfirm(false); }} maxLength={400} />
            <span className="hint">{body.length}/400</span></label>
          <ErrorNote error={send.error} />
          {reach === 0 && <p className="note note-info">No one is in this group yet, so nobody would get it.{session?.tenant.synthetic ? ' In this demo, a member gets announcements once someone has signed in as them (Try the demo community on the welcome page).' : ''}</p>}
          <button className={`btn ${confirm ? 'btn-confirm' : 'btn-primary'}`} disabled={!title.trim() || send.isPending || reach === 0}>
            {send.isPending ? 'Sending…' : confirm ? `Confirm: send to ${reach ?? ''} ${reach === 1 ? 'person' : 'people'}` : 'Send announcement'}
          </button>
          {confirm && <button type="button" className="btn-link small" onClick={() => setConfirm(false)}>Not yet</button>}
        </form>
      </section>

      <div className="stack-lg">
        <section className="panel preview-panel" aria-labelledby="prev-h">
          <h2 id="prev-h">What members see</h2>
          <div className="phone" aria-hidden="true">
            <div className="phone-notch" />
            <p className="phone-time">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
            <div className="notif">
              <Logo size={28} />
              <div>
                <p className="notif-app">FellaRide · {displayName(session?.tenant.name || '')}</p>
                <strong>{title.trim() || 'Your title shows here'}</strong>
                <p>{body.trim() || 'And your message underneath, in the app and as a phone notification.'}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="sent-h">
          <h2 id="sent-h">Sent before</h2>
          {!log.data ? (log.error ? <ErrorNote error={log.error} /> : <Skeleton h={120} />) : log.data.sent.length === 0 ? (
            <p className="small muted">Nothing sent yet. Announcements you send show up here.</p>
          ) : (
            <ul className="sent-list">
              {log.data.sent.map((b) => (
                <li key={b.id}>
                  <div className="section-head" style={{ marginBottom: 0 }}><strong>{b.title}</strong><span className="small muted">{ago(b.created_at)}</span></div>
                  {b.body && <p className="small">{b.body}</p>}
                  <div className="read-row">
                    <span className="read-bar" aria-hidden="true"><i style={{ width: `${b.sent ? (b.read / b.sent) * 100 : 0}%` }} /></span>
                    <span className="small"><strong>{b.read} of {b.sent}</strong> read{b.sent ? ` (${Math.round((b.read / b.sent) * 100)}%)` : ''}</span>
                  </div>
                  <span className="small muted">{AUDIENCE[b.audience]?.label ?? b.audience}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
