// Your community: the app names the one you're in — in the sidebar on laptops, under the title in the app bar
// on phones, where the sidebar isn't shown — and either name opens this sheet to move to another one: the open
// community everyone can join, or a college, company or society whose join code you have.
// You belong to one at a time: it decides the rides, board and leaderboard you see.
// AppLayout owns the open state and renders the sheet itself, outside the app bar (its z-index would trap it).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { switchCommunity, useMyCommunity, type CommunityBrief } from '../api/community';
import { lookupJoinCode } from '../api/hooks';
import type { Community } from '../api/types';
import { ErrorNote, Icon, Sheet, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { useSession } from '../lib/session';

const KIND_LABEL: Record<string, string> = {
  university: 'College or university', school: 'School', company: 'Company',
  society: 'Housing society', public: 'Open to everyone',
};
const kindLabel = (c: { kind: string; open: boolean }) => KIND_LABEL[c.kind] ?? (c.open ? 'Open to everyone' : 'Community');
const people = (n: number) => `${n} ${n === 1 ? 'member' : 'members'}`;
const rides = (n: number) => `${n} ${n === 1 ? 'ride' : 'rides'} shared by you`;

/** The community's name where the app already shows it, now as a button into the switcher.
 *  `sidebar` is the laptop sidebar's line; `appbar` is the line under the title, which is what phones have. */
export default function CommunityName({ where, onOpen }: { where: 'sidebar' | 'appbar'; onOpen: () => void }) {
  const { session } = useSession();
  const tenant = session?.tenant;
  if (!tenant) return null;
  const label = `Your community: ${tenant.name}. Open to see it or switch community.`;
  if (where === 'appbar') {
    return (
      <button type="button" className="sub" onClick={onOpen} aria-haspopup="dialog" aria-label={label}>
        {tenant.name}
      </button>
    );
  }
  return (
    <button type="button" className="line-name" onClick={onOpen} aria-haspopup="dialog" aria-label={label}>
      <span className="line-swatch" aria-hidden="true" />
      <span>{tenant.name}</span>
    </button>
  );
}

function Brief({ c }: { c: CommunityBrief }) {
  return <span className="small">{kindLabel(c)} · {people(c.members)}</span>;
}

export function CommunitySheet({ onClose }: { onClose: () => void }) {
  const q = useMyCommunity();
  const { signIn } = useSession();
  const announce = useAnnounce();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Community | null>(null);
  const [busy, setBusy] = useState<'open' | 'code' | null>(null);
  const [error, setError] = useState<unknown>(null);

  // a typed join code: show whose community it is before anyone moves into it
  useEffect(() => {
    if (code.length < 4) { setFound(null); return; }
    const t = window.setTimeout(() => { lookupJoinCode(code).then(setFound).catch(() => setFound(null)); }, 400);
    return () => window.clearTimeout(t);
  }, [code]);

  async function move(joinCode: string | undefined, which: 'open' | 'code') {
    setBusy(which); setError(null);
    try {
      const s = await switchCommunity(joinCode);
      onClose();
      signIn(s);                                   // a fresh session: every screen reloads for the new community
      announce(`You're now in ${s.tenant.name}.`);
      navigate('/', { replace: true });
    } catch (err) { setError(err); setBusy(null); }
  }

  if (!q.data) return <Sheet title="Your community" onClose={onClose}><Skeleton h={140} /></Sheet>;
  const { current, blocked, open_community } = q.data;
  const sameAgain = !!found && found.id === current.id;
  return (
    <Sheet title="Your community" onClose={onClose}>
      <div className="stack">
        <div className="picked">
          {Icon.check}
          <span>
            <strong>{current.name}</strong><br />
            <Brief c={current} /> · <span className="small">{rides(current.your_rides)}</span>
            {current.destinations.length > 0 && <><br /><span className="small muted">Rides to {current.destinations.join(', ')}</span></>}
            {current.join_code && <><br /><span className="small muted">Join code <strong>{current.join_code}</strong> — share it to bring people in.</span></>}
          </span>
        </div>
        <p className="small muted">
          You see the rides, board and leaderboard of this community. If you move, it keeps the rides you shared there;
          your account, rating and past rides stay with you, and coming back gives you your place in it again.
        </p>

        {blocked ? <p className="note note-info">{blocked}</p> : (
          <>
            {open_community && (
              <button type="button" className="btn btn-quiet btn-block" disabled={!!busy}
                onClick={() => move(undefined, 'open')}>
                {busy === 'open' ? 'Moving…' : `Move to ${open_community.name} · ${people(open_community.members)}`}
              </button>
            )}
            <form className="stack" onSubmit={(e) => { e.preventDefault(); if (!sameAgain) move(code, 'code'); }}>
              <label className="field">Move with a join code
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={16}
                  placeholder="e.g. DEMO2026" className="code-input" aria-describedby="cc-found" />
                <span className="hint">The code from another college, company or society.</span>
              </label>
              <p id="cc-found" className="small" role="status">
                {sameAgain ? 'That’s the community you’re already in.'
                  : found ? <><strong>{found.name}</strong> — {found.destinations.length} stop{found.destinations.length === 1 ? '' : 's'} ✓</>
                  : code.length >= 4 ? 'Checking that code…' : ''}
              </p>
              <button className="btn btn-primary btn-block" disabled={!!busy || code.length < 4 || sameAgain}>
                {busy === 'code' ? 'Moving…' : found && !sameAgain ? `Move to ${found.name}` : 'Move with this code'}
              </button>
            </form>
          </>
        )}
        <ErrorNote error={error} />
      </div>
    </Sheet>
  );
}
