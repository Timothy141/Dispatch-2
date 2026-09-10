import { useEffect, useMemo, useRef, useState } from 'react';
import type { Api } from '../api';
import { km, SERVICE_META } from '../format';
import type { Catalogue, GeocodeHit, HelpRequest, LatLng, Responder, Service } from '../types';
import { Map } from './Map';

interface Props {
  api: Api;
  catalogue: Catalogue;
  units: Responder[];
  center: LatLng;
  onClose: () => void;
  onCreated: (r: HelpRequest) => void;
}

function dist(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Agent logs an incident phoned/radioed in and sends it to a response officer. */
export function CalloutModal({ api, catalogue, units, center, onClose, onCreated }: Props) {
  const [service, setService] = useState<Service>('security');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState<(LatLng & { label?: string }) | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [responderId, setResponderId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // debounce address search
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 3) return setHits([]);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setHits(await api.geocode(query.trim()));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => timer.current && clearTimeout(timer.current);
  }, [api, query]);

  const candidates = useMemo(
    () =>
      units
        .filter((u) => u.service === service && u.status !== 'busy')
        .map((u) => ({ u, d: pin && u.lat != null && u.lng != null ? dist(pin, { lat: u.lat, lng: u.lng }) : null }))
        .sort((a, b) => (a.d ?? 1e12) - (b.d ?? 1e12)),
    [units, service, pin],
  );

  const submit = async () => {
    if (!pin) return setError('Set the incident location: search an address or tap the map.');
    setBusy(true);
    setError(null);
    try {
      const r = await api.createCallout({
        service,
        contactName: contactName.trim(),
        contactPhone: contactPhone.trim(),
        lat: pin.lat,
        lng: pin.lng,
        address: pin.label ?? query.trim() ?? undefined,
        description: description.trim() || undefined,
        flags,
        responderId: responderId || null,
      });
      onCreated(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const markers = pin ? [{ id: 'pin', lat: pin.lat, lng: pin.lng, kind: 'incident' as const, service }] : [];

  return (
    <div className="modal" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-body wide" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>New call-out</h2>
          <span className="spacer" />
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="callout-grid">
          <div className="callout-form">
            <div className="field">
              <label>Service</label>
              <div className="service-grid">
                {catalogue.services.map((s) => (
                  <button type="button" key={s} className={`service-btn ${service === s ? 'active' : ''}`} style={{ ['--c' as string]: SERVICE_META[s].color }} onClick={() => { setService(s); setFlags([]); setResponderId(''); }}>
                    <span className="icon">{SERVICE_META[s].icon}</span>
                    {SERVICE_META[s].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="c-name">Caller name</label>
                <input id="c-name" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Who is calling" />
              </div>
              <div className="field">
                <label htmlFor="c-phone">Caller phone</label>
                <input id="c-phone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="082 123 4567" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-addr">Incident address</label>
              <input id="c-addr" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing an address, or tap the map" autoComplete="off" />
              {searching && <div className="hint">Searching…</div>}
              {hits.length > 0 && (
                <div className="hits">
                  {hits.map((h) => (
                    <button type="button" key={`${h.lat},${h.lng}`} className="hit" onClick={() => { setPin({ lat: h.lat, lng: h.lng, label: h.label }); setQuery(h.label); setHits([]); }}>
                      {h.label}
                    </button>
                  ))}
                </div>
              )}
              {pin && <div className="hint">📍 {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}</div>}
            </div>
            <div className="chips">
              {catalogue.flags[service].map((f) => (
                <button type="button" key={f.key} className={`chip ${f.priority ?? ''} ${flags.includes(f.key) ? 'on' : ''}`} onClick={() => setFlags((cur) => (cur.includes(f.key) ? cur.filter((k) => k !== f.key) : [...cur, f.key]))}>
                  {f.label}
                </button>
              ))}
            </div>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the caller reported" />
            <div className="field">
              <label htmlFor="c-unit">Send to response officer</label>
              <select id="c-unit" value={responderId} onChange={(e) => setResponderId(e.target.value)}>
                <option value="">Automatic – offer to the nearest available units</option>
                {candidates.map(({ u, d }) => (
                  <option key={u.userId} value={u.userId}>
                    {u.unitName} · {u.name} · {u.status}
                    {d !== null ? ` · ${km(Math.round(d))}` : ' · no location'}
                  </option>
                ))}
              </select>
              <div className="hint">Choosing an officer assigns the job to them immediately and their app rings. Offline units are brought online.</div>
            </div>
            {error && <div className="error">{error}</div>}
            <button className="btn-help" disabled={busy || !contactName.trim() || contactPhone.trim().length < 6 || !pin} onClick={submit}>
              {busy ? 'Sending…' : responderId ? 'Send to officer' : 'Create and match'}
            </button>
          </div>
          <div className="callout-map">
            <Map center={pin ?? center} zoom={pin ? 15 : 12} markers={markers} onClick={(p) => { setPin({ lat: p.lat, lng: p.lng }); if (!query) setQuery(''); }} />
          </div>
        </div>
      </div>
    </div>
  );
}
