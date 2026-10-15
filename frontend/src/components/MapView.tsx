// A real street map (OpenStreetMap tiles via Leaflet). Shows start, end and pickup dots and one or more
// routes; optional tap-to-pick and tap-a-route. Dots are drawn shapes, so no marker images are needed.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface MapPoint { lat: number; lon: number; kind: 'from' | 'to' | 'pickup' | 'me' | 'car' | 'rider'; label?: string; heading?: number | null }
export interface MapRoute { id: number; coords: [number, number][]; selected?: boolean }

// vermilion start, ink end, cobalt pickup, grey you
const COLORS: Record<MapPoint['kind'], string> = { from: '#B4532A', to: '#101418', pickup: '#1A66BD', me: '#5A616B', car: '#C9973A', rider: '#1A66BD' };
const LIVE_KINDS: MapPoint['kind'][] = ['car', 'rider'];   // these move: drawn as live markers and never re-fit the map
const dark = () => document.documentElement.dataset.theme === 'dark';

export default function MapView({ points = [], routes = [], center, onPick, onRouteClick, height = 260, label }: {
  points?: MapPoint[]; routes?: MapRoute[]; center?: { lat: number; lon: number };
  onPick?: (p: { lat: number; lon: number }) => void; onRouteClick?: (id: number) => void; height?: number; label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const lastFit = useRef('');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(
      [center?.lat ?? 12.9716, center?.lon ?? 77.5946], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pick.current?.({ lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) }));
    m.attributionControl.setPrefix(false);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // the map is created while its page is still sliding in; re-measure whenever the box changes size
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    // unselected routes first so the chosen one draws on top
    [...routes].sort((a, b) => Number(!!a.selected) - Number(!!b.selected)).forEach((r) => {
      if (r.selected) L.polyline(r.coords, { color: dark() ? '#000' : '#fff', weight: 10, opacity: 0.9, interactive: false }).addTo(g);
      const line = L.polyline(r.coords, {
        color: r.selected ? (dark() ? '#6AA8F0' : '#1A66BD') : '#8A8B86', weight: r.selected ? 5 : 4, opacity: r.selected ? 1 : 0.6,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(g);
      if (onRouteClick) line.on('click', (e) => { L.DomEvent.stopPropagation(e); onRouteClick(r.id); });
    });
    points.forEach((p) => {
      if (LIVE_KINDS.includes(p.kind)) {
        const html = p.kind === 'car'
          ? `<span class="live-car" style="--h:${p.heading ?? 0}deg"><span class="live-car-pulse"></span><span class="live-car-dot"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V11l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3"/></svg></span></span>`
          : '<span class="live-rider"><span class="live-car-pulse"></span><span class="live-rider-dot"></span></span>';
        const mk = L.marker([p.lat, p.lon], { icon: L.divIcon({ html, className: 'live-marker', iconSize: [36, 36], iconAnchor: [18, 18] }), zIndexOffset: 1000, keyboard: false }).addTo(g);
        if (p.label) mk.bindTooltip(p.label);
        return;
      }
      const c = L.circleMarker([p.lat, p.lon], { radius: p.kind === 'me' ? 7 : 9, color: '#FFFFFF', weight: 3, fillColor: COLORS[p.kind], fillOpacity: 1, className: 'map-pin' }).addTo(g);
      if (p.label) c.bindTooltip(p.label);
    });
    // re-fit only when the set of places or routes changes, not on every poll
    const fixed = points.filter((p) => !LIVE_KINDS.includes(p.kind));
    const sig = JSON.stringify([fixed.map((p) => [p.lat, p.lon]), routes.map((r) => [r.id, r.coords.length])]);
    if (sig === lastFit.current) return;
    lastFit.current = sig;
    const all: [number, number][] = [...fixed.map((p) => [p.lat, p.lon] as [number, number]), ...routes.flatMap((r) => r.coords)];
    if (all.length === 1) m.flyTo(all[0], 15, { duration: 0.8 });
    else if (all.length > 1) m.flyToBounds(L.latLngBounds(all), { padding: [32, 32], maxZoom: 16, duration: 0.8 });
  }, [points, routes, onRouteClick]);

  return <div ref={el} className="leaflet-box" style={{ height }} role="application" aria-label={label} />;
}
