// Community: this week's shared challenge, what the community has achieved, a board where members post, react
// and reply (asking for rides, offering seats, thanking someone), live ride activity, and a friendly leaderboard.
import { AnimatePresence, motion } from 'framer-motion';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  useComment, useComments, useCreatePost, useDeletePost, useFeed, useLeaderboard, useOverview, useReact,
  type Emoji, type FeedItem, type Metric, type Period, type Post, type PostKind,
} from '../api/community';
import { Avatar, CountUp, ErrorNote, Icon, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { ago } from '../lib/format';

export const KIND: Record<PostKind, { label: string; hint: string }> = {
  update: { label: 'Update', hint: 'Share news, road works or anything useful' },
  ask: { label: 'Need a ride', hint: 'Where and when you need to go' },
  offer: { label: 'Offering seats', hint: 'Your route, time and free seats' },
  thanks: { label: 'Thank you', hint: 'Say thanks to someone you rode with' },
  tip: { label: 'Tip', hint: 'A pickup spot, a shortcut, a parking tip' },
};
export const EMOJI: Record<Emoji, { char: string; label: string }> = {
  thumbs: { char: '👍', label: 'Like' }, heart: { char: '❤️', label: 'Love' },
  party: { char: '🎉', label: 'Celebrate' }, thanks: { char: '🙏', label: 'Thanks' },
};

// ---------- challenge and numbers ----------
export function ChallengeCard({ compact = false }: { compact?: boolean }) {
  const ov = useOverview();
  if (ov.error) return compact ? null : <ErrorNote error={ov.error} onRetry={() => ov.refetch()} />;
  if (!ov.data) return <Skeleton h={compact ? 120 : 170} />;
  const c = ov.data.challenge;
  const pct = Math.min(100, Math.round((c.progress / c.goal) * 100));
  const done = c.progress >= c.goal;
  return (
    <section className="challenge" aria-labelledby="challenge-h">
      <div className="challenge-top">
        <span className="small" style={{ fontWeight: 600 }}>Weekly challenge</span>
        <span className="small">{c.days_left} day{c.days_left === 1 ? '' : 's'} left</span>
      </div>
      <h2 id="challenge-h">{done ? 'Challenge complete!' : c.title}</h2>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={c.goal} aria-valuenow={c.progress}
        aria-valuetext={`${c.progress} of ${c.goal} rides shared`}>
        <motion.span initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
      </div>
      <p className="challenge-foot">
        <span><strong className="num"><CountUp value={c.progress} /></strong> of {c.goal} rides · {c.seats_filled} seat{c.seats_filled === 1 ? '' : 's'} filled</span>
        {!compact && <span className="small">Last week: {c.last_week}</span>}
      </p>
      {compact && <Link to="/community" className="btn btn-small btn-light">See the community {Icon.arrow}</Link>}
    </section>
  );
}

function Stats() {
  const ov = useOverview();
  if (!ov.data) return <Skeleton h={92} />;
  const s = ov.data.stats;
  const items = [
    { value: s.members, label: 'members' },
    { value: s.rides_total, label: 'rides shared' },
    { value: s.co2_kg, label: 'kg CO₂ saved (est.)' },
    { value: s.km_total, label: 'km shared' },
  ];
  return (
    <ul className="stat-strip" aria-label="What the community has done">
      {items.map((i) => (
        <li key={i.label} className="stat-tile">
          <strong className="num"><CountUp value={i.value} /></strong>
          <span className="small">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- composer ----------
function Composer() {
  const create = useCreatePost();
  const announce = useAnnounce();
  const [kind, setKind] = useState<PostKind>('update');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    create.mutate({ kind, body: body.trim() }, {
      onSuccess: () => { setBody(''); setOpen(false); setKind('update'); announce('Posted to the community.'); },
    });
  }
  if (!open) {
    return (
      <button type="button" className="composer-collapsed" onClick={() => setOpen(true)} aria-expanded="false" aria-controls={`${id}-form`}>
        <span className="composer-plus" aria-hidden="true">+</span>
        Share something with the community…
      </button>
    );
  }
  return (
    <motion.form id={`${id}-form`} className="card composer" onSubmit={submit} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <fieldset className="reason-group">
        <legend>What kind of post?</legend>
        <div className="tags" style={{ justifyContent: 'flex-start' }}>
          {(Object.keys(KIND) as PostKind[]).map((k) => (
            <button key={k} type="button" className="chip chip-toggle" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND[k].label}</button>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span className="sr-only">Your post</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder={KIND[kind].hint} autoFocus
          aria-describedby={`${id}-count`} />
        <span id={`${id}-count`} className="hint" style={{ textAlign: 'right' }}>{500 - body.length} characters left</span>
      </label>
      <ErrorNote error={create.error} />
      <div className="btn-row">
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn btn-primary btn-small" disabled={!body.trim() || create.isPending}>{create.isPending ? 'Posting…' : 'Post'}</button>
      </div>
    </motion.form>
  );
}

// ---------- one post ----------
function Replies({ post }: { post: Post }) {
  const list = useComments(post.id, true);
  const send = useComment();
  const [text, setText] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) send.mutate({ id: post.id, body: text.trim() }, { onSuccess: () => { setText(''); list.refetch(); } });
  }
  return (
    <motion.div className="replies" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      {list.isLoading && <Skeleton h={40} />}
      <ul className="list-plain">
        {list.data?.map((c) => (
          <li key={c.id} className="reply">
            <Avatar name={c.author} />
            <div><p><strong>{c.author}</strong> <span className="small muted">· {ago(c.created_at)}</span></p><p>{c.body}</p></div>
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Write a reply" aria-label={`Reply to ${post.author}`} />
        <button className="btn btn-primary" disabled={!text.trim() || send.isPending} aria-label="Send reply">{Icon.send}</button>
      </form>
      <ErrorNote error={send.error || list.error} />
    </motion.div>
  );
}

function PostCard({ post }: { post: Post }) {
  const react = useReact();
  const del = useDeletePost();
  const announce = useAnnounce();
  const [showReplies, setShowReplies] = useState(false);
  const action = post.kind === 'ask' ? { to: '/offer', label: 'Offer a ride' } : post.kind === 'offer' ? { to: '/find', label: 'Find a ride' } : null;
  return (
    <article className={`card post kind-${post.kind}`} aria-label={`${KIND[post.kind].label} from ${post.author}`}>
      <header className="post-head">
        <Avatar name={post.author} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p><strong>{post.author}</strong></p>
          <p className="small muted"><span className={`kind-tag kind-${post.kind}`}>{KIND[post.kind].label}</span> · <time dateTime={post.created_at}>{ago(post.created_at)}</time></p>
        </div>
        {post.mine && (
          <button className="icon-btn" aria-label="Delete your post" disabled={del.isPending}
            onClick={() => window.confirm('Delete this post?') && del.mutate(post.id, { onSuccess: () => announce('Post deleted.') })}>{Icon.trash}</button>
        )}
      </header>
      <p className="post-body">{post.body}</p>
      {action && <Link to={action.to} className="btn btn-quiet btn-small" style={{ justifySelf: 'start' }}>{action.label} {Icon.arrow}</Link>}
      <div className="post-actions">
        <div className="reactions" role="group" aria-label="Reactions">
          {(Object.keys(EMOJI) as Emoji[]).map((e) => {
            const on = post.my_reactions.includes(e);
            const n = post.reactions[e];
            return (
              <button key={e} type="button" className={`react${on ? ' on' : ''}`} aria-pressed={on}
                aria-label={`${EMOJI[e].label}${n ? `, ${n}` : ''}`} onClick={() => react.mutate({ id: post.id, emoji: e })}>
                <motion.span key={`${e}-${on}`} initial={on ? { scale: 0.4 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 15 }} aria-hidden="true">{EMOJI[e].char}</motion.span>
                {n > 0 && <span className="num" aria-hidden="true">{n}</span>}
              </button>
            );
          })}
        </div>
        <button type="button" className="react" aria-expanded={showReplies} onClick={() => setShowReplies((v) => !v)}>
          {Icon.chat} <span>{post.comments || ''} {post.comments === 1 ? 'reply' : post.comments ? 'replies' : 'Reply'}</span>
        </button>
      </div>
      <AnimatePresence>{showReplies && <Replies post={post} />}</AnimatePresence>
    </article>
  );
}

const ACTIVITY_ICON = { ride: Icon.car, join: Icon.people, invite: Icon.invite };

function Board() {
  const [show, setShow] = useState<'all' | 'posts' | 'activity'>('all');
  const feed = useFeed(show);
  return (
    <div className="stack-lg">
      <Composer />
      <div className="segmented" role="group" aria-label="Show">
        {(['all', 'posts', 'activity'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}>{s === 'all' ? 'Everything' : s === 'posts' ? 'Posts' : 'Ride activity'}</button>
        ))}
      </div>
      {feed.error && <ErrorNote error={feed.error} onRetry={() => feed.refetch()} />}
      {!feed.data ? <div className="stack"><Skeleton h={150} /><Skeleton h={64} /><Skeleton h={150} /></div> : feed.data.items.length === 0 ? (
        <div className="empty"><span className="empty-icon">{Icon.people}</span><strong style={{ color: 'var(--ink)' }}>It’s quiet here</strong>
          <p className="small">Be the first to post. Ask for a ride, offer your seats or share a tip.</p></div>
      ) : (
        <ul className="feed" aria-label="Community feed">
          <AnimatePresence initial={false}>
            {feed.data.items.map((item: FeedItem) => (
              <motion.li key={`${item.type}-${item.id}`} layout="position" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
                {item.type === 'post' ? <PostCard post={item} /> : (
                  <div className="activity">
                    <span className={`activity-icon a-${item.kind}`}>{ACTIVITY_ICON[item.kind]}</span>
                    <p><span>{item.text}</span><br /><span className="small muted">Day {item.day} · {ago(item.created_at)}</span></p>
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

// ---------- leaderboard ----------
const METRIC: Record<Metric, { label: string; unit: (v: number) => string }> = {
  rides: { label: 'Rides', unit: (v) => `${v} ride${v === 1 ? '' : 's'}` },
  co2: { label: 'CO₂ saved', unit: (v) => `${v} kg` },
  people: { label: 'People met', unit: (v) => `${v} ${v === 1 ? 'person' : 'people'}` },
};

function Leaderboard() {
  const [period, setPeriod] = useState<Period>('week');
  const [metric, setMetric] = useState<Metric>('rides');
  const board = useLeaderboard(period, metric);
  const rows = board.data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const podium = rows.slice(0, 3);
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 10 }}>
        <div className="segmented full" role="group" aria-label="Period">
          <button type="button" aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>This week</button>
          <button type="button" aria-pressed={period === 'all'} onClick={() => setPeriod('all')}>All time</button>
        </div>
        <div className="tags" style={{ justifyContent: 'flex-start' }} role="group" aria-label="Rank by">
          {(Object.keys(METRIC) as Metric[]).map((m) => (
            <button key={m} type="button" className="chip chip-toggle" aria-pressed={metric === m} onClick={() => setMetric(m)}>{METRIC[m].label}</button>
          ))}
        </div>
      </div>
      {board.error && <ErrorNote error={board.error} onRetry={() => board.refetch()} />}
      {!board.data ? <Skeleton h={300} /> : rows.length === 0 ? (
        <div className="empty"><span className="empty-icon">{Icon.trophy}</span><strong style={{ color: 'var(--ink)' }}>No rides yet {period === 'week' ? 'this week' : ''}</strong>
          <p className="small">Share a ride and you’ll be the first on the board.</p></div>
      ) : (
        <>
          {podium.length === 3 && (
            <ol className="podium" aria-label="Top three">
              {[podium[1], podium[0], podium[2]].map((r, i) => (
                <motion.li key={`${period}-${metric}-${r.rank}`} className={`place p${r.rank}${r.me ? ' me' : ''}`}
                  initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: [0.15, 0, 0.3][i], type: 'spring', stiffness: 260, damping: 22 }}>
                  <Avatar name={r.name} />
                  <strong>{r.name.split(' ')[0]}{r.me ? ' (you)' : ''}</strong>
                  <span className="small">{METRIC[metric].unit(r.value)}</span>
                  <span className="plinth" aria-hidden="true">{r.rank}</span>
                  <span className="sr-only">Rank {r.rank}</span>
                </motion.li>
              ))}
            </ol>
          )}
          <ol className="ranks" aria-label="Leaderboard">
            {rows.slice(podium.length === 3 ? 3 : 0).map((r, i) => (
              <motion.li key={`${period}-${metric}-${r.rank}`} className={r.me ? 'me' : ''} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                <span className="rank num">{r.rank}</span>
                <Avatar name={r.name} />
                <span className="rank-main">
                  <strong>{r.name}{r.me ? ' (you)' : ''}</strong>
                  <span className="bar" aria-hidden="true"><motion.i initial={{ width: 0 }} animate={{ width: `${(r.value / max) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.04 }} /></span>
                </span>
                <span className="num rank-val">{METRIC[metric].unit(r.value)}</span>
              </motion.li>
            ))}
          </ol>
          {board.data.me && !rows.some((r) => r.me) && <p className="note note-info">You’re <strong>#{board.data.me.rank}</strong> with {METRIC[metric].unit(board.data.me.value)}. Keep going!</p>}
          {!board.data.me && <p className="note note-info">Share a ride {period === 'week' ? 'this week ' : ''}to get on the leaderboard.</p>}
          <p className="small muted">CO₂ is an estimate: about 0.12 kg for every km a car stays at home.</p>
        </>
      )}
    </div>
  );
}

// ---------- the screen ----------
type Tab = 'board' | 'leaders';
export default function Community() {
  const [tab, setTab] = useState<Tab>('board');
  const tabs: [Tab, string][] = [['board', 'Board'], ['leaders', 'Leaderboard']];
  // arrow keys move between tabs, as screen reader users expect from a tab list
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tab === 'board' ? 'leaders' : 'board';
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }
  return (
    <div className="community-layout">
      <aside className="rail stack-lg" aria-label="This week in the community">
        <ChallengeCard />
        <Stats />
      </aside>
      <div className="main-col stack-lg">
      <div className="segmented full" role="tablist" aria-label="Community" onKeyDown={onKey}>
        {tabs.map(([t, label]) => (
          <button key={t} id={`tab-${t}`} type="button" role="tab" aria-selected={tab === t} aria-pressed={tab === t}
            aria-controls={`panel-${t}`} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'board' ? <Board /> : <Leaderboard />}
      </div>
      </div>
    </div>
  );
}
