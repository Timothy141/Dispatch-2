import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Api } from '../api';
import { Map, type MapMarker } from '../components/Map';
import { PriorityBadge, ServiceBadge, Stars, Stepper } from '../components/Common';
import { ago, clock, km, mapsLink, minutes, SERVICE_META, STATUS_TEXT } from '../format';
import { useEvents } from '../hooks/useEvents';
import { useGeolocation } from '../hooks/useGeolocation';
import { useNow } from '../hooks/useNow';
import type { Catalogue, HelpRequest, LatLng, Service, TrackView, User } from '../types';

interface Props {
  api: Api;
  user: User;
  catalogue: Catalogue;
  toast: (m: string, err?: boolean) => void;
  onConnection: (s: string) => void;
}

const FALLBACK: LatLng = { lat: -33.9249, lng: 18.4241 }; // Cape Town CBD when no GPS
const OPEN = new Set(['searching', 'assigned', 'en_route', 'arrived']);

export function RequesterScreen({ api, user, catalogue, toast, onConnection }: Props) {
  const geo = useGeolocation(true);
  const [pin, setPin] = useState<LatLng | null>(null); // manual override
  const [service, setService] = useState<Service | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HelpRequest[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [track, setTrack] = useState<TrackView | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const now = useNow();

  const myPos: LatLng = pin ?? geo.position ?? FALLBACK;

  const loadHistory = useCallback(async () => {
    try {
      const list = await api.myRequests();
      setHistory(list);
      const open = list.find((r) => OPEN.has(r.status));
      setActiveId((cur) => cur ?? open?.id ?? null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }, [api, toast]);

  const refreshTrack = useCallback(async () => {
    if (!activeId) return setTrack(null);
    try {
      setTrack(await api.track(activeId));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  }, [api, activeId, toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  useEffect(() => {
    refreshTrack();
  }, [refreshTrack]);

  const connection = useEvents(
    api.eventsUrl(),
    useCallback(
      (type: string, data: unknown) => {
        if (type === 'request.updated' || type === 'request.created') {
          const r = data as HelpRequest;
          setHistory((h) => (h.some((x) => x.id === r.id) ? h.map((x) => (x.id === r.id ? r : x)) : [r, ...h]));
          if (r.id === activeId || !activeId) {
            setActiveId(r.id);
            refreshTrack();
          }
          if (r.status === 'assigned' && r.id === activeId) toast('A unit has accepted your request');
          if (r.status === 'arrived' && r.id === activeId) toast('Your unit has arrived');
        }
        if (type === 'responder.location') {
          const d = data as { requestId: string; lat: number; lng: number; heading: number | null; distanceM: number; etaSeconds: number };
          if (d.requestId === activeId) {
            setTrack((t) =>
              t && t.responder
                ? { ...t, responder: { ...t.responder, lat: d.lat, lng: d.lng, heading: d.heading }, distanceM: d.distanceM, etaSeconds: d.etaSeconds, trail: [...t.trail, { lat: d.lat, lng: d.lng, at: new Date().toISOString() }] }
                : t,
            );
          }
        }
      },
      [activeId, refreshTrack, toast],
    ),
  );
  useEffect(() => onConnection(connection), [connection, onConnection]);

  const submit = async () => {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRequest({ service, lat: myPos.lat, lng: myPos.lng, description: description.trim() || undefined, flags });
      setActiveId(r.id);
      setHistory((h) => [r, ...h]);
      setService(null);
      setFlags([]);
      setDescription('');
      toast(`Request ${r.reference} sent`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!activeId || !confirm('Cancel this request?')) return;
    try {
      await api.cancel(activeId, 'cancelled by requester');
      await refreshTrack();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  const submitRating = async () => {
    if (!activeId || !rating) return;
    try {
      await api.rate(activeId, rating, comment.trim() || undefined);
      toast('Thank you for your feedback');
      setActiveId(null);
      setRating(0);
      setComment('');
      loadHistory();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), true);
    }
  };

  const req = track?.request ?? null;
  const showingActive = req && (OPEN.has(req.status) || (req.status === 'completed' && req.rating === null) || req.status === 'unfulfilled');

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (showingActive && req) {
      m.push({ id: 'incident', lat: req.lat, lng: req.lng, kind: 'incident', service: req.service });
      if (track?.responder?.lat != null && track.responder.lng != null && OPEN.has(req.status)) {
        m.push({ id: 'unit', lat: track.responder.lat, lng: track.responder.lng, kind: 'unit', service: req.service, heading: track.responder.heading, label: track.responder.unitName });
      }
    } else {
      m.push({ id: 'me', lat: myPos.lat, lng: myPos.lng, kind: 'me' });
    }
    return m;
  }, [showingActive, req, track?.responder, myPos.lat, myPos.lng]);

  const flagDefs = service ? catalogue.flags[service] : [];

  return (
    <div className="requester">
      <Map center={showingActive && req ? { lat: req.lat, lng: req.lng } : myPos} zoom={15} markers={markers} trail={track?.trail ?? []} fit={!!(showingActive && markers.length > 1)} onClick={showingActive ? undefined : setPin} />

      <div className="sheet">
        {!showingActive ? (
          <>
            <div className="row">
              <h2>What do you need?</h2>
              <span className="spacer" />
              <span className="hint">
                {pin ? 'Pinned location' : geo.position ? `GPS ±${Math.round(geo.position.accuracy)} m` : geo.error ? 'GPS unavailable – tap the map to set your location' : 'Locating…'}
                {pin && (
                  <button className="btn small ghost" onClick={() => setPin(null)}>
                    use GPS
                  </button>
                )}
              </span>
            </div>
            <div className="service-grid">
              {catalogue.services.map((s) => (
                <button key={s} className={`service-btn ${service === s ? 'active' : ''}`} style={{ ['--c' as string]: SERVICE_META[s].color }} onClick={() => { setService(s); setFlags([]); }}>
                  <span className="icon">{SERVICE_META[s].icon}</span>
                  {SERVICE_META[s].label.toUpperCase()}
                </button>
              ))}
            </div>
            {service && (
              <>
                <div className="chips">
                  {flagDefs.map((f) => (
                    <button key={f.key} className={`chip ${f.priority ?? ''} ${flags.includes(f.key) ? 'on' : ''}`} onClick={() => setFlags((cur) => (cur.includes(f.key) ? cur.filter((k) => k !== f.key) : [...cur, f.key]))}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything the responder should know (optional)" />
              </>
            )}
            {error && <div className="error">{error}</div>}
            <button className={`btn-help ${busy ? 'busy' : ''}`} disabled={!service || busy} onClick={submit}>
              {busy ? 'Sending…' : service ? `Request ${SERVICE_META[service].label}` : 'Choose a service'}
            </button>
            <div className="hint">Your location and number are shared only with the unit that accepts. Life-threatening emergency? Also call your national emergency number.</div>
            {history.length > 0 && (
              <div className="history">
                <h3>Recent</h3>
                {history.slice(0, 5).map((r) => (
                  <button key={r.id} className="history-item" onClick={() => setActiveId(r.id)}>
                    <ServiceBadge service={r.service} />
                    <span className="mono">{r.reference}</span>
                    <span className="spacer" />
                    <span className="badge status">{r.status.replace('_', ' ')}</span>
                    <span className="hint">{ago(r.createdAt, now)} ago</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          req && (
            <>
              <div className="status-head">
                <ServiceBadge service={req.service} />
                <h2 className={req.status === 'searching' ? 'searching-dots' : ''}>{STATUS_TEXT[req.status]}</h2>
                <span className="spacer" />
                <span className="mono hint">{req.reference}</span>
              </div>
              <Stepper status={req.status} />

              {req.status === 'searching' && (
                <div className="card">
                  <div className="row">
                    <div>
                      <div className="hint">Asking nearby {SERVICE_META[req.service].unit}s</div>
                      <div className="big-num">{track?.offersOutstanding ?? 0} <span className="hint">unit{track?.offersOutstanding === 1 ? '' : 's'} notified</span></div>
                    </div>
                    <span className="spacer" />
                    <PriorityBadge priority={req.priority} />
                  </div>
                  <div className="hint">Searching for {ago(req.searchStartedAt, now)}. Units that do not answer within {catalogue.matching.offerTimeoutSeconds}s are skipped automatically.</div>
                </div>
              )}

              {req.status === 'unfulfilled' && (
                <div className="error">No unit could be reached automatically. The control room has been alerted and can assign a unit manually. Keep this screen open.</div>
              )}

              {track?.responder && OPEN.has(req.status) && (
                <div className="card">
                  <div className="unit-card">
                    <div className="unit-avatar">{SERVICE_META[req.service].icon}</div>
                    <div>
                      <b>{track.responder.unitName}</b> {track.responder.rating !== null && <span className="hint">★ {track.responder.rating}</span>}
                      <div className="hint">{[track.responder.organisation, track.responder.vehicle].filter(Boolean).join(' · ')}</div>
                      <div className="hint">{track.responder.name}</div>
                    </div>
                    <div className="eta">
                      {req.status === 'arrived' ? 'Here' : minutes(track.etaSeconds)}
                      <small>{req.status === 'arrived' ? 'at your location' : `${km(track.distanceM)} away`}</small>
                    </div>
                  </div>
                  <div className="actions">
                    <a className="btn" href={`tel:${track.responder.phone}`}>
                      📞 Call unit
                    </a>
                    <a className="btn ghost" href={mapsLink(req)} target="_blank" rel="noreferrer">
                      Your pin
                    </a>
                  </div>
                </div>
              )}

              {req.status === 'completed' && (
                <div className="card">
                  <h3>How was the response?</h3>
                  <Stars value={rating} onChange={setRating} />
                  <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" />
                  <div className="actions">
                    <button className="btn primary" disabled={!rating} onClick={submitRating}>
                      Submit rating
                    </button>
                    <button className="btn ghost" onClick={() => setActiveId(null)}>
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {(OPEN.has(req.status) || req.status === 'unfulfilled') && (
                <div className="actions">
                  <button className="btn danger" onClick={cancel} disabled={req.status === 'arrived'}>
                    Cancel request
                  </button>
                  <span className="hint" style={{ alignSelf: 'center' }}>
                    Requested {clock(req.createdAt)} by {user.name}
                  </span>
                </div>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
