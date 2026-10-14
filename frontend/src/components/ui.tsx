import { useEffect, useRef, type ReactNode } from 'react';
import { ApiError } from '../api/client';

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

export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;

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
          <button className="btn btn-quiet" onClick={onClose} style={{ minHeight: 36, padding: '0 12px' }}>Close</button>
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
  check: <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" /></svg>,
};
