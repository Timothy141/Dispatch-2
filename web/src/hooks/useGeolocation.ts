import { useEffect, useState } from 'react';
import type { LatLng } from '../types';

export interface GeoState {
  position: (LatLng & { heading: number | null; accuracy: number }) | null;
  error: string | null;
  supported: boolean;
}

/** Watch the device position. `enabled=false` releases the watch. */
export function useGeolocation(enabled: boolean): GeoState {
  const [state, setState] = useState<GeoState>({ position: null, error: null, supported: typeof navigator !== 'undefined' && 'geolocation' in navigator });
  useEffect(() => {
    if (!enabled || !state.supported) return;
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setState((s) => ({
          ...s,
          error: null,
          position: { lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading ?? null, accuracy: p.coords.accuracy },
        })),
      (err) => setState((s) => ({ ...s, error: err.message })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled, state.supported]);
  return state;
}
