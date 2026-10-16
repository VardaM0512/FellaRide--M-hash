// Phones: every organiser page as a tile (the bottom bar has room for four).
import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';
import { useStations } from './OrgLayout';

export default function More() {
  const { groups, settings } = useStations();
  return (
    <>
      {[...groups, { name: 'Account', items: [settings] }].map((g) => (
        <section key={g.name} className="stack" aria-label={g.name}>
          <h2 className="metro-label on-light">{g.name}</h2>
          <div className="more-grid">
            {g.items.map((s) => (
              <Link key={s.to} to={s.to} className="shortcut">
                <span className="shortcut-icon">{s.icon}</span>
                <span><strong>{s.label}</strong>{s.note && <span className="small muted" style={{ display: 'block' }}>{s.note}</span>}</span>
                {s.badge ? <span className="side-badge">{s.badge}</span> : Icon.arrow}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
