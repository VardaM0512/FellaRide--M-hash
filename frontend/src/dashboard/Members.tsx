// Members directory: everyone on the roster by stage, searchable and sortable, with a profile sheet and CSV export.
import { useMemo, useState } from 'react';
import { useMembers } from '../api/hooks';
import type { Member, MemberState } from '../api/types';
import { Avatar, ErrorNote, Glyph, Icon, Skeleton } from '../components/ui';
import { useAnnounce } from '../lib/announce';
import { STATE_LABEL } from '../lib/format';
import { OrgIcon } from './orgIcons';
import { MemberSheet } from './Panels';

const STAGES: MemberState[] = ['discovered', 'registered', 'interacted', 'first_ride', 'repeat', 'referrer'];
type Sort = 'rides' | 'name' | 'stage' | 'recent' | 'yes';
const SORTS: [Sort, string][] = [['rides', 'Most rides'], ['stage', 'Furthest along'], ['recent', 'Rode most recently'], ['yes', 'Says yes most'], ['name', 'Name A–Z']];
const PAGE = 60;

function toCsv(rows: Member[]) {
  const head = ['Name', 'Area', 'Destination', 'Leaves at', 'Travels as', 'Seats', 'Stage', 'Rides', 'Last ride day', 'Suggestions received', 'Said yes', 'Demo data'];
  const esc = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const body = rows.map((m) => [m.name, m.area, m.destination, m.depart_time, m.has_car ? 'Driver' : 'Rider', m.seats, STATE_LABEL[m.state], m.rides_count,
    m.last_ride_day ?? '', m.nudges_received, m.nudges_responded, m.synthetic ? 'yes' : 'no'].map(esc).join(','));
  return [head.join(','), ...body].join('\n');
}

export default function Members() {
  const q = useMembers();
  const announce = useAnnounce();
  const [stage, setStage] = useState<MemberState | 'all'>('all');
  const [role, setRole] = useState<'all' | 'drivers' | 'riders' | 'connectors'>('all');
  const [area, setArea] = useState('all');
  const [sort, setSort] = useState<Sort>('rides');
  const [text, setText] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<number | null>(null);
  const all = q.data || [];

  const areas = useMemo(() => [...new Set(all.map((m) => m.area))].sort(), [all]);
  const counts = useMemo(() => Object.fromEntries(STAGES.map((s) => [s, all.filter((m) => m.state === s).length])) as Record<MemberState, number>, [all]);
  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    const out = all.filter((m) => (stage === 'all' || m.state === stage)
      && (role === 'all' || (role === 'drivers' ? m.has_car : role === 'riders' ? !m.has_car : m.is_connector))
      && (area === 'all' || m.area === area)
      && (!t || m.name.toLowerCase().includes(t) || m.area.toLowerCase().includes(t) || (m.destination || '').toLowerCase().includes(t)));
    const rank = (s: MemberState) => STAGES.indexOf(s);
    const by: Record<Sort, (a: Member, b: Member) => number> = {
      rides: (a, b) => b.rides_count - a.rides_count || rank(b.state) - rank(a.state),
      stage: (a, b) => rank(b.state) - rank(a.state) || b.rides_count - a.rides_count,
      recent: (a, b) => (b.last_ride_day ?? -1) - (a.last_ride_day ?? -1),
      yes: (a, b) => b.nudges_responded / Math.max(1, b.nudges_received) - a.nudges_responded / Math.max(1, a.nudges_received),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return out.sort(by[sort]);
  }, [all, stage, role, area, text, sort]);

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `members-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
    announce(`Exported ${rows.length} members.`);
  }

  if (!q.data) return q.error ? <ErrorNote error={q.error} onRetry={() => q.refetch()} /> : <Skeleton h={480} />;
  const reset = () => { setStage('all'); setRole('all'); setArea('all'); setText(''); };

  return (
    <>
      <div className="segments" role="group" aria-label="Filter by stage">
        <button className="segment" aria-pressed={stage === 'all'} onClick={() => { setStage('all'); setShown(PAGE); }}>
          <span className="small">Everyone</span><strong className="num">{all.length}</strong><i aria-hidden="true"><b style={{ width: '100%' }} /></i>
        </button>
        {STAGES.map((s) => (
          <button key={s} className={`segment st-${s}`} aria-pressed={stage === s} onClick={() => { setStage(stage === s ? 'all' : s); setShown(PAGE); }}>
            <span className="small">{STATE_LABEL[s]}</span><strong className="num">{counts[s]}</strong>
            <i aria-hidden="true"><b style={{ width: `${all.length ? (counts[s] / all.length) * 100 : 0}%` }} /></i>
          </button>
        ))}
      </div>

      <section className="panel" aria-labelledby="dir-h">
        <h2 id="dir-h" className="sr-only">Member directory</h2>
        <div className="toolbar">
          <label className="search-box"><span aria-hidden="true">{Icon.search}</span><span className="sr-only">Search members</span>
            <input value={text} onChange={(e) => { setText(e.target.value); setShown(PAGE); }} placeholder="Search by name, area or destination" />
          </label>
          <label className="field compact"><span className="sr-only">Travels as</span>
            <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="all">Drivers and riders</option><option value="drivers">Drivers</option><option value="riders">Riders</option><option value="connectors">Well connected</option>
            </select>
          </label>
          <label className="field compact"><span className="sr-only">Area</span>
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="all">All areas</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="field compact"><span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <button className="btn btn-quiet btn-small" onClick={exportCsv} disabled={!rows.length}>{OrgIcon.download}Export CSV</button>
        </div>
        <p className="small muted" role="status">{rows.length === all.length ? `${all.length} people` : `${rows.length} of ${all.length} people`}
          {rows.length !== all.length && <> · <button className="btn-link small" onClick={reset}>Clear filters</button></>}</p>

        {rows.length === 0 ? <p className="muted">No one matches. Try fewer filters.</p> : (
          <div className="table-scroll members-table">
            <table className="data">
              <thead><tr><th scope="col">Member</th><th scope="col">Commute</th><th scope="col">Travels as</th><th scope="col">Stage</th>
                <th scope="col" className="r">Rides</th><th scope="col" className="r">Last ride</th><th scope="col" className="r">Said yes</th></tr></thead>
              <tbody>
                {rows.slice(0, shown).map((m) => (
                  <tr key={m.id} onClick={() => setSelected(m.id)} className="clickable">
                    <td><button className="who" onClick={(e) => { e.stopPropagation(); setSelected(m.id); }}>
                      <Avatar name={m.name} driver={m.has_car} /><span><strong>{m.name}</strong><span className="small muted">{m.area}</span></span></button></td>
                    <td>{m.destination} <span className="muted num">· {m.depart_time}</span></td>
                    <td><span className="travels"><Glyph driver={m.has_car} connector={m.is_connector} size={11} />{m.has_car ? `Drives (${m.seats})` : 'Rides'}</span></td>
                    <td><span className={`stage-pill st-${m.state}`}>{STATE_LABEL[m.state]}</span></td>
                    <td className="r num">{m.rides_count}</td>
                    <td className="r num">{m.last_ride_day !== null ? `Day ${m.last_ride_day}` : '—'}</td>
                    <td className="r num">{m.nudges_received ? `${m.nudges_responded}/${m.nudges_received}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > shown && <button className="btn btn-quiet" style={{ justifySelf: 'center' }} onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>}
      </section>
      {selected !== null && <MemberSheet id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
