// Live location during a ride: while `on`, watch the phone's position and send the newest point to the ride
// every few seconds. Only the driver and confirmed riders call this, and only while the ride is being tracked.
import { useEffect, useRef, useState } from 'react';
import { request } from '../api/client';

export type ShareState = 'off' | 'starting' | 'on' | 'denied' | 'unavailable';
const EVERY_MS = 4000;

export function useLiveShare(tripId: number, on: boolean): ShareState {
  const [state, setState] = useState<ShareState>('off');
  const last = useRef(0);
  useEffect(() => {
    if (!on) { setState('off'); return; }
    if (!('geolocation' in navigator)) { setState('unavailable'); return; }
    setState('starting');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setState('on');
        const t = Date.now();
        if (t - last.current < EVERY_MS) return;
        last.current = t;
        const { latitude, longitude, heading, speed } = pos.coords;
        request(`/trips/${tripId}/location`, {
          method: 'POST',
          body: {
            lat: +latitude.toFixed(6), lon: +longitude.toFixed(6),
            heading: heading != null && !Number.isNaN(heading) ? Math.round(heading) % 360 : null,
            speed_kmh: speed != null && !Number.isNaN(speed) ? Math.min(250, +(speed * 3.6).toFixed(1)) : null,
          },
        }).catch(() => { /* the next fix tries again */ });
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tripId, on]);
  return state;
}
