import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Api } from '../api';
import { Map, type MapMarker } from '../components/Map';
import { PriorityBadge, ServiceBadge, StatusBadge } from '../components/Common';
import { ago, km, label, mapsLink, minutes, SERVICE_META } from '../format';
import { useEvents } from '../hooks/useEvents';
import { useGeolocation } from '../hooks/useGeolocation';
import { useNow } from '../hooks/useNow';
import type { Catalogue, HelpRequest, LatLng, Offer, Responder, Service, User } from '../types';

interface Props {
  api: Api;
  user: User;
  catalogue: Catalogue;
  toast: (m: string, err?: boolean) => void;
  onConnection: (s: string) => void;
}

const FALLBACK: LatLng = { lat: -33.9249, lng: 18.4241 };

export function ResponderScreen({ api, user, catalogue, toast, onConnection }: Props) {
  const [responder, setResponder] = useState<Responder | null | undefined>(undefined);
  const [offers, setOffers] = useState<{ offer: Offer; request: HelpRequest }[]>([]);
  const [job, setJob] = useState<HelpRequest | null>(null);
  const [manualPos, setManualPos] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const geo = useGeolocation(responder?.status !== 'offline');
  const now = useNow();
  const lastSent = useRef<string>('');

  // profile form
  const [service, setService] = useState<Service>('security');
  const [unitName, setUnitName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [organisation, setOrganisation] = useState('');

  const refresh = useCallback(async () => {
    try {
      const me = await api.responderMe();
      setResponder(me.responder);
      setOffers(me.offers);
      setJob(me.activeJob);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }, [api, toast]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const connection = useEvents(
    api.eventsUrl(),
    useCallback(
      (type: string, data: unknown) => {
        if (type === 'offer.created') {
          const d = data as { offer: Offer; request: HelpRequest };
          setOffers((o) => (o.some((x) => x.offer.id === d.offer.id) ? o : [...o, d]));
          try {
            navigator.vibrate?.([200, 100, 200]);
          } catch {
            /* ignore */
          }
          toast(`New ${d.request.service} job ${d.request.reference} · ${km(d.offer.distanceM)}`);
        } else if (type === 'offer.updated') {
          const o = data as Offer;
          if (o.status !== 'pending') setOffers((cur) => cur.filter((x) => x.offer.id !== o.id));
        } else {
          refresh();
        }
      },
      [refresh, toast],
    ),
  );
  useEffect(() => onConnection(connection), [connection, onConnection]);

  // push our position to the server while online (GPS, or manual pin for desktop demos)
  const pos: (LatLng & { heading?: number | null }) | null = manualPos ?? geo.position ?? null;
  useEffect(() => {
    if (!responder || responder.status === 'offline' || !pos) return;
    const key = `${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    api.setLocation({ lat: pos.lat, lng: pos.lng, heading: pos.heading ?? null }).catch(() => undefined);
  }, [api, responder, pos]);
  // heartbeat so the server never considers a stationary unit stale
  useEffect(() => {
    if (!responder || responder.status === 'offline' || !pos) return;
    const t = setInterval(() => api.setLocation({ lat: pos.lat, lng: pos.lng, heading: pos.heading ?? null }).catch(() => undefined), 60000);
    return () => clearInterval(t);
  }, [api, responder, pos]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const toggleOnline = () => {
    if (!responder) return;
    if (responder.status === 'offline' && !pos) return toast('Waiting for your location. Tap the map to set it manually.', true);
    act(() => api.setStatus(responder.status === 'offline' ? 'available' : 'offline'));
  };

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    const p = pos ?? FALLBACK;
    if (responder) m.push({ id: 'me', lat: p.lat, lng: p.lng, kind: 'unit', service: responder.service, heading: pos?.heading ?? null, label: responder.unitName });
    if (job) m.push({ id: 'job', lat: job.lat, lng: job.lng, kind: 'incident', service: job.service });
    for (const o of offers) m.push({ id: `offer-${o.offer.id}`, lat: o.request.lat, lng: o.request.lng, kind: 'incident', service: o.request.service });
    return m;
  }, [pos, responder, job, offers]);

  if (responder === undefined) return <div className="empty">Loading…</div>;

  if (responder === null) {
    return (
      <div className="login">
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => api.saveProfile({ service, unitName: unitName.trim(), vehicle: vehicle.trim() || undefined, organisation: organisation.trim() || undefined }), 'Profile saved');
          }}
        >
          <h2>Set up your unit</h2>
          <div className="field">
            <label>Service</label>
            <div className="service-grid">
              {catalogue.services.map((s) => (
                <button type="button" key={s} className={`service-btn ${service === s ? 'active' : ''}`} style={{ ['--c' as string]: SERVICE_META[s].color }} onClick={() => setService(s)}>
                  <span className="icon">{SERVICE_META[s].icon}</span>
                  {SERVICE_META[s].label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="p-unit">Unit / call sign</label>
            <input id="p-unit" value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="e.g. Alpha 12" required />
          </div>
          <div className="field">
            <label htmlFor="p-org">Organisation</label>
            <input id="p-org" value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder="e.g. Alpha Armed Response" />
          </div>
          <div className="field">
            <label htmlFor="p-veh">Vehicle</label>
            <input id="p-veh" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. White Ranger CA 412-981" />
          </div>
          <button className="btn primary big" disabled={busy || !unitName.trim()}>
            Save and continue
          </button>
        </form>
      </div>
    );
  }

  const online = responder.status !== 'offline';

  return (
    <div className="responder">
      <Map center={pos ?? FALLBACK} zoom={14} markers={markers} fit={!!(job || offers.length)} onClick={(p) => setManualPos(p)} />
      <aside className="side">
        <div className={`toggle ${online ? 'on' : ''}`}>
          <div>
            <b>{responder.unitName}</b> <ServiceBadge service={responder.service} />
            <div className="hint">
              {online ? (responder.status === 'busy' ? 'On a job' : 'Online – waiting for jobs') : 'Offline'} · {user.name}
              {responder.rating !== null && ` · ★ ${responder.rating}`} · {responder.jobsCompleted} jobs
            </div>
          </div>
          <button className={`switch ${online ? 'on' : ''}`} onClick={toggleOnline} disabled={busy || responder.status === 'busy'} aria-label="Toggle online" />
        </div>
        <div className="hint">
          {manualPos ? (
            <>
              Manual position set.{' '}
              <button className="btn small ghost" onClick={() => setManualPos(null)}>
                use GPS
              </button>
            </>
          ) : geo.position ? (
            `GPS fix ±${Math.round(geo.position.accuracy)} m`
          ) : geo.error ? (
            `GPS: ${geo.error}. Tap the map to set your position.`
          ) : (
            'Waiting for GPS… tap the map to set your position manually.'
          )}
        </div>

        {offers.map(({ offer, request }) => {
          const total = new Date(offer.expiresAt).getTime() - new Date(offer.offeredAt).getTime();
          const left = Math.max(0, new Date(offer.expiresAt).getTime() - now);
          return (
            <div key={offer.id} className="card offer">
              <div className="row">
                <ServiceBadge service={request.service} />
                <PriorityBadge priority={request.priority} />
                <span className="spacer" />
                <span className="mono">{request.reference}</span>
              </div>
              <div className="row">
                <div className="big-num">{km(offer.distanceM)}</div>
                <div className="hint">~{minutes(offer.etaSeconds)} away</div>
                <span className="spacer" />
                <div className="hint">{Math.ceil(left / 1000)}s to respond</div>
              </div>
              <div className="countdown">
                <div style={{ width: `${(left / total) * 100}%` }} />
              </div>
              {request.flags.length > 0 && <div className="chips">{request.flags.map((f) => <span key={f} className="chip on">{label(f)}</span>)}</div>}
              {request.description && <div>{request.description}</div>}
              <div className="actions">
                <button className="btn success big" style={{ flex: 1 }} disabled={busy} onClick={() => act(() => api.accept(offer.id), `Accepted ${request.reference}`)}>
                  Accept
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => act(() => api.decline(offer.id))}>
                  Decline
                </button>
              </div>
            </div>
          );
        })}

        {job && (
          <div className="card">
            <div className="row">
              <ServiceBadge service={job.service} />
              <PriorityBadge priority={job.priority} />
              <StatusBadge status={job.status} />
              <span className="spacer" />
              <span className="mono">{job.reference}</span>
            </div>
            <dl className="kv">
              <dt>Requester</dt>
              <dd>
                {job.requesterName} · <a href={`tel:${job.requesterPhone}`}>{job.requesterPhone}</a>
              </dd>
              <dt>Location</dt>
              <dd>
                {job.address ?? `${job.lat.toFixed(5)}, ${job.lng.toFixed(5)}`}
                {pos && <span className="hint"> · {km(Math.round(distance(pos, job)))} away</span>}
              </dd>
              {job.flags.length > 0 && (
                <>
                  <dt>Situation</dt>
                  <dd>{job.flags.map(label).join(', ')}</dd>
                </>
              )}
              {job.description && (
                <>
                  <dt>Notes</dt>
                  <dd>{job.description}</dd>
                </>
              )}
              <dt>Requested</dt>
              <dd>{ago(job.createdAt, now)} ago</dd>
            </dl>
            <a className="btn block" href={mapsLink(job)} target="_blank" rel="noreferrer">
              🧭 Navigate
            </a>
            <div className="actions">
              {job.status === 'assigned' && (
                <button className="btn primary big" style={{ flex: 1 }} disabled={busy} onClick={() => act(() => api.progress(job.id, 'en_route'))}>
                  En route
                </button>
              )}
              {job.status === 'en_route' && (
                <button className="btn primary big" style={{ flex: 1 }} disabled={busy} onClick={() => act(() => api.progress(job.id, 'arrived'))}>
                  Arrived
                </button>
              )}
              {job.status === 'arrived' && (
                <button className="btn success big" style={{ flex: 1 }} disabled={busy} onClick={() => act(() => api.progress(job.id, 'completed'), 'Job completed')}>
                  Complete
                </button>
              )}
              {job.status !== 'arrived' && (
                <button
                  className="btn danger"
                  disabled={busy}
                  onClick={() => {
                    const reason = prompt('Why are you releasing this job? It will be offered to the next unit.');
                    if (reason !== null) act(() => api.release(job.id, reason || undefined), 'Job released');
                  }}
                >
                  Release
                </button>
              )}
            </div>
          </div>
        )}

        {!job && offers.length === 0 && online && <div className="empty">Waiting for nearby {SERVICE_META[responder.service].label.toLowerCase()} jobs…</div>}
        {!online && <div className="empty">Go online to receive jobs.</div>}
      </aside>
    </div>
  );
}

function distance(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
