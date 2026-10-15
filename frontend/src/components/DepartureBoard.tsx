// Home's departure board: rides leaving near your usual pickup, shown like a station's split-flap board.
// Letters riffle through the alphabet and land one after another; with reduced motion they just appear.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDepartures, type Place, type Trip } from '../api/trips';
import { usePrefs } from '../lib/prefs';
import { minutesUntil } from '../lib/tripFormat';
import { Icon, Skeleton } from './ui';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const TICK = 55;

/** One word on the board. Screen readers get the text once, not the riffling letters. */
export function SplitFlap({ text, delay = 0 }: { text: string; delay?: number }) {
  const { motionReduced } = usePrefs();
  const [shown, setShown] = useState(motionReduced ? text : text.replace(/\S/g, ' '));
  useEffect(() => {
    if (motionReduced) { setShown(text); return; }
    let tick = 0;
    const settleAt = (i: number) => delay + 4 + i * 1.5;
    const id = window.setInterval(() => {
      tick += 1;
      setShown([...text].map((c, i) => (c === ' ' || tick >= settleAt(i) ? c : CHARS[Math.floor(Math.random() * CHARS.length)])).join(''));
      if (tick >= settleAt(text.length)) window.clearInterval(id);
    }, TICK);
    return () => window.clearInterval(id);
  }, [text, delay, motionReduced]);
  return (
    <span className="flaps">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">{[...shown].map((c, i) => <span key={`${i}${c}`} className={`flap${c === ' ' ? ' blank' : ''}`}>{c}</span>)}</span>
    </span>
  );
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** A destination as a board shows it: the whole name if it fits, otherwise its most specific words (the last ones). */
function board(name: string, n: number) {
  const words = name.split(',')[0].toUpperCase().split(/\s+/).filter((w) => /[A-Z0-9]/.test(w));
  if (words.join(' ').length <= n) return words.join(' ');
  let out = '';
  for (const w of [...words].reverse()) {
    const next = out ? `${w} ${out}` : w;
    if (next.length > n) break;
    out = next;
  }
  return out || words[words.length - 1].slice(0, n);
}

/** Wider screens fit longer names on the board. */
function useWide() {
  const q = '(min-width: 640px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(q).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);
  return <SplitFlap text={hhmm(now)} />;
}

function status(t: Trip): { text: string; tone: 'go' | 'live' | 'mine' | '' } {
  if (t.my_seat) return { text: 'Your seat', tone: 'mine' };
  if (t.status === 'started') return { text: 'On the way', tone: 'live' };
  const m = minutesUntil(t.depart_at);
  if (m <= 15) return { text: 'Boarding', tone: 'go' };
  if (m < 60) return { text: `In ${m} min`, tone: '' };
  const d = new Date(t.depart_at);
  return { text: d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }), tone: '' };
}

export default function DepartureBoard({ from }: { from: Place | null }) {
  const q = useDepartures(from);
  const all = q.data || [];
  const rows = [...all].sort((x, y) => x.depart_at.localeCompare(y.depart_at)).slice(0, 5);
  const wide = useWide();
  return (
    <section className="board" aria-labelledby="board-h">
      <header className="board-head">
        <div>
          <h3 id="board-h">Departures</h3>
          <p className="small">{from ? <>near {from.name.split(',')[0]}</> : 'near your pickup'}</p>
        </div>
        <Clock />
      </header>

      {!from ? (
        <Link to="/find" className="board-empty">
          <span>Set your usual pickup once, and the rides leaving near it show up here every time you open the app.</span>
          <span className="board-go" aria-hidden="true">{Icon.arrow}</span>
        </Link>
      ) : q.isLoading ? (
        <div className="stack" style={{ gap: 8 }}><Skeleton h={52} /><Skeleton h={52} /></div>
      ) : rows.length === 0 ? (
        <Link to="/offer" className="board-empty">
          <span>No departures near you right now. Driving somewhere? Post your ride and be first on the board.</span>
          <span className="board-go" aria-hidden="true">{Icon.arrow}</span>
        </Link>
      ) : (
        <ol className="board-rows">
          {rows.map((t, i) => {
            const st = status(t);
            return (
              <li key={t.id}>
                <Link to={`/trip/${t.id}`} state={{ pickup: from }} className="board-row"
                  aria-label={`${hhmm(new Date(t.depart_at))} to ${t.to.name.split(',')[0]}, ${t.driver.name} driving, ${t.seats_left} seats left, ${st.text}`}>
                  <span className="b-time"><SplitFlap text={hhmm(new Date(t.depart_at))} delay={i * 3} /></span>
                  <span className="b-dest">
                    <SplitFlap text={board(t.to.name, wide ? 20 : 11)} delay={i * 3 + 2} />
                    <span className="b-sub">{t.driver.name.split(' ')[0]} · {t.seats_left} seat{t.seats_left === 1 ? '' : 's'}{wide && <> · to {t.to.name.split(',')[0]}</>}</span>
                  </span>
                  <span className={`b-status ${st.tone}`}>{st.text}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
      {/* more drivers than fit on the board: compare them all on Find */}
      {from && all.length > rows.length && (
        <Link to="/find" className="btn-link small" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>
          See all {all.length} rides near you
        </Link>
      )}
    </section>
  );
}
