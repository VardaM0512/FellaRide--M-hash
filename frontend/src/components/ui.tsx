import { animate } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePrefs } from '../lib/prefs';

/** Drivers are squares, riders circles, connectors get a ring. Colour is never the only signal. */
export function Glyph({ driver, connector = false, size = 14, color }: { driver: boolean; connector?: boolean; size?: number; color?: string }) {
  const fill = color || (driver ? 'var(--marigold)' : 'var(--peacock)');
  const s = size;
  return (
    <svg width={s + 6} height={s + 6} viewBox={`0 0 ${s + 6} ${s + 6}`} aria-hidden="true" style={{ flex: 'none' }}>
      {connector && <circle cx={(s + 6) / 2} cy={(s + 6) / 2} r={(s + 4) / 2} fill="none" stroke="var(--ink)" strokeWidth="1.5" />}
      {driver
        ? <rect x={3 + s * 0.15} y={3 + s * 0.15} width={s * 0.7} height={s * 0.7} rx="1.5" fill={fill} />
        : <circle cx={(s + 6) / 2} cy={(s + 6) / 2} r={s * 0.38} fill={fill} />}
    </svg>
  );
}

export function Skeleton({ w = '100%', h = 16, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong on our side. Please try again.';
  return (
    <div className="note note-error" role="alert" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <span>{message}</span>
      {onRetry && <button className="btn-link" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Avatar({ name, driver = false }: { name: string; driver?: boolean }) {
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <span className={`avatar${driver ? ' driver' : ''}`} aria-hidden="true">{initials}</span>;
}

/** A number that counts up to its value when it appears or changes (instant with reduced motion). */
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const { motionReduced } = usePrefs();
  const [shown, setShown] = useState(motionReduced ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (motionReduced) { setShown(value); from.current = value; return; }
    const c = animate(from.current, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    from.current = value;
    return () => c.stop();
  }, [value, motionReduced]);
  return <>{shown.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}</>;
}

export function Logo() {
  return (
    <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0B0B0C" />
      <path d="M12 36 C 26 36 32 26 50 22" stroke="#34D399" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M14 26 C 28 26 34 22 50 22" stroke="#F5A524" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <circle cx="50" cy="22" r="6" fill="#FFFFFF" />
    </svg>
  );
}

export const DemoTag = ({ show }: { show: boolean }) => (show ? <span className="chip chip-demo">Demo data</span> : null);

/** Bottom sheet on phones, side sheet on the dashboard. Esc closes, focus moves in and comes back. */
export function Sheet({ title, onClose, side = false, children }: { title: string; onClose: () => void; side?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, []);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div ref={ref} className={`sheet${side ? ' side' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        {!side && <div className="sheet-grab" />}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <h2 style={{ fontSize: 'var(--fs-h3)' }}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">{Icon.x}</button>
        </div>
        {children}
      </div>
    </>
  );
}

export function Sparkline({ values, color = 'var(--peacock)', width = 96, height = 28, label }: { values: number[]; color?: string; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <svg width={width} height={height} role="img" aria-label={label} />;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
}

export const Icon = {
  today: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>,
  ride: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 18c5 0 6-10 18-12" strokeLinecap="round" /><circle cx="3.5" cy="18" r="1.5" fill="currentColor" /><circle cx="20.5" cy="6" r="1.5" fill="currentColor" /></svg>,
  invite: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M18 8v6M15 11h6" strokeLinecap="round" /></svg>,
  me: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="5" cy="19" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><path d="M6.5 17.5l4-4M13.5 10.5l4-4" /></svg>,
  play: <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>,
  pause: <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /></svg>,
  prev: <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" fill="none" /></svg>,
  next: <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" fill="none" /></svg>,
  bell: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" strokeLinejoin="round" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>,
  back: <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg>,
  star: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" fill="currentColor" /></svg>,
  car: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 16V11l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  seat: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="7" r="3" /><path d="M6 21v-3a6 6 0 0 1 12 0v3" strokeLinecap="round" /></svg>,
  x: <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>,
  pin: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  arrow: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="arrow"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  clock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>,
  search: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  phone: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>,
  send: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>,
  people: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><circle cx="17" cy="9.5" r="2.5" /><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15 14.2c3 .1 6 1.6 6 4.8" /></svg>,
  leaf: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" /><path d="M5 19c3-4 6-6 9-8" /></svg>,
  trophy: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20h7l-1-3h-5z" /></svg>,
  flame: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4.5 2-7 2 1 3 3 3 5 1-2 1.5-5 1-9z" /></svg>,
  chat: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>,
  sun: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>,
  settings: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>,
};
