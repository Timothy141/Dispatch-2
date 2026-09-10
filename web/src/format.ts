import type { Priority, RequestStatus, Service } from './types';

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
export function minutes(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  if (s < 60) return '<1 min';
  return `${Math.round(s / 60)} min`;
}
export function km(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}
export const label = (s: string) => s.replace(/_/g, ' ');

export const SERVICE_META: Record<Service, { label: string; icon: string; color: string; unit: string }> = {
  security: { label: 'Security', icon: '🛡️', color: '#3b82f6', unit: 'armed response unit' },
  medical: { label: 'Medical', icon: '🚑', color: '#22c55e', unit: 'medical unit' },
  fire: { label: 'Fire', icon: '🔥', color: '#f97316', unit: 'fire crew' },
};

export const STATUS_TEXT: Record<RequestStatus, string> = {
  searching: 'Finding the nearest unit…',
  assigned: 'Unit assigned',
  en_route: 'Help is on the way',
  arrived: 'Unit has arrived',
  completed: 'Completed',
  cancelled: 'Cancelled',
  unfulfilled: 'No unit available – control room notified',
};

export const PRIORITY_COLOR: Record<Priority, string> = { standard: '#8b98a5', urgent: '#f5a524', critical: '#e5484d' };

export function mapsLink(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}
