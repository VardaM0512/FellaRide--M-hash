// Sponsored banners on the home screen: four slides that move on every few seconds. Pauses while you hover,
// touch or focus it (and when the tab is hidden); swipe, the arrows or the dots pick a slide. With Reduce motion
// on, it doesn't move by itself.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { usePrefs } from '../lib/prefs';

export interface Ad { src: string; alt: string }

export const ADS: Ad[] = [
  { src: '/ads/ad-1.svg', alt: 'The Corner Café: 20% off your morning coffee when you show your FellaRide ride.' },
  { src: '/ads/ad-2.svg', alt: 'GreenCharge EV: your first charge is on us, at fast chargers near campus and the tech park.' },
  { src: '/ads/ad-3.svg', alt: 'Weekend Car Care: a free check-up for drivers, tyres, brakes and AC.' },
  { src: '/ads/ad-4.svg', alt: 'City Book Fair: student passes at half price this weekend.' },
];
const EVERY_MS = 4000;

export default function AdCarousel({ ads = ADS }: { ads?: Ad[] }) {
  const { motionReduced } = usePrefs();
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const startX = useRef<number | null>(null);
  const n = ads.length;
  const go = (k: number) => setI(((k % n) + n) % n);

  useEffect(() => {
    if (held || motionReduced || n < 2) return;
    const t = setInterval(() => { if (!document.hidden) setI((k) => (k + 1) % n); }, EVERY_MS);
    return () => clearInterval(t);
  }, [held, motionReduced, n, i]);   // i: a manual pick restarts the timer

  const down = (e: PointerEvent) => { startX.current = e.clientX; setHeld(true); };
  const up = (e: PointerEvent) => {
    if (startX.current !== null) {
      const dx = e.clientX - startX.current;
      if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
    }
    startX.current = null;
    if (e.pointerType !== 'mouse') setHeld(false);
  };

  return (
    <section className="ads" aria-roledescription="carousel" aria-label="Sponsored offers"
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <div className="ads-viewport" onPointerDown={down} onPointerUp={up} onPointerCancel={() => { startX.current = null; setHeld(false); }}>
        <div className="ads-track" style={{ transform: `translateX(-${i * 100}%)` }}>
          {ads.map((a, k) => (
            <div key={a.src} className="ads-slide" role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`} aria-hidden={k !== i}>
              <img src={a.src} alt={a.alt} draggable={false} loading={k === 0 ? 'eager' : 'lazy'} />
            </div>
          ))}
        </div>
        <span className="ads-tag">Sponsored</span>
        <button type="button" className="ads-arrow prev" onClick={() => go(i - 1)} aria-label="Previous offer">‹</button>
        <button type="button" className="ads-arrow next" onClick={() => go(i + 1)} aria-label="Next offer">›</button>
      </div>
      <div className="ads-dots" role="group" aria-label="Choose an offer">
        {ads.map((a, k) => (
          <button key={a.src} type="button" aria-label={`Offer ${k + 1}`} aria-pressed={k === i} onClick={() => go(k)}>
            {k === i && !held && !motionReduced && <i key={i} style={{ animationDuration: `${EVERY_MS}ms` }} />}
          </button>
        ))}
      </div>
    </section>
  );
}
