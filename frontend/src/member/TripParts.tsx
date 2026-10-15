// Pieces of the ride screen: group chat (plus driver updates), rating the people you rode with, and reports.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useChat, useRate, useReport, useReportReasons, useSendChat, type Person, type ReportReason, type Trip } from '../api/trips';
import { ErrorNote, Icon, Sheet } from '../components/ui';
import { useAnnounce } from '../lib/announce';

const QUICK_UPDATES = ['I’m at the pickup point', 'Running 5 min late', 'Leaving in 5 min', 'Setting off now'];

export function Chat({ trip, isDriver, me }: { trip: Trip; isDriver: boolean; me: number }) {
  const chat = useChat(trip.id, true);
  const send = useSendChat();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const count = chat.data?.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [count]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    send.mutate({ tripId: trip.id, body: text.trim() }, { onSuccess: () => setText('') });
  }
  const live = trip.status === 'open' || trip.status === 'started';
  return (
    <section className="card" aria-labelledby="chat-h">
      <h3 id="chat-h">Ride chat</h3>
      {isDriver && live && (
        <div className="stack" style={{ gap: 6 }}>
          <p className="small muted">Send an update. Every rider gets it as a notification.</p>
          <div className="tags" style={{ justifyContent: 'flex-start' }}>
            {QUICK_UPDATES.map((u) => (
              <button key={u} type="button" className="chip chip-toggle" disabled={send.isPending} onClick={() => send.mutate({ tripId: trip.id, body: u, update: true })}>{u}</button>
            ))}
          </div>
        </div>
      )}
      <div className="chat-log" aria-live="polite">
        {count === 0 && <p className="small muted">No messages yet. Say where you’ll be waiting or what you’re wearing.</p>}
        {chat.data?.map((m) => (
          <div key={m.id} className={`bubble${m.user_id === me ? ' mine' : ''}`}>
            {m.user_id !== me && <span className="small" style={{ fontWeight: 700 }}>{m.name}</span>}
            <span>{m.body}</span>
            <span className="small muted">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-input">Message</label>
        <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message everyone in this ride" autoComplete="off" />
        <button className="btn btn-primary" disabled={send.isPending || !text.trim()} aria-label="Send">{Icon.send}</button>
      </form>
      <ErrorNote error={send.error || chat.error} />
    </section>
  );
}

const WORDS = ['', 'Bad', 'Not great', 'Okay', 'Good', 'Great'];

function RateOne({ trip, p }: { trip: Trip; p: Person & { role: string } }) {
  const rate = useRate();
  const announce = useAnnounce();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  return (
    <div className="rate-one">
      <p><strong>{p.name}</strong> <span className="small muted">· {p.role === 'driver' ? 'Driver' : 'Rider'}</span></p>
      <div className="stars" role="radiogroup" aria-label={`Rate ${p.name} out of 5`} style={{ justifyContent: 'flex-start' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}, ${WORDS[n]}`}
            className={`star small-star${n <= stars ? ' on' : ''}`} onClick={() => setStars(n)}>{Icon.star}</button>
        ))}
        <span className="small" style={{ alignSelf: 'center', fontWeight: 700 }}>{WORDS[stars]}</span>
      </div>
      {stars > 0 && (
        <div className="chat-form">
          <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={280} placeholder="Add a note (optional)" aria-label={`Note about ${p.name}`} />
          <button className="btn btn-primary" disabled={rate.isPending}
            onClick={() => rate.mutate({ tripId: trip.id, toId: p.id, stars, comment }, { onSuccess: () => announce(`Rated ${p.name}.`) })}>Send</button>
        </div>
      )}
      <ErrorNote error={rate.error} />
    </div>
  );
}

export function RatePanel({ trip }: { trip: Trip }) {
  const left = (trip.to_rate || []).filter((p) => !p.rated);
  return (
    <section className="card" aria-labelledby="rate-h" style={{ borderLeft: '6px solid var(--jamun)' }}>
      <h3 id="rate-h">How was the ride?</h3>
      <p className="small muted">Rate the people you travelled with. Recent ratings count the most.</p>
      {left.map((p) => <RateOne key={p.id} trip={trip} p={p} />)}
    </section>
  );
}

const CATEGORY_TITLE: Record<ReportReason['category'], string> = {
  safety: 'Safety', fraud: 'Money or identity', reliability: 'Reliability', conduct: 'Behaviour', other: 'Other',
};

export function ReportSheet({ trip, person, onClose }: { trip: Trip; person: Person; onClose: () => void }) {
  const reasons = useReportReasons();
  const report = useReport();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const toggle = (c: string) => setPicked((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  const groups = (Object.keys(CATEGORY_TITLE) as ReportReason['category'][])
    .map((cat) => [cat, (reasons.data || []).filter((r) => r.category === cat)] as const).filter(([, list]) => list.length);

  if (report.isSuccess) {
    return (
      <Sheet title="Report sent" onClose={onClose}>
        <p>Thanks. The organiser will review it{report.data.category === 'safety' ? ' as a safety issue first' : ''}. {person.name} isn’t told who reported them.</p>
        <p className="small muted">If you’re in danger right now, call your local emergency number.</p>
        <button className="btn btn-block" onClick={onClose}>Close</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={`Report ${person.name}`} onClose={onClose}>
      <p className="small muted">What happened? Choose everything that applies.</p>
      {groups.map(([cat, list]) => (
        <fieldset key={cat} className="reason-group">
          <legend>{CATEGORY_TITLE[cat]}</legend>
          <div className="tags" style={{ justifyContent: 'flex-start' }}>
            {list.map((r) => (
              <button key={r.code} type="button" className="chip chip-toggle" aria-pressed={picked.includes(r.code)} onClick={() => toggle(r.code)}>{r.label}</button>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="field">Anything else? (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </label>
      <ErrorNote error={report.error || reasons.error} />
      <div className="btn-row">
        <button className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" style={{ background: 'var(--chilli)', color: '#fff' }} disabled={!picked.length || report.isPending}
          onClick={() => report.mutate({ trip_id: trip.id, reported_id: person.id, reasons: picked, note })}>{report.isPending ? 'Sending…' : 'Send report'}</button>
      </div>
    </Sheet>
  );
}
