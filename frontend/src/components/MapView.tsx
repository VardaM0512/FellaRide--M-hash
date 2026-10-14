// A real street map (OpenStreetMap tiles via Leaflet). Shows start, end and pickup dots and one or more
// routes; optional tap-to-pick and tap-a-route. Dots are drawn shapes, so no marker images are needed.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface MapPoint { lat: number; lon: number; kind: 'from' | 'to' | 'pickup' | 'me'; label?: string }
export interface MapRoute { id: number; coords: [number, number][]; selected?: boolean }

const COLORS: Record<MapPoint['kind'], string> = { from: '#F5A524', to: '#0B0B0C', pickup: '#047857', me: '#6D28D9' };
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
        color: r.selected ? (dark() ? '#F4F4F5' : '#0B0B0C') : '#8A8F98', weight: r.selected ? 5 : 4, opacity: r.selected ? 1 : 0.6,
        lineCap: 'round', lineJoin: 'round',
      }).addTo(g);
      if (onRouteClick) line.on('click', (e) => { L.DomEvent.stopPropagation(e); onRouteClick(r.id); });
    });
    points.forEach((p) => {
      const c = L.circleMarker([p.lat, p.lon], { radius: p.kind === 'me' ? 7 : 9, color: '#FFFFFF', weight: 3, fillColor: COLORS[p.kind], fillOpacity: 1, className: 'map-pin' }).addTo(g);
      if (p.label) c.bindTooltip(p.label);
    });
    // re-fit only when the set of places or routes changes, not on every poll
    const sig = JSON.stringify([points.map((p) => [p.lat, p.lon]), routes.map((r) => [r.id, r.coords.length])]);
    if (sig === lastFit.current) return;
    lastFit.current = sig;
    const all: [number, number][] = [...points.map((p) => [p.lat, p.lon] as [number, number]), ...routes.flatMap((r) => r.coords)];
    if (all.length === 1) m.flyTo(all[0], 15, { duration: 0.8 });
    else if (all.length > 1) m.flyToBounds(L.latLngBounds(all), { padding: [32, 32], maxZoom: 16, duration: 0.8 });
  }, [points, routes, onRouteClick]);

  return <div ref={el} className="leaflet-box" style={{ height }} role="application" aria-label={label} />;
}
