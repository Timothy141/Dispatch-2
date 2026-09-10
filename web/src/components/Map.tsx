import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { LatLng, Service } from '../types';
import { SERVICE_META } from '../format';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'me' | 'incident' | 'unit';
  service?: Service;
  heading?: number | null;
  label?: string;
  dim?: boolean;
}

interface Props {
  center: LatLng;
  zoom?: number;
  markers: MapMarker[];
  trail?: LatLng[];
  fit?: boolean;
  onClick?: (p: LatLng) => void;
  className?: string;
}

function iconFor(m: MapMarker): L.DivIcon {
  if (m.kind === 'incident') {
    return L.divIcon({ className: 'mk', html: `<div class="mk-incident ${m.service ?? ''}"><span>!</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });
  }
  if (m.kind === 'me') {
    return L.divIcon({ className: 'mk', html: `<div class="mk-me"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
  }
  const color = m.service ? SERVICE_META[m.service].color : '#8b98a5';
  const rot = m.heading ?? 0;
  return L.divIcon({
    className: 'mk',
    html: `<div class="mk-unit ${m.dim ? 'dim' : ''}" style="--c:${color}"><div class="mk-arrow" style="transform:rotate(${rot}deg)"></div>${m.label ? `<div class="mk-label">${escapeHtml(m.label)}</div>` : ''}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function Map({ center, zoom = 13, markers, trail = [], fit = false, onClick, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const markerRefs = useRef<globalThis.Map<string, L.Marker>>(new globalThis.Map());
  const trailRef = useRef<L.Polyline | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e) => clickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // recentre when center changes materially and we are not fitting bounds
  useEffect(() => {
    if (!map.current || fit) return;
    map.current.setView([center.lat, center.lng], map.current.getZoom(), { animate: true });
  }, [center.lat, center.lng, fit]);

  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    const seen = new Set<string>();
    for (const mk of markers) {
      seen.add(mk.id);
      const existing = markerRefs.current.get(mk.id);
      if (existing) {
        existing.setLatLng([mk.lat, mk.lng]);
        existing.setIcon(iconFor(mk));
      } else {
        const marker = L.marker([mk.lat, mk.lng], { icon: iconFor(mk), interactive: false });
        marker.addTo(lg);
        markerRefs.current.set(mk.id, marker);
      }
    }
    for (const [id, marker] of markerRefs.current) {
      if (!seen.has(id)) {
        lg.removeLayer(marker);
        markerRefs.current.delete(id);
      }
    }
    if (trailRef.current) {
      lg.removeLayer(trailRef.current);
      trailRef.current = null;
    }
    if (trail.length > 1) {
      trailRef.current = L.polyline(
        trail.map((p) => [p.lat, p.lng] as [number, number]),
        { color: '#8b98a5', weight: 3, dashArray: '4 6', opacity: 0.8 },
      ).addTo(lg);
    }
    if (fit && markers.length) {
      const b = L.latLngBounds(markers.map((x) => [x.lat, x.lng] as [number, number]));
      m.fitBounds(b.pad(0.35), { maxZoom: 16, animate: true });
    }
  }, [markers, trail, fit]);

  // Leaflet needs a nudge when its container is resized by layout changes.
  useEffect(() => {
    const m = map.current;
    if (!m || !el.current) return;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, []);

  return <div ref={el} className={`map ${className ?? ''}`} role="img" aria-label="Map" />;
}
