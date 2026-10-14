// Route overlap as a picture, not a percentage: your thread from home to your destination,
// partners' threads alongside. A driver's thread bends through your home and merges with yours.
import type { LatLon } from '../lib/geo';
import { makeProjection } from '../lib/geo';

interface Partner { home: LatLon; drives: boolean; highlight?: boolean }

export default function ThreadPicture({ me, dest, destName, partners, iDrive, height = 96, label }: {
  me: LatLon; dest: LatLon; destName: string; partners: Partner[]; iDrive: boolean; height?: number; label: string;
}) {
  const W = 340;
  const project = makeProjection([me, dest, ...partners.map((p) => p.home)], W, height, 18);
  const [mx, my] = project(me);
  const [dx, dy] = project(dest);
  const curve = (ax: number, ay: number, bx: number, by: number) => {
    const cx = ax + (bx - ax) * 0.5;
    return `M${ax},${ay} C${cx},${ay} ${cx},${by} ${bx},${by}`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={label} style={{ display: 'block', overflow: 'visible' }}>
      {partners.map((p, i) => {
        const [px, py] = project(p.home);
        const color = p.drives ? 'var(--marigold)' : 'var(--peacock)';
        const width = p.highlight ? 3.5 : 2;
        const opacity = p.highlight ? 1 : 0.45;
        // the driver's car passes through the rider's home, then both share the rest of the route
        const d = p.drives && !iDrive
          ? `${curve(px, py, mx, my)} ${curve(mx, my, dx, dy).replace('M', 'L')}`
          : iDrive
            ? `M${mx},${my} ${curve(px, py, dx, dy).replace('M', 'L')}`
            : curve(px, py, dx, dy);
        return (
          <g key={i} opacity={opacity}>
            <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" />
            {p.drives
              ? <rect x={px - 5} y={py - 5} width="10" height="10" rx="1.5" fill={color} />
              : <circle cx={px} cy={py} r="5" fill={color} />}
          </g>
        );
      })}
      <path d={curve(mx, my, dx, dy)} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <circle cx={mx} cy={my} r="6" fill="var(--ink)" />
      <circle cx={mx} cy={my} r="2.5" fill="var(--paper)" />
      <circle cx={dx} cy={dy} r="8" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
      <text x={dx - 12} y={dy + 22} fontSize="12" fill="var(--fog)" textAnchor="middle">{destName}</text>
    </svg>
  );
}
